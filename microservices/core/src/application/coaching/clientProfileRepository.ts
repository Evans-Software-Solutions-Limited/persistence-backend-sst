import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import {
  coachClientProfiles,
  coachClientSetupItems,
  profiles,
  trainerInviteCodes,
  type CoachClientProfile,
  type CoachClientSetupItem,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../repositories/personalRecordsRepository";
import {
  SETUP_SECTIONS,
  buildAcceptPreview,
  isSetupSection,
  sectionHandler,
  type AcceptPreview,
  type SetupItemInput,
  type SetupSection,
} from "./setupSections";

/**
 * Invited client profiles (PER-108, design A D1/D3, canvas C11).
 *
 * Every method takes the caller's `trainerId` first and filters by it. A
 * profile that isn't the caller's is indistinguishable from one that doesn't
 * exist (404, no leak). Deleted profiles keep a tombstone (`deleted_at`) so a
 * `?since=` list can report them; the nightly purge removes them for good.
 */

export const PERSONAL_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const UNACCEPTED_PROFILE_RETENTION_DAYS = 90;
/** How long a tombstone stays for offline devices before it is hard-deleted. */
export const TOMBSTONE_SYNC_DAYS = 30;
/** What a purged profile's name becomes while its tombstone remains. */
export const SCRUBBED_DISPLAY_NAME = "Removed";
/**
 * `asOf` on a `?since=` list is moved back by this much. Writers stamp
 * `updated_at` before they commit, so a write still open while the list runs
 * can commit with an `updated_at` earlier than the list's clock. Moving `asOf`
 * back past any such transaction (the API Lambda times out at 29 s) means the
 * next sync re-reads it. Clients upsert by id, so a repeated row is harmless.
 */
export const AS_OF_SAFETY_MARGIN_MS = 2 * 60 * 1000;

const TRAINER_ROLES = new Set(["personal_trainer", "physiotherapist", "admin"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE = ["invited", "cancelled"];

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** The role gate for every coach-only route: a trainer, not soft-deleted. */
export async function isActiveTrainer(
  userId: string,
  db: DbOrTx = getDb(),
): Promise<boolean> {
  const rows = await db
    .select({ role: profiles.role, deletedAt: profiles.deletedAt })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  const row = rows[0];
  return !!row && TRAINER_ROLES.has(row.role ?? "") && row.deletedAt === null;
}

export function inviteLink(code: string): string {
  // Routed by 1.2.0 already (mobile deep-link.ts SCHEME_HOSTS["accept-invite"]).
  return `persistencemobile://accept-invite?code=${code}`;
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1, as today
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export interface ClientProfileDTO {
  id: string;
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  goal: string | null;
  privateNotes: string | null;
  status: string;
  clientId: string | null;
  relationshipId: string | null;
  acceptedAt: string | null;
  cancelledAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SetupItemDTO {
  id: string;
  refId: string | null;
  config: Record<string, unknown>;
  sortOrder: number;
  materialisedAt: string | null;
}

export type InviteStatus = "active" | "used" | "expired";

export interface InviteDTO {
  code: string;
  link: string;
  expiresAt: string;
  status: InviteStatus;
}

export interface ClientProfileDetailDTO extends ClientProfileDTO {
  setup: Partial<Record<SetupSection, SetupItemDTO[]>>;
  invite: InviteDTO | null;
}

export interface InvitedClientSummary {
  profileId: string;
  displayName: string;
  goal: string | null;
  inviteExpiresAt: string | null;
  /** 'not_sent' until the coach issues the first code. */
  inviteStatus: InviteStatus | "not_sent";
  readyCount: number;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function profileDto(row: CoachClientProfile): ClientProfileDTO {
  return {
    id: row.id,
    displayName: row.displayName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    goal: row.goal,
    privateNotes: row.privateNotes,
    status: row.status,
    clientId: row.clientId,
    relationshipId: row.relationshipId,
    acceptedAt: iso(row.acceptedAt),
    cancelledAt: iso(row.cancelledAt),
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function inviteStatus(
  row: { status: string; expiresAt: Date },
  now: Date,
): InviteStatus {
  if (row.status === "active" && row.expiresAt > now) return "active";
  return row.status === "used" ? "used" : "expired";
}

export interface ProfileFields {
  displayName?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  goal?: string | null;
  privateNotes?: string | null;
}

/** A domain refusal the handler maps to an HTTP status + `{code, message}`. */
export type Refusal =
  | { refused: "not_found" }
  | { refused: "revision_conflict"; current: ClientProfileDetailDTO }
  | { refused: "not_editable"; status: string }
  | { refused: "section_unavailable"; section: string }
  | { refused: "invalid_setup"; message: string };

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === "object" && value !== null && "refused" in value;
}

export class ClientProfileRepository {
  /** The caller's live (not deleted) profile, or null. */
  async findOwned(
    trainerId: string,
    profileId: string,
    db: DbOrTx = getDb(),
    lock = false,
  ): Promise<CoachClientProfile | null> {
    if (!isUuid(profileId)) return null;
    const query = db
      .select()
      .from(coachClientProfiles)
      .where(
        and(
          eq(coachClientProfiles.id, profileId),
          eq(coachClientProfiles.trainerId, trainerId),
          isNull(coachClientProfiles.deletedAt),
        ),
      )
      .limit(1);
    const rows = lock ? await query.for("update") : await query;
    return rows[0] ?? null;
  }

  async items(
    profileId: string,
    db: DbOrTx = getDb(),
  ): Promise<CoachClientSetupItem[]> {
    return db
      .select()
      .from(coachClientSetupItems)
      .where(eq(coachClientSetupItems.profileId, profileId))
      .orderBy(
        asc(coachClientSetupItems.section),
        asc(coachClientSetupItems.sortOrder),
      );
  }

  /** Create, or with a replayed Idempotency-Key return the first row. */
  async create(
    trainerId: string,
    fields: Required<Pick<ProfileFields, "displayName">> & ProfileFields,
    clientRequestId: string | null,
  ): Promise<{ profile: ClientProfileDetailDTO; created: boolean }> {
    const db = getDb();
    const inserted = await db
      .insert(coachClientProfiles)
      .values({
        trainerId,
        displayName: fields.displayName,
        contactEmail: fields.contactEmail ?? null,
        contactPhone: fields.contactPhone ?? null,
        goal: fields.goal ?? null,
        privateNotes: fields.privateNotes ?? null,
        clientRequestId,
      })
      .onConflictDoNothing({
        target: [
          coachClientProfiles.trainerId,
          coachClientProfiles.clientRequestId,
        ],
      })
      .returning();
    let row = inserted[0];
    if (!row) {
      const existing = await db
        .select()
        .from(coachClientProfiles)
        .where(
          and(
            eq(coachClientProfiles.trainerId, trainerId),
            eq(coachClientProfiles.clientRequestId, clientRequestId as string),
          ),
        )
        .limit(1);
      row = existing[0]!;
    }
    return {
      profile: await this.detailOf(row, db),
      created: inserted.length > 0,
    };
  }

  /** `GET …/client-profiles?status=&since=` — `{data, deletedIds, asOf}`. */
  async list(
    trainerId: string,
    opts: { status?: string; since?: Date },
  ): Promise<{ data: ClientProfileDTO[]; deletedIds: string[]; asOf: string }> {
    const db = getDb();
    const asOf = new Date(Date.now() - AS_OF_SAFETY_MARGIN_MS);
    const live = await db
      .select()
      .from(coachClientProfiles)
      .where(
        and(
          eq(coachClientProfiles.trainerId, trainerId),
          isNull(coachClientProfiles.deletedAt),
          opts.status ? eq(coachClientProfiles.status, opts.status) : undefined,
          opts.since
            ? gt(coachClientProfiles.updatedAt, opts.since)
            : undefined,
        ),
      )
      .orderBy(desc(coachClientProfiles.createdAt));
    const deleted = opts.since
      ? await db
          .select({ id: coachClientProfiles.id })
          .from(coachClientProfiles)
          .where(
            and(
              eq(coachClientProfiles.trainerId, trainerId),
              isNotNull(coachClientProfiles.deletedAt),
              gt(coachClientProfiles.deletedAt, opts.since),
            ),
          )
      : [];
    return {
      data: live.map(profileDto),
      deletedIds: deleted.map((d) => d.id),
      asOf: asOf.toISOString(),
    };
  }

  async detail(
    trainerId: string,
    profileId: string,
  ): Promise<ClientProfileDetailDTO | null> {
    const row = await this.findOwned(trainerId, profileId);
    return row ? this.detailOf(row, getDb()) : null;
  }

  async detailOf(
    row: CoachClientProfile,
    db: DbOrTx,
  ): Promise<ClientProfileDetailDTO> {
    const items = await this.items(row.id, db);
    const setup: Partial<Record<SetupSection, SetupItemDTO[]>> = {};
    for (const section of SETUP_SECTIONS) {
      const inSection = items.filter((i) => i.section === section);
      if (inSection.length === 0) continue;
      setup[section] = inSection.map((i) => ({
        id: i.id,
        refId: i.refId,
        config: i.config,
        sortOrder: i.sortOrder,
        materialisedAt: iso(i.materialisedAt),
      }));
    }
    const codes = await db
      .select({
        code: trainerInviteCodes.code,
        status: trainerInviteCodes.status,
        expiresAt: trainerInviteCodes.expiresAt,
      })
      .from(trainerInviteCodes)
      .where(
        and(
          eq(trainerInviteCodes.clientProfileId, row.id),
          eq(trainerInviteCodes.trainerId, row.trainerId),
        ),
      )
      .orderBy(desc(trainerInviteCodes.createdAt))
      .limit(1);
    const latest = codes[0];
    return {
      ...profileDto(row),
      setup,
      invite: latest
        ? {
            code: latest.code,
            link: inviteLink(latest.code),
            expiresAt: latest.expiresAt.toISOString(),
            status: inviteStatus(latest, new Date()),
          }
        : null,
    };
  }

  /** Run `fn` on the caller's locked, editable profile with a revision check. */
  private async editLocked(
    trainerId: string,
    profileId: string,
    expectedRevision: number | undefined,
    fn: (
      tx: DbOrTx,
      row: CoachClientProfile,
    ) => Promise<Refusal | Partial<CoachClientProfile> | void>,
  ): Promise<ClientProfileDetailDTO | Refusal> {
    return getDb()
      .transaction(async (tx) => {
        const row = await this.findOwned(trainerId, profileId, tx, true);
        if (!row) return { refused: "not_found" as const };
        if (
          expectedRevision !== undefined &&
          expectedRevision !== row.revision
        ) {
          return {
            refused: "revision_conflict" as const,
            current: await this.detailOf(row, tx),
          };
        }
        if (!EDITABLE.includes(row.status)) {
          return { refused: "not_editable" as const, status: row.status };
        }
        const result = await fn(tx, row);
        if (isRefusal(result)) {
          // Roll back any partial write the step made.
          throw new RefusalSignal(result);
        }
        const updated = await tx
          .update(coachClientProfiles)
          .set({
            ...(result ?? {}),
            revision: sql`${coachClientProfiles.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(coachClientProfiles.id, row.id))
          .returning();
        return this.detailOf(updated[0]!, tx);
      })
      .catch((err: unknown) => {
        if (err instanceof RefusalSignal) return err.refusal;
        throw err;
      });
  }

  async patch(
    trainerId: string,
    profileId: string,
    fields: ProfileFields,
    expectedRevision?: number,
  ): Promise<ClientProfileDetailDTO | Refusal> {
    return this.editLocked(trainerId, profileId, expectedRevision, async () => {
      const set: Partial<CoachClientProfile> = {};
      for (const key of [
        "displayName",
        "contactEmail",
        "contactPhone",
        "goal",
        "privateNotes",
      ] as const) {
        if (fields[key] !== undefined) {
          (set as Record<string, unknown>)[key] = fields[key];
        }
      }
      return set;
    });
  }

  /** Check every item through its section's handler. */
  private async validateSection(
    db: DbOrTx,
    trainerId: string,
    section: string,
    items: SetupItemInput[],
  ): Promise<SetupItemInput[] | Refusal> {
    if (!isSetupSection(section)) {
      return {
        refused: "invalid_setup",
        message: `Unknown section ${section}`,
      };
    }
    const handler = sectionHandler(section);
    if (!handler) return { refused: "section_unavailable", section };
    if (handler.maxItems !== undefined && items.length > handler.maxItems) {
      return {
        refused: "invalid_setup",
        message: `${section} takes at most ${handler.maxItems} item(s)`,
      };
    }
    const out: SetupItemInput[] = [];
    for (const item of items) {
      const verdict = await handler.validate(db, trainerId, item);
      if (!verdict.ok) {
        return { refused: "invalid_setup", message: verdict.message };
      }
      out.push(verdict.item);
    }
    const refs = out.map((i) => i.refId).filter(Boolean);
    if (new Set(refs).size !== refs.length) {
      return { refused: "invalid_setup", message: "Duplicate refId" };
    }
    return out;
  }

  private async writeSection(
    tx: DbOrTx,
    profileId: string,
    section: SetupSection,
    items: SetupItemInput[],
  ): Promise<void> {
    await tx
      .delete(coachClientSetupItems)
      .where(
        and(
          eq(coachClientSetupItems.profileId, profileId),
          eq(coachClientSetupItems.section, section),
        ),
      );
    if (items.length === 0) return;
    await tx.insert(coachClientSetupItems).values(
      items.map((item) => ({
        profileId,
        section,
        refId: item.refId ?? null,
        config: item.config,
        sortOrder: item.sortOrder,
      })),
    );
  }

  /** `PUT …/setup/:section` — replace that section. */
  async replaceSection(
    trainerId: string,
    profileId: string,
    section: string,
    items: SetupItemInput[],
    expectedRevision?: number,
  ): Promise<ClientProfileDetailDTO | Refusal> {
    return this.editLocked(
      trainerId,
      profileId,
      expectedRevision,
      async (tx, row) => {
        const valid = await this.validateSection(tx, trainerId, section, items);
        if (isRefusal(valid)) return valid;
        await this.writeSection(tx, row.id, section as SetupSection, valid);
      },
    );
  }

  /**
   * `POST …/setup/copy-from` — copy set-up from one of the caller's active
   * clients (through each live area's `copyFromClient`) or from another of
   * their profiles. Each copied section replaces that section here. Never
   * copies another coach's items: both sources are scoped to the caller.
   */
  async copyFrom(
    trainerId: string,
    profileId: string,
    source:
      | { kind: "client"; clientId: string }
      | { kind: "profile"; profileId: string },
    sections?: string[],
  ): Promise<ClientProfileDetailDTO | Refusal> {
    const wanted = (sections ?? [...SETUP_SECTIONS]).filter(isSetupSection);
    return this.editLocked(trainerId, profileId, undefined, async (tx, row) => {
      const bySection = new Map<SetupSection, SetupItemInput[]>();
      if (source.kind === "profile") {
        const from = await this.findOwned(trainerId, source.profileId, tx);
        if (!from || from.id === row.id) return { refused: "not_found" };
        for (const item of await this.items(from.id, tx)) {
          const section = item.section as SetupSection;
          if (!wanted.includes(section) || !sectionHandler(section)) continue;
          const list = bySection.get(section) ?? [];
          list.push({
            refId: item.refId,
            config: item.config,
            sortOrder: item.sortOrder,
          });
          bySection.set(section, list);
        }
      } else {
        for (const section of wanted) {
          const copied =
            (await sectionHandler(section)?.copyFromClient?.(
              tx,
              trainerId,
              source.clientId,
            )) ?? [];
          if (copied.length > 0) bySection.set(section, copied);
        }
      }
      for (const [section, items] of bySection) {
        const valid = await this.validateSection(tx, trainerId, section, items);
        if (isRefusal(valid)) return valid;
        await this.writeSection(tx, row.id, section, valid);
      }
    });
  }

  async preview(
    trainerId: string,
    profileId: string,
  ): Promise<AcceptPreview | null> {
    const row = await this.findOwned(trainerId, profileId);
    if (!row) return null;
    return buildAcceptPreview(getDb(), await this.items(row.id));
  }

  /**
   * `POST …/invite` — issue a personal code, or on resend expire the live one
   * and issue a new one (now + 7 days). A replayed Idempotency-Key returns the
   * code that request issued. A cancelled profile goes back to invited.
   * Role, declaration and seat checks are the handler's, before this runs.
   */
  async issueInvite(
    trainerId: string,
    profileId: string,
    clientRequestId: string | null,
  ): Promise<InviteDTO | Refusal> {
    return getDb().transaction(async (tx) => {
      await this.lockActiveCodes(tx, trainerId, profileId);
      const row = await this.findOwned(trainerId, profileId, tx, true);
      if (!row) return { refused: "not_found" as const };

      if (clientRequestId) {
        const replay = await tx
          .select()
          .from(trainerInviteCodes)
          .where(
            and(
              eq(trainerInviteCodes.trainerId, trainerId),
              eq(trainerInviteCodes.clientRequestId, clientRequestId),
              eq(trainerInviteCodes.clientProfileId, row.id),
            ),
          )
          .limit(1);
        if (replay[0]) {
          return {
            code: replay[0].code,
            link: inviteLink(replay[0].code),
            expiresAt: replay[0].expiresAt.toISOString(),
            status: inviteStatus(replay[0], new Date()),
          };
        }
      }

      if (!EDITABLE.includes(row.status)) {
        return { refused: "not_editable" as const, status: row.status };
      }

      await tx
        .update(trainerInviteCodes)
        .set({ status: "expired" })
        .where(
          and(
            eq(trainerInviteCodes.clientProfileId, row.id),
            eq(trainerInviteCodes.trainerId, trainerId),
            eq(trainerInviteCodes.status, "active"),
          ),
        );

      const expiresAt = new Date(Date.now() + PERSONAL_CODE_TTL_MS);
      let issued: { code: string; expiresAt: Date } | undefined;
      for (let attempt = 0; attempt < 5 && !issued; attempt++) {
        try {
          // A savepoint, so a code-value collision doesn't abort the outer tx.
          issued = await tx.transaction(async (sp) => {
            const inserted = await sp
              .insert(trainerInviteCodes)
              .values({
                trainerId,
                code: generateInviteCode(),
                status: "active",
                expiresAt,
                clientProfileId: row.id,
                clientRequestId,
              })
              .returning({
                code: trainerInviteCodes.code,
                expiresAt: trainerInviteCodes.expiresAt,
              });
            return inserted[0]!;
          });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }
      if (!issued) throw new Error("Failed to generate a unique invite code");

      await tx
        .update(coachClientProfiles)
        .set({
          status: "invited",
          cancelledAt: null,
          revision: sql`${coachClientProfiles.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(coachClientProfiles.id, row.id));

      return {
        code: issued.code,
        link: inviteLink(issued.code),
        expiresAt: issued.expiresAt.toISOString(),
        status: "active" as const,
      };
    });
  }

  /** `DELETE …/invite` — expire the code and cancel. Idempotent. */
  async cancelInvite(
    trainerId: string,
    profileId: string,
  ): Promise<true | Refusal> {
    return getDb().transaction(async (tx) => {
      await this.lockActiveCodes(tx, trainerId, profileId);
      const row = await this.findOwned(trainerId, profileId, tx, true);
      if (!row) return { refused: "not_found" as const };
      if (!EDITABLE.includes(row.status)) {
        return { refused: "not_editable" as const, status: row.status };
      }
      await this.expireCodes(tx, trainerId, row.id);
      if (row.status !== "cancelled") {
        await tx
          .update(coachClientProfiles)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            revision: sql`${coachClientProfiles.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(coachClientProfiles.id, row.id));
      }
      return true as const;
    });
  }

  /**
   * `DELETE …/:id` — only while invited or cancelled. Already deleted → true
   * (idempotent); never the caller's → not_found.
   */
  async remove(trainerId: string, profileId: string): Promise<true | Refusal> {
    if (!isUuid(profileId)) return { refused: "not_found" };
    return getDb().transaction(async (tx) => {
      await this.lockActiveCodes(tx, trainerId, profileId);
      const rows = await tx
        .select()
        .from(coachClientProfiles)
        .where(
          and(
            eq(coachClientProfiles.id, profileId),
            eq(coachClientProfiles.trainerId, trainerId),
          ),
        )
        .for("update")
        .limit(1);
      const row = rows[0];
      if (!row) return { refused: "not_found" as const };
      if (row.deletedAt) return true as const;
      if (!EDITABLE.includes(row.status)) {
        return { refused: "not_editable" as const, status: row.status };
      }
      await this.expireCodes(tx, trainerId, row.id);
      await tx
        .update(coachClientProfiles)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(coachClientProfiles.id, row.id));
      return true as const;
    });
  }

  /**
   * ⚠ Lock order. The accept path (`acceptPersonalCode`) can only find the
   * profile through its code, so it locks the CODE row first and the PROFILE
   * second. Every write here that touches both — resend, cancel, delete — must
   * take them in the same order, or a coach tapping one of them while the
   * athlete redeems can deadlock (40P01 → a 500 to one side). So: lock this
   * profile's live codes, then the profile.
   */
  private async lockActiveCodes(
    tx: DbOrTx,
    trainerId: string,
    profileId: string,
  ): Promise<void> {
    if (!isUuid(profileId)) return;
    await tx
      .select({ id: trainerInviteCodes.id })
      .from(trainerInviteCodes)
      .where(
        and(
          eq(trainerInviteCodes.clientProfileId, profileId),
          eq(trainerInviteCodes.trainerId, trainerId),
          eq(trainerInviteCodes.status, "active"),
        ),
      )
      .for("update");
  }

  private async expireCodes(
    tx: DbOrTx,
    trainerId: string,
    profileId: string,
  ): Promise<void> {
    await tx
      .update(trainerInviteCodes)
      .set({ status: "expired" })
      .where(
        and(
          eq(trainerInviteCodes.clientProfileId, profileId),
          eq(trainerInviteCodes.trainerId, trainerId),
          eq(trainerInviteCodes.status, "active"),
        ),
      );
  }

  /** The roster's `invited` sibling field on `GET /trainers/me/clients`. */
  async invitedSummaries(trainerId: string): Promise<InvitedClientSummary[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(coachClientProfiles)
      .where(
        and(
          eq(coachClientProfiles.trainerId, trainerId),
          eq(coachClientProfiles.status, "invited"),
          isNull(coachClientProfiles.deletedAt),
        ),
      )
      .orderBy(desc(coachClientProfiles.createdAt));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const counts = await db
      .select({ profileId: coachClientSetupItems.profileId, n: count() })
      .from(coachClientSetupItems)
      .where(inArray(coachClientSetupItems.profileId, ids))
      .groupBy(coachClientSetupItems.profileId);
    const codes = await db
      .select({
        profileId: trainerInviteCodes.clientProfileId,
        status: trainerInviteCodes.status,
        expiresAt: trainerInviteCodes.expiresAt,
      })
      .from(trainerInviteCodes)
      .where(
        and(
          eq(trainerInviteCodes.trainerId, trainerId),
          inArray(trainerInviteCodes.clientProfileId, ids),
        ),
      )
      .orderBy(desc(trainerInviteCodes.createdAt));

    const now = new Date();
    return rows.map((r) => {
      const latest = codes.find((c) => c.profileId === r.id);
      return {
        profileId: r.id,
        displayName: r.displayName,
        goal: r.goal,
        inviteExpiresAt: latest ? latest.expiresAt.toISOString() : null,
        inviteStatus: latest ? inviteStatus(latest, now) : "not_sent",
        readyCount: Number(counts.find((c) => c.profileId === r.id)?.n ?? 0),
      };
    });
  }

  /**
   * Retention (design A D1): a profile that was never accepted holds a
   * non-user's contact details, so 90 days after it was cancelled or its last
   * code expired — or, if no code was ever issued, 90 days after it was
   * created — the personal data goes. Accepted profiles are never touched.
   *
   * Two phases, so offline devices hear about it (Inspector Brad, #540):
   *   A. a visible profile past the window is TOMBSTONED (`deleted_at`) and
   *      its personal fields are scrubbed at once, so a coach's phone syncing
   *      with `?since=` gets its id in `deletedIds`;
   *   B. a tombstone older than `TOMBSTONE_SYNC_DAYS` is hard-deleted. That
   *      also covers profiles the coach deleted themselves.
   */
  async purgeUnaccepted(
    now: Date,
  ): Promise<{ tombstoned: number; purged: number }> {
    const day = 24 * 60 * 60 * 1000;
    const cutoff = new Date(
      now.getTime() - UNACCEPTED_PROFILE_RETENTION_DAYS * day,
    );
    const tombstoneCutoff = new Date(now.getTime() - TOMBSTONE_SYNC_DAYS * day);
    const neverAccepted = and(
      isNull(coachClientProfiles.acceptedAt),
      isNull(coachClientProfiles.relationshipId),
      inArray(coachClientProfiles.status, ["invited", "cancelled"]),
    );
    // GREATEST ignores NULLs: the latest of created, cancelled and the last
    // code's expiry must be older than the cutoff.
    const lastCodeExpiry = sql`(
      SELECT max(${trainerInviteCodes.expiresAt}) FROM ${trainerInviteCodes}
       WHERE ${trainerInviteCodes.clientProfileId} = ${coachClientProfiles.id}
    )`;
    const db = getDb();

    const tombstoned = await db
      .update(coachClientProfiles)
      .set({
        deletedAt: now,
        updatedAt: now,
        displayName: SCRUBBED_DISPLAY_NAME,
        contactEmail: null,
        contactPhone: null,
        goal: null,
        privateNotes: null,
      })
      .where(
        and(
          neverAccepted,
          isNull(coachClientProfiles.deletedAt),
          lt(
            sql`GREATEST(${coachClientProfiles.createdAt}, ${coachClientProfiles.cancelledAt}, ${lastCodeExpiry})`,
            cutoff,
          ),
        ),
      )
      .returning({ id: coachClientProfiles.id });

    const purged = await db
      .delete(coachClientProfiles)
      .where(
        and(
          neverAccepted,
          isNotNull(coachClientProfiles.deletedAt),
          lt(coachClientProfiles.deletedAt, tombstoneCutoff),
        ),
      )
      .returning({ id: coachClientProfiles.id });

    return { tombstoned: tombstoned.length, purged: purged.length };
  }
}

class RefusalSignal extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) {
    super(refusal.refused);
    this.refusal = refusal;
  }
}

export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
