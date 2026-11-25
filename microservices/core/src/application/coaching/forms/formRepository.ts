import { COACH_FORM_LIMITS } from "@persistence/form-limits";
import { and, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  coachFormVersions,
  coachForms,
  type CoachForm,
  type CoachFormVersion,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";
import { stripNul } from "../../shared/stripNul";
import type { Question } from "./questions";

/**
 * The coach's forms library and its immutable versions (PER-116, design C
 * D1/D3). Every read and write is scoped to `trainer_id = caller`; templates
 * (`trainer_id IS NULL`) are readable by every coach and copied, never edited.
 */

export interface FormVersionDTO {
  id: string;
  version: number;
  questions: Question[];
  createdAt: string;
}

export interface FormDTO {
  id: string;
  title: string;
  description: string | null;
  templateKey: string | null;
  available: boolean;
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: FormVersionDTO | null;
}

export function versionDto(v: CoachFormVersion): FormVersionDTO {
  return {
    id: v.id,
    version: v.version,
    questions: v.questions as Question[],
    createdAt: v.createdAt.toISOString(),
  };
}

export function formDto(
  form: CoachForm,
  version: CoachFormVersion | null,
): FormDTO {
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    templateKey: form.templateKey,
    available: form.available,
    revision: form.revision,
    archivedAt: form.archivedAt ? form.archivedAt.toISOString() : null,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
    version: version ? versionDto(version) : null,
  };
}

/** Lists hand back `asOf` a little behind the clock (writes still open). */
const AS_OF_MARGIN_MS = 2 * 60 * 1000;
export function listAsOf(now = new Date()): string {
  return new Date(now.getTime() - AS_OF_MARGIN_MS).toISOString();
}

export const TITLE_MAX = COACH_FORM_LIMITS.titleMax;
export const DESCRIPTION_MAX = 1000;

export function cleanTitle(raw: string): string | null {
  const title = stripNul(raw).trim();
  return title.length >= 1 && title.length <= TITLE_MAX ? title : null;
}

export function cleanDescription(
  raw: string | null | undefined,
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const text = stripNul(raw).trim();
  return text.length === 0 ? null : text;
}

type Row = { form: CoachForm; version: CoachFormVersion | null };

export class CoachFormRepository {
  private readonly db: DbOrTx;

  constructor(db: DbOrTx = getDb()) {
    this.db = db;
  }

  private async withVersions(
    where: ReturnType<typeof and>,
    db: DbOrTx = this.db,
  ): Promise<Row[]> {
    return db
      .select({ form: coachForms, version: coachFormVersions })
      .from(coachForms)
      .leftJoin(
        coachFormVersions,
        eq(coachFormVersions.id, coachForms.currentVersionId),
      )
      .where(where)
      .orderBy(desc(coachForms.updatedAt), coachForms.id);
  }

  /** The caller's library; with `since`, changes and archived ids. */
  async list(
    trainerId: string,
    since?: Date,
  ): Promise<{ forms: FormDTO[]; deletedIds: string[] }> {
    const rows = await this.withVersions(
      and(
        eq(coachForms.trainerId, trainerId),
        since ? gt(coachForms.updatedAt, since) : isNull(coachForms.archivedAt),
      ),
    );
    return {
      forms: rows
        .filter((r) => r.form.archivedAt === null)
        .map((r) => formDto(r.form, r.version)),
      deletedIds: rows
        .filter((r) => r.form.archivedAt !== null)
        .map((r) => r.form.id),
    };
  }

  /** System templates. None ship yet (Brad, 20 Nov): this is empty. */
  async templates(): Promise<FormDTO[]> {
    const rows = await this.withVersions(
      and(
        isNull(coachForms.trainerId),
        isNotNull(coachForms.templateKey),
        isNull(coachForms.archivedAt),
        eq(coachForms.available, true),
      ),
    );
    return rows.map((r) => formDto(r.form, r.version));
  }

  /** The caller's form, or a template. Archived forms are still readable. */
  async get(
    trainerId: string,
    formId: string,
    version?: number,
  ): Promise<FormDTO | null> {
    const rows = await this.db
      .select()
      .from(coachForms)
      .where(
        and(
          eq(coachForms.id, formId),
          or(eq(coachForms.trainerId, trainerId), isNull(coachForms.trainerId)),
        ),
      )
      .limit(1);
    const form = rows[0];
    if (!form) return null;
    const v = await this.db
      .select()
      .from(coachFormVersions)
      .where(
        version === undefined
          ? eq(coachFormVersions.id, form.currentVersionId ?? form.id)
          : and(
              eq(coachFormVersions.formId, form.id),
              eq(coachFormVersions.version, version),
            ),
      )
      .limit(1);
    if (version !== undefined && !v[0]) return null;
    return formDto(form, v[0] ?? null);
  }

  async findByClientRequest(
    trainerId: string,
    key: string,
  ): Promise<FormDTO | null> {
    const rows = await this.withVersions(
      and(
        eq(coachForms.trainerId, trainerId),
        eq(coachForms.clientRequestId, key),
      ),
    );
    return rows[0] ? formDto(rows[0].form, rows[0].version) : null;
  }

