import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  exerciseSets,
  personalRecords,
  recordTypeEnum,
  sessionExercises,
  workoutSessions,
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

  /**
   * Server-side personal-record detection on session-complete.
   *
   * Loads every completed set in `sessionId` (joined through
   * session_exercises and workout_sessions to enforce userId scope),
   * computes an Epley-derived 1RM (`weightKg × (1 + reps / 30)`) per
   * set, and upserts into `personal_records` keyed by
   * `(user_id, exercise_id, record_type)`. The Postgres unique index
   * `personal_records_user_exercise_type_idx` (schema.ts:467) is what
   * makes the upsert idempotent on replay; the conflict clause's
   * WHERE filter only updates when the candidate value strictly beats
   * the existing one, so re-running this against a session that's
   * already had its PRs recorded is a no-op.
   *
   * After the upsert pass, queries the table for the canonical PR
   * setIds belonging to this session and flips
   * `exercise_sets.is_personal_record = true` on each. Sets that won
   * temporarily but were beaten later in the same session don't get
   * the flag — only the final PR-holder.
   *
   * Scope: M3 records the `1rm` type only. The recordTypeEnum doesn't
   * have a `volume` value yet; mobile clients compute volume PRs
   * client-side on the Summary screen for offline UX, and a follow-up
   * additive enum migration could persist them server-side later.
   *
   * Atomicity: the upsert pass + flag flip are NOT wrapped in a single
   * transaction. The whole operation is idempotent (unique index +
   * value comparison), so a partial failure can be safely re-run.
   * Callers (sessionsUpdateHandler) should call this after the session
   * status update commits, so a PR-detection failure leaves the
   * session in `completed` state with PRs not-yet-recorded — the next
   * call (or a manual retry) reconciles.
   */
  async recordPRsForSession(userId: string, sessionId: string): Promise<void> {
    const db = getDb();

    const completedSets = await db
      .select({
        setId: exerciseSets.id,
        exerciseId: sessionExercises.exerciseId,
        weightKg: exerciseSets.weightKg,
        reps: exerciseSets.reps,
      })
      .from(exerciseSets)
      .innerJoin(
        sessionExercises,
        eq(exerciseSets.sessionExerciseId, sessionExercises.id),
      )
      .innerJoin(
        workoutSessions,
        eq(sessionExercises.sessionId, workoutSessions.id),
      )
      .where(
        and(
          eq(workoutSessions.id, sessionId),
          eq(workoutSessions.userId, userId),
          eq(exerciseSets.isCompleted, true),
        ),
      );

    for (const set of completedSets) {
      // Skip sets without enough data to compute a 1RM. Bodyweight
      // exercises (no weight) and timed-only exercises don't fit the
      // Epley model; we just don't record PRs for those — M4's
      // measurement / progress surface can use other signals.
      if (set.weightKg == null || set.reps == null || set.reps <= 0) continue;
      const weight = parseFloat(set.weightKg);
      if (!Number.isFinite(weight) || weight <= 0) continue;

      const epley1rm = weight * (1 + set.reps / 30);
      const epley1rmStr = epley1rm.toFixed(2);

      await db
        .insert(personalRecords)
        .values({
          userId,
          exerciseId: set.exerciseId,
          recordType: "1rm",
          value: epley1rmStr,
          setId: set.setId,
          achievedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            personalRecords.userId,
            personalRecords.exerciseId,
            personalRecords.recordType,
          ],
          set: {
            value: sql`excluded.value`,
            setId: sql`excluded.set_id`,
            achievedAt: sql`excluded.achieved_at`,
          },
          where: sql`${personalRecords.value} < excluded.value`,
        });
    }

    if (completedSets.length === 0) return;

    // Query the canonical PR rows that point at any set from this
    // session and flip is_personal_record on those sets only. This is
    // the source of truth — beats any heuristic about which sets
    // "won" inside the loop above (multiple sets for the same
    // exercise overwrite each other on the way through).
    const sessionSetIds = completedSets.map((s) => s.setId);
    const winners = await db
      .select({ setId: personalRecords.setId })
      .from(personalRecords)
      .where(
        and(
          eq(personalRecords.userId, userId),
          inArray(personalRecords.setId, sessionSetIds),
        ),
      );

    const winningSetIds = winners
      .map((w) => w.setId)
      .filter((id): id is string => id !== null);

    if (winningSetIds.length > 0) {
      await db
        .update(exerciseSets)
        .set({ isPersonalRecord: true })
        .where(inArray(exerciseSets.id, winningSetIds));
    }
  }
}
