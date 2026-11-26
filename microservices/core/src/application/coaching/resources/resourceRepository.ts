import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  coachClientSettings,
  coachResourceAssignments,
  coachResources,
  privateMedia,
  profiles,
  ptClientRelationships,
  type CoachResource,
  type CoachResourceAssignment,
  type CoachResourceKind,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";
import { stripNul } from "../../shared/stripNul";
import { finaliseMedia } from "../../media/privateMediaRepository";
import { presignView, type ViewLink } from "../../media/privateMediaStore";
import { resolveFeatures } from "../clientSettings";

/**
 * The coach resources library and its assignments (PER-122, BE-I1, backend
 * design I resources part: C3.7, C5b, the athlete's resources).
 *
 * Every coach read and write is scoped to `trainer_id = caller`; assignments
 * also to the caller's own relationship with the client, so coach A never
 * sees or changes coach B's resources or assignments for the same athlete.
 * Athlete reads are scoped to `client_id = caller` and only return
 * assignments on an ACTIVE relationship whose coach account isn't deleted,
 * while that coach has the client's C3.9 `resources` switch on (PER-150).
 */

export const TITLE_MAX = 120;
export const URL_MAX = 2000;
/** Bulk assign bounds (one request from Library → Resources). */
export const MAX_ASSIGN_RESOURCES = 50;
export const MAX_ASSIGN_CLIENTS = 50;

// ─── DTOs (the response shapes APP-I1 / PER-143 reads) ──────────────────────