  async findTemplate(templateKey: string): Promise<Row | null> {
    const rows = await this.withVersions(
      and(
        isNull(coachForms.trainerId),
        eq(coachForms.templateKey, templateKey),
        isNull(coachForms.archivedAt),
        eq(coachForms.available, true),
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * A new form with version 1. With an `Idempotency-Key`, a replay (or a
   * request racing the first) returns the first form.
   */
  async create(
    trainerId: string,
    input: {
      title: string;
      description: string | null;
      questions: Question[];
      clientRequestId: string | null;
    },
  ): Promise<{ form: FormDTO; replay: boolean }> {
    return getDb().transaction(async (tx) => {
      const inserted = await tx
        .insert(coachForms)
        .values({
          trainerId,
          title: input.title,
          description: input.description,
          clientRequestId: input.clientRequestId,
        })
        .onConflictDoNothing()
        .returning();
      const form = inserted[0];
      if (!form) {
        const existing = await new CoachFormRepository(tx).findByClientRequest(
          trainerId,
          input.clientRequestId!,
        );
        return { form: existing!, replay: true };
      }
      const version = await tx
        .insert(coachFormVersions)
        .values({ formId: form.id, version: 1, questions: input.questions })
        .returning();
      const updated = await tx
        .update(coachForms)
        .set({ currentVersionId: version[0]!.id })
        .where(eq(coachForms.id, form.id))
        .returning();
      return { form: formDto(updated[0]!, version[0]!), replay: false };
    });
  }

  /**
   * Title and description in place; `questions` makes a NEW version, so a
   * request already sent keeps the questions it asked. `expectedRevision`
   * (optional; absent = last write wins) guards offline edits.
   */
  async patch(
    trainerId: string,
    formId: string,
    patch: {
      title?: string;
      description?: string | null;
      questions?: Question[];
    },
    expectedRevision?: number,
  ): Promise<
    | { ok: true; form: FormDTO }
    | { ok: false; reason: "not_found" }
    | { ok: false; reason: "revision_conflict"; current: FormDTO }
  > {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(coachForms)
        .where(
          and(
            eq(coachForms.id, formId),
            eq(coachForms.trainerId, trainerId),
            isNull(coachForms.archivedAt),
          ),
        )
        .limit(1)
        .for("update");
      const form = rows[0];
      if (!form) return { ok: false, reason: "not_found" };
      const repo = new CoachFormRepository(tx);
      if (
        expectedRevision !== undefined &&
        expectedRevision !== form.revision
      ) {
        return {
          ok: false,
          reason: "revision_conflict",
          current: (await repo.get(trainerId, formId))!,
        };
      }
      let currentVersionId = form.currentVersionId;
      if (patch.questions) {
        const current = currentVersionId
          ? (
              await tx
                .select()
                .from(coachFormVersions)
                .where(eq(coachFormVersions.id, currentVersionId))
                .limit(1)
            )[0]
          : undefined;
        const unchanged =
          current &&
          JSON.stringify(current.questions) === JSON.stringify(patch.questions);
        if (!unchanged) {
          const max = await tx
            .select({
              max: sql<number>`coalesce(max(${coachFormVersions.version}), 0)::int`,
            })
            .from(coachFormVersions)
            .where(eq(coachFormVersions.formId, formId));
          const created = await tx
            .insert(coachFormVersions)
            .values({
              formId,
              version: Number(max[0]!.max) + 1,
              questions: patch.questions,
            })
            .returning({ id: coachFormVersions.id });
          currentVersionId = created[0]!.id;
        }
      }
      await tx
        .update(coachForms)
        .set({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined
            ? { description: patch.description }
            : {}),
          currentVersionId,
          revision: sql`${coachForms.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(coachForms.id, formId));
      return { ok: true, form: (await repo.get(trainerId, formId))! };
    });
  }

  /** Archive (keeps versions, requests and responses). Idempotent. */
  async archive(trainerId: string, formId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: coachForms.id, archivedAt: coachForms.archivedAt })
      .from(coachForms)
      .where(
        and(eq(coachForms.id, formId), eq(coachForms.trainerId, trainerId)),
      )
      .limit(1);
    if (!rows[0]) return false;
    if (rows[0].archivedAt === null) {
      const now = new Date();
      await this.db
        .update(coachForms)
        .set({
          archivedAt: now,
          revision: sql`${coachForms.revision} + 1`,
          updatedAt: now,
        })
        .where(and(eq(coachForms.id, formId), isNull(coachForms.archivedAt)));
    }
    return true;
  }

  /** The caller's live (unarchived) form, for checks by other areas. */
  async ownLive(trainerId: string, formId: string): Promise<CoachForm | null> {
    const rows = await this.db
      .select()
      .from(coachForms)
      .where(
        and(
          eq(coachForms.id, formId),
          eq(coachForms.trainerId, trainerId),
          isNull(coachForms.archivedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
