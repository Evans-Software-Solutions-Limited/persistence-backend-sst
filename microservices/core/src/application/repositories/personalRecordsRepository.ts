import { and, desc, eq } from "drizzle-orm";
import {
  personalRecords,
  recordTypeEnum,
  type PersonalRecord,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Type alias mirroring the `record_type` Postgres enum at
 * `packages/db/src/schema.ts:60`. Kept as a separate type so callers
 * (handlers, services, tests) don't have to reach into the Drizzle
 * internals to construct enum literals.
 */
export type RecordType = (typeof recordTypeEnum.enumValues)[number];

export interface ListPersonalRecordsFilters {
  /** Restrict to PRs for a specific exercise. */
  exerciseId?: string;
  /** Restrict to one record type (e.g. `1rm`). */
  recordType?: RecordType;
  limit?: number;
  offset?: number;
}

/**
 * Read-only repository for the `personal_records` table.
 *
 * Writes happen exclusively through `recordPRsForSession` (server-side
 * PR detection on session-complete — added in the next commit), so this
 * file ships only `list` for now. The unique index
 * `personal_records_user_exercise_type_idx` enforces one row per
 * (user, exercise, record_type) — the upsert path relies on it for
 * idempotency.
 */
export class PersonalRecordsRepository {
  static readonly key = "PersonalRecordsRepository";

  /**
   * List a user's PRs, optionally filtered by exercise and / or record
   * type. Always JWT-scoped via the `userId` argument — no global
   * lookups, no cross-user leaks. Ordered by `achieved_at` descending
   * so the most recent PR per group surfaces first when both filters
   * are loose.
   */
  async list(
    userId: string,
    filters: ListPersonalRecordsFilters = {},
  ): Promise<PersonalRecord[]> {
    const db = getDb();
    const { exerciseId, recordType, limit = 50, offset = 0 } = filters;

    const predicates = [eq(personalRecords.userId, userId)];
    if (exerciseId) {
      predicates.push(eq(personalRecords.exerciseId, exerciseId));
    }
    if (recordType) {
      predicates.push(eq(personalRecords.recordType, recordType));
    }

    return db
      .select()
      .from(personalRecords)
      .where(and(...predicates))
      .orderBy(desc(personalRecords.achievedAt))
      .limit(limit)
      .offset(offset);
  }
}