/** A library resource as the coach sees it. */
export interface ResourceDTO {
  id: string;
  kind: CoachResourceKind;
  title: string;
  /** Links only. */
  url: string | null;
  /** Files only: the coach opens it with `GET /users/me/media/:mediaId`. */
  mediaId: string | null;
  mime: string | null;
  bytes: number | null;
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One assignment on the coach's client Resources tab (C3.7). */
export interface ClientResourceDTO {
  assignmentId: string;
  clientId: string;
  resource: ResourceDTO;
  assignedAt: string;
  openedAt: string | null;
}

/** One resource in the athlete's Coach tab. */
export interface AthleteResourceDTO {
  assignmentId: string;
  resourceId: string;
  kind: CoachResourceKind;
  title: string;
  /** Links: the https url. Files: a short-lived signed link (null if the file is gone). */
  url: string | null;
  /** Files only: when `url` stops working; list again for a fresh one. */
  urlExpiresAt: string | null;
  mime: string | null;
  bytes: number | null;
  coach: { id: string; name: string; avatarUrl: string | null };
  assignedAt: string;
  openedAt: string | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function resourceDto(r: CoachResource): ResourceDTO {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    mediaId: r.mediaId,
    mime: r.mime,
    bytes: r.bytes,
    revision: r.revision,
    archivedAt: iso(r.archivedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function clientResourceDto(
  a: CoachResourceAssignment,
  r: CoachResource,
): ClientResourceDTO {
  return {
    assignmentId: a.id,
    clientId: a.clientId,
    resource: resourceDto(r),
    assignedAt: a.assignedAt.toISOString(),
    openedAt: iso(a.openedAt),
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type FieldError = { at: string; message: string };

export function cleanTitle(raw: string): string | null {
  const title = stripNul(raw).trim();
  return title.length >= 1 && title.length <= TITLE_MAX ? title : null;
}

/** An absolute https URL with a host, at most URL_MAX characters. */
export function cleanUrl(raw: string): string | null {
  const text = stripNul(raw).trim();
  if (text.length === 0 || text.length > URL_MAX) return null;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname === "") return null;
  // `https:example.com` parses too; only the full `https://` form is kept,
  // with the scheme lower-cased (the column's CHECK is case-sensitive).
  if (!text.toLowerCase().startsWith("https://")) return null;
  return `https://${text.slice("https://".length)}`;
}

export interface CreateInput {
  kind: CoachResourceKind;
  title: string;
  url?: string | null;
  mediaId?: string | null;
}

export type CreateValidation =
  | {
      ok: true;
      value: {
        kind: CoachResourceKind;
        title: string;
        url: string | null;
        mediaId: string | null;
      };
    }
  | { ok: false; errors: FieldError[] };

export function validateCreate(input: CreateInput): CreateValidation {
  const errors: FieldError[] = [];
  const title = cleanTitle(input.title);
  if (!title) {
    errors.push({ at: "title", message: `must be 1–${TITLE_MAX} characters` });
  }
  let url: string | null = null;
  let mediaId: string | null = null;
  if (input.kind === "link") {
    url = input.url ? cleanUrl(input.url) : null;
    if (!url) errors.push({ at: "url", message: "must be an https link" });
    if (input.mediaId) {
      errors.push({ at: "mediaId", message: "a link has no file" });
    }
  } else {
    mediaId = input.mediaId ?? null;
    if (!mediaId) {
      errors.push({ at: "mediaId", message: "must be your uploaded file" });
    }
    if (input.url) errors.push({ at: "url", message: "a file has no link" });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { kind: input.kind, title: title!, url, mediaId } };
}

// ─── Files ───────────────────────────────────────────────────────────────────

export type FileCheck =
  | { ok: true; mediaId: string; mime: string; bytes: number }
  | { ok: false; status: 404 | 422; code: string; reason?: string };

/**
 * The coach's own `resource` upload, checked with HeadObject and marked ready
 * (design F's `finaliseMedia`). Runs outside any transaction (no S3 call
 * while a row is locked).
 */
export async function checkResourceFile(
  trainerId: string,
  mediaId: string,
): Promise<FileCheck> {
  const result = await finaliseMedia(trainerId, mediaId, "resource");
  if (result.ok) {
    return {
      ok: true,
      mediaId: result.media.id,
      mime: result.media.contentType,
      bytes: result.media.bytes,
    };
  }
  if (result.reason === "not_found") {
    return { ok: false, status: 404, code: "media_not_found" };
  }
  return {
    ok: false,
    status: 422,
    code: "upload_incomplete",
    reason: result.reason,
  };
}

// ─── Library ─────────────────────────────────────────────────────────────────

async function findByClientRequest(
  db: DbOrTx,
  trainerId: string,
  key: string,
): Promise<CoachResource | null> {
  const rows = await db
    .select()
    .from(coachResources)
    .where(
      and(
        eq(coachResources.trainerId, trainerId),
        eq(coachResources.clientRequestId, key),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The caller's live (unarchived) resource. */
export async function getOwnLive(
  db: DbOrTx,
  trainerId: string,
  resourceId: string,
): Promise<CoachResource | null> {
  const rows = await db
    .select()
    .from(coachResources)
    .where(
      and(
        eq(coachResources.id, resourceId),
        eq(coachResources.trainerId, trainerId),
        isNull(coachResources.archivedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The caller's library; with `since`, the changes and archived ids. */
export async function listLibrary(
  trainerId: string,
  since: Date | null,
): Promise<{ resources: ResourceDTO[]; deletedIds: string[] }> {
  const rows = await getDb()
    .select()
    .from(coachResources)
    .where(
      and(
        eq(coachResources.trainerId, trainerId),
        since
          ? gt(coachResources.updatedAt, since)
          : isNull(coachResources.archivedAt),
      ),
    )
    .orderBy(desc(coachResources.createdAt), asc(coachResources.id));
  return {
    resources: rows.filter((r) => r.archivedAt === null).map(resourceDto),
    deletedIds: rows.filter((r) => r.archivedAt !== null).map((r) => r.id),
  };
}

/**
 * Peek at a replayed create before doing any S3 work: a retried create
 * returns the first resource.
 */
export async function findReplay(
  trainerId: string,
  key: string | null,
): Promise<ResourceDTO | null> {
  if (!key) return null;
  const row = await findByClientRequest(getDb(), trainerId, key);
  return row ? resourceDto(row) : null;
}

export async function createResource(
  trainerId: string,
  value: {
    kind: CoachResourceKind;
    title: string;
    url: string | null;
    file: { mediaId: string; mime: string; bytes: number } | null;
  },
  clientRequestId: string | null,
): Promise<{ resource: ResourceDTO; replay: boolean }> {
  const db = getDb();
  const inserted = await db
    .insert(coachResources)
    .values({
      trainerId,
      kind: value.kind,
      title: value.title,
      url: value.url,
      mediaId: value.file?.mediaId ?? null,
      mime: value.file?.mime ?? null,
      bytes: value.file?.bytes ?? null,
      clientRequestId,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return { resource: resourceDto(inserted[0]), replay: false };
  // Only the (trainer_id, client_request_id) index can conflict: a racing
  // request with the same key won.
  const winner = await findByClientRequest(db, trainerId, clientRequestId!);
  return { resource: resourceDto(winner!), replay: true };
}

export type PatchResult =
  | { ok: true; resource: ResourceDTO }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "revision_conflict"; current: ResourceDTO }
  | { ok: false; reason: "invalid"; errors: FieldError[] };

/**
 * Edit title, a link's url, or a file's upload. `expectedRevision` (optional;
 * absent = last write wins) guards offline edits.
 */
export async function patchResource(
  trainerId: string,
  resourceId: string,
  patch: {
    title?: string;
    url?: string;
    file?: { mediaId: string; mime: string; bytes: number };
  },
  expectedRevision?: number,
): Promise<PatchResult> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(coachResources)
      .where(
        and(
          eq(coachResources.id, resourceId),
          eq(coachResources.trainerId, trainerId),
          isNull(coachResources.archivedAt),
        ),
      )
      .limit(1)
      .for("update");
    const current = rows[0];
    if (!current) return { ok: false, reason: "not_found" };
    if (
      expectedRevision !== undefined &&
      expectedRevision !== current.revision
    ) {
      return {
        ok: false,
        reason: "revision_conflict",
        current: resourceDto(current),
      };
    }
    const errors: FieldError[] = [];
    if (patch.url !== undefined && current.kind !== "link") {
      errors.push({ at: "url", message: "a file has no link" });
    }
    if (patch.file !== undefined && current.kind !== "file") {
      errors.push({ at: "mediaId", message: "a link has no file" });
    }
    if (errors.length > 0) return { ok: false, reason: "invalid", errors };
    const updated = await tx
      .update(coachResources)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.file
          ? {
              mediaId: patch.file.mediaId,
              mime: patch.file.mime,
              bytes: patch.file.bytes,
            }
          : {}),
        revision: sql`${coachResources.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(coachResources.id, resourceId))
      .returning();
    return { ok: true, resource: resourceDto(updated[0]!) };
  });
}

/**
 * Remove from the library (archive). Its assignments stop showing to
 * clients (they come back in `deletedIds`). Idempotent: an archived or
 * unknown id is fine.
 */
export async function archiveResource(
  trainerId: string,
  resourceId: string,
): Promise<void> {
  const now = new Date();
  await getDb()
    .update(coachResources)
    .set({
      archivedAt: now,
      revision: sql`${coachResources.revision} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(coachResources.id, resourceId),
        eq(coachResources.trainerId, trainerId),
        isNull(coachResources.archivedAt),
      ),
    );
}

// ─── Assignments ─────────────────────────────────────────────────────────────

export interface AssignTarget {
  clientId: string;
  relationshipId: string;
}

/**
 * Give each resource to each client, inside `db` (a transaction for bulk
 * assign; the accept transaction for set-up). Idempotent: a live assignment
 * of the same resource on the same relationship is returned as it is.
 * The caller has already checked every resource is its own live one and
 * every relationship is its own active one.
 */
export async function assignInTx(
  db: DbOrTx,
  trainerId: string,
  resources: CoachResource[],
  targets: AssignTarget[],
  clientRequestId: string | null,
): Promise<{ assignments: ClientResourceDTO[]; created: number }> {
  if (resources.length === 0 || targets.length === 0) {
    return { assignments: [], created: 0 };
  }
  const now = new Date();
  const inserted = await db
    .insert(coachResourceAssignments)
    .values(
      targets.flatMap((t) =>
        resources.map((r) => ({
          resourceId: r.id,
          trainerId,
          clientId: t.clientId,
          relationshipId: t.relationshipId,
          assignedAt: now,
          clientRequestId,
        })),
      ),
    )
    // Target-less: matches the partial live index.
    .onConflictDoNothing()
    .returning({ id: coachResourceAssignments.id });
  const live = await db
    .select()
    .from(coachResourceAssignments)
    .where(
      and(
        eq(coachResourceAssignments.trainerId, trainerId),
        inArray(
          coachResourceAssignments.relationshipId,
          targets.map((t) => t.relationshipId),
        ),
        inArray(
          coachResourceAssignments.resourceId,
          resources.map((r) => r.id),
        ),
        isNull(coachResourceAssignments.removedAt),
      ),
    )
    .orderBy(
      asc(coachResourceAssignments.clientId),
      asc(coachResourceAssignments.assignedAt),
      asc(coachResourceAssignments.id),
    );
  const byId = new Map(resources.map((r) => [r.id, r]));
  return {
    assignments: live.map((a) => clientResourceDto(a, byId.get(a.resourceId)!)),
    created: inserted.length,
  };
}

/** The caller's live resources among `ids` (missing ones are left out). */
export async function ownLiveResources(
  trainerId: string,
  ids: string[],
  db: DbOrTx = getDb(),
): Promise<CoachResource[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(coachResources)
    .where(
      and(
        eq(coachResources.trainerId, trainerId),
        inArray(coachResources.id, ids),
        isNull(coachResources.archivedAt),
      ),
    );
}

export type BulkAssignResult =
  | { ok: true; assignments: ClientResourceDTO[]; created: number }
  /** These clients' relationships ended after the handler's check. */
  | { ok: false; endedClientIds: string[] };

/**
 * Bulk assign in one transaction. The target relationships are locked
 * `FOR UPDATE` and re-checked as this trainer's ACTIVE ones first, so an
 * ending that commits between the handler's `resolveCoachScope` and the
 * insert can't leave a live assignment on an ended relationship (offboarding
 * updates the same row, so it waits for this, or this waits for it and sees
 * it ended). If any target ended, nothing is assigned (Inspector Brad, #563).
 */
export async function bulkAssign(
  trainerId: string,
  resources: CoachResource[],
  targets: AssignTarget[],
  clientRequestId: string | null,
): Promise<BulkAssignResult> {
  return getDb().transaction(async (tx) => {
    const locked =
      targets.length === 0
        ? []
        : await tx
            .select({
              id: ptClientRelationships.id,
              clientId: ptClientRelationships.clientId,
            })
            .from(ptClientRelationships)
            .where(
              and(
                inArray(
                  ptClientRelationships.id,
                  targets.map((t) => t.relationshipId),
                ),
                eq(ptClientRelationships.trainerId, trainerId),
                eq(ptClientRelationships.status, "active"),
              ),
            )
            .orderBy(asc(ptClientRelationships.id))
            .for("update");
    const active = new Set(locked.map((r) => `${r.id}:${r.clientId}`));
    const ended = targets
      .filter((t) => !active.has(`${t.relationshipId}:${t.clientId}`))
      .map((t) => t.clientId);
    if (ended.length > 0) return { ok: false, endedClientIds: ended };
    const result = await assignInTx(
      tx,
      trainerId,
      resources,
      targets,
      clientRequestId,
    );
    return { ok: true, ...result };
  });
}

/** The client's Resources tab (C3.7): this coach's live assignments. */
export async function listClientResources(scope: {
  trainerId: string;
  relationshipId: string;
}): Promise<ClientResourceDTO[]> {
  const rows = await getDb()
    .select({ a: coachResourceAssignments, r: coachResources })
    .from(coachResourceAssignments)
    .innerJoin(
      coachResources,
      eq(coachResources.id, coachResourceAssignments.resourceId),
    )
    .where(
      and(
        eq(coachResourceAssignments.trainerId, scope.trainerId),
        eq(coachResourceAssignments.relationshipId, scope.relationshipId),
        eq(coachResources.trainerId, scope.trainerId),
        isNull(coachResourceAssignments.removedAt),
        isNull(coachResources.archivedAt),
      ),
    )
    .orderBy(
      desc(coachResourceAssignments.assignedAt),
      asc(coachResourceAssignments.id),
    );
  return rows.map((row) => clientResourceDto(row.a, row.r));
}

/** Remove one of this coach's assignments for this client. Idempotent. */
export async function removeAssignment(
  scope: { trainerId: string; relationshipId: string },
  assignmentId: string,
): Promise<void> {
  await getDb()
    .update(coachResourceAssignments)
    .set({ removedAt: new Date() })
    .where(
      and(
        eq(coachResourceAssignments.id, assignmentId),
        eq(coachResourceAssignments.trainerId, scope.trainerId),
        eq(coachResourceAssignments.relationshipId, scope.relationshipId),
        isNull(coachResourceAssignments.removedAt),
      ),
    );
}

/**
 * Ending coaching (design I): this coach's live assignments on this
 * relationship are removed, inside the offboarding transaction, so a revived
 * relationship doesn't make them visible again. The resources stay in the
 * coach's library.
 */
export async function removeResourceAssignmentsForRelationship(
  tx: DbOrTx,
  relationshipId: string,
  trainerId: string,
): Promise<number> {
  const rows = await tx
    .update(coachResourceAssignments)
    .set({ removedAt: new Date() })
    .where(
      and(
        eq(coachResourceAssignments.relationshipId, relationshipId),
        eq(coachResourceAssignments.trainerId, trainerId),
        isNull(coachResourceAssignments.removedAt),
      ),
    )
    .returning({ id: coachResourceAssignments.id });
  return rows.length;
}

// ─── Athlete ─────────────────────────────────────────────────────────────────

/**
 * The assignment's coach's C3.9 settings row for this client. LEFT JOINed: a
 * relationship with no settings row yet has every switch on.
 */
const settingsOfAssignment = and(
  eq(
    coachClientSettings.relationshipId,
    coachResourceAssignments.relationshipId,
  ),
  eq(coachClientSettings.trainerId, coachResourceAssignments.trainerId),
);

/**
 * The client's C3.9 `resources` switch for that coach is on (PER-150). Off
 * only when stored as `false`; a missing row or key means on, exactly as
 * `resolveFeatures` reads it. Needs `settingsOfAssignment` joined.
 */
const resourcesSwitchOn = sql`(${coachClientSettings.features} -> 'resources') IS DISTINCT FROM 'false'::jsonb`;

/**
 * The athlete's visibility rule, shared by the list, the opened stamp and
 * the `/users/me/coaching` count: the caller's own live assignment of a live
 * resource, on an ACTIVE relationship with that coach, whose account isn't
 * deleted, with the client's `resources` switch on for that coach. Needs
 * resources, relationships, the coach's profile and `settingsOfAssignment`
 * joined.
 */
function visibleToAthlete(clientId: string) {
  return and(
    eq(coachResourceAssignments.clientId, clientId),
    isNull(coachResourceAssignments.removedAt),
    isNull(coachResources.archivedAt),
    eq(coachResources.trainerId, coachResourceAssignments.trainerId),
    eq(ptClientRelationships.status, "active"),
    eq(ptClientRelationships.trainerId, coachResourceAssignments.trainerId),
    eq(ptClientRelationships.clientId, clientId),
    isNull(profiles.deletedAt),
    resourcesSwitchOn,
  );
}

/**
 * `GET /users/me/coaching`'s `resources` (PER-150): how many resources each
 * coach has given the caller that `GET /users/me/resources` would show now,
 * by relationship id. Relationships with none are absent.
 */
export async function countAthleteResources(
  clientId: string,
): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({
      relationshipId: coachResourceAssignments.relationshipId,
      n: count(),
    })
    .from(coachResourceAssignments)
    .innerJoin(
      coachResources,
      eq(coachResources.id, coachResourceAssignments.resourceId),
    )
    .innerJoin(
      ptClientRelationships,
      eq(ptClientRelationships.id, coachResourceAssignments.relationshipId),
    )
    .innerJoin(profiles, eq(profiles.id, coachResourceAssignments.trainerId))
    .leftJoin(coachClientSettings, settingsOfAssignment)
    .where(visibleToAthlete(clientId))
    .groupBy(coachResourceAssignments.relationshipId);
  return new Map(rows.map((r) => [r.relationshipId, Number(r.n)]));
}

/**
 * `GET /users/me/resources`: from every active coach, newest first, with the
 * coach's name and a short-lived link for files. With `since`, only what
 * changed, and `deletedIds` (assignment ids) for anything no longer visible:
 * removed, archived, coaching ended, the coach's account deleted, or the
 * coach switched the client's Resources off (C3.9, PER-150). Switching it
 * back on brings them back on the next delta (the settings row's
 * `updated_at` moves).
 */
export async function listAthleteResources(
  clientId: string,
  since: Date | null,
  linkSeconds: number,
  now = new Date(),
): Promise<{ resources: AthleteResourceDTO[]; deletedIds: string[] }> {
  const rows = await getDb()
    .select({
      a: coachResourceAssignments,
      r: coachResources,
      relStatus: ptClientRelationships.status,
      relTrainer: ptClientRelationships.trainerId,
      relClient: ptClientRelationships.clientId,
      coachName: profiles.fullName,
      coachAvatar: profiles.avatarUrl,
      coachDeletedAt: profiles.deletedAt,
      mediaKey: privateMedia.s3Key,
      mediaStatus: privateMedia.status,
      mediaOwner: privateMedia.ownerId,
      features: coachClientSettings.features,
    })
    .from(coachResourceAssignments)
    .innerJoin(
      coachResources,
      eq(coachResources.id, coachResourceAssignments.resourceId),
    )
    .innerJoin(
      ptClientRelationships,
      eq(ptClientRelationships.id, coachResourceAssignments.relationshipId),
    )
    .innerJoin(profiles, eq(profiles.id, coachResourceAssignments.trainerId))
    .leftJoin(privateMedia, eq(privateMedia.id, coachResources.mediaId))
    .leftJoin(coachClientSettings, settingsOfAssignment)
    .where(
      since
        ? and(
            eq(coachResourceAssignments.clientId, clientId),
            or(
              gt(coachResourceAssignments.assignedAt, since),
              gt(coachResourceAssignments.removedAt, since),
              gt(coachResourceAssignments.openedAt, since),
              gt(coachResources.updatedAt, since),
              gt(ptClientRelationships.updatedAt, since),
              // Soft-delete and restore of the coach only touch profiles.
              gt(profiles.updatedAt, since),
              // The C3.9 switches live on the settings row.
              gt(coachClientSettings.updatedAt, since),
              // Every visible FILE comes back on each delta too: its signed
              // link lasts 15 minutes, so an offline-first cache would
              // otherwise keep a dead URL (Inspector Brad, #563). Links
              // don't expire and only come back when they change.
              and(
                eq(coachResources.kind, "file"),
                isNull(coachResourceAssignments.removedAt),
                isNull(coachResources.archivedAt),
                eq(ptClientRelationships.status, "active"),
                isNull(profiles.deletedAt),
                resourcesSwitchOn,
              ),
            ),
          )
        : visibleToAthlete(clientId),
    )
    .orderBy(
      desc(coachResourceAssignments.assignedAt),
      asc(coachResourceAssignments.id),
    );

  const visible = rows.filter(
    (row) =>
      row.a.removedAt === null &&
      row.r.archivedAt === null &&
      row.r.trainerId === row.a.trainerId &&
      row.relStatus === "active" &&
      row.relTrainer === row.a.trainerId &&
      row.relClient === clientId &&
      row.coachDeletedAt === null &&
      resolveFeatures(row.features).resources,
  );
  const visibleIds = new Set(visible.map((row) => row.a.id));
  const deletedIds = since
    ? rows.filter((row) => !visibleIds.has(row.a.id)).map((row) => row.a.id)
    : [];

  const resources: AthleteResourceDTO[] = [];
  for (const row of visible) {
    let link: ViewLink | null = null;
    if (
      row.r.kind === "file" &&
      row.mediaKey &&
      row.mediaStatus === "ready" &&
      row.mediaOwner === row.a.trainerId
    ) {
      link = await presignView(row.mediaKey, linkSeconds, now);
    }
    resources.push({
      assignmentId: row.a.id,
      resourceId: row.r.id,
      kind: row.r.kind,
      title: row.r.title,
      url: row.r.kind === "link" ? row.r.url : (link?.url ?? null),
      urlExpiresAt: link?.expiresAt ?? null,
      mime: row.r.mime,
      bytes: row.r.bytes,
      coach: {
        id: row.a.trainerId,
        name: row.coachName ?? "Your coach",
        avatarUrl: row.coachAvatar,
      },
      assignedAt: row.a.assignedAt.toISOString(),
      openedAt: iso(row.a.openedAt),
    });
  }
  return { resources, deletedIds };
}

/**
 * `POST /users/me/resources/:assignmentId/opened`: stamps `opened_at` the
 * first time; later calls keep the first stamp. Null when the assignment
 * isn't one the caller can see (including while that coach has the client's
 * Resources switched off, PER-150).
 */
export async function markOpened(
  clientId: string,
  assignmentId: string,
  now = new Date(),
): Promise<{ assignmentId: string; openedAt: string } | null> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ a: coachResourceAssignments })
      .from(coachResourceAssignments)
      .innerJoin(
        coachResources,
        eq(coachResources.id, coachResourceAssignments.resourceId),
      )
      .innerJoin(
        ptClientRelationships,
        eq(ptClientRelationships.id, coachResourceAssignments.relationshipId),
      )
      .innerJoin(profiles, eq(profiles.id, coachResourceAssignments.trainerId))
      .leftJoin(coachClientSettings, settingsOfAssignment)
      .where(
        and(
          eq(coachResourceAssignments.id, assignmentId),
          visibleToAthlete(clientId),
        ),
      )
      .limit(1)
      .for("update", { of: coachResourceAssignments });
    const row = rows[0]?.a;
    if (!row) return null;
    if (row.openedAt) {
      return { assignmentId: row.id, openedAt: row.openedAt.toISOString() };
    }
    await tx
      .update(coachResourceAssignments)
      .set({ openedAt: now })
      .where(
        and(
          eq(coachResourceAssignments.id, row.id),
          isNull(coachResourceAssignments.openedAt),
        ),
      );
    return { assignmentId: row.id, openedAt: now.toISOString() };
  });
}
