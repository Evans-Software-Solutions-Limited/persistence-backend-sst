import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  exerciseSets,
  exercises,
  personalRecords,
  recordTypeEnum,
  sessionExercises,
  workoutSessions,
  type PersonalRecord,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Either the standalone Drizzle DB handle (`getDb()`) or a transaction
 * handle returned from `db.transaction(async (tx) => { ... })`. Both
 * support the same `select` / `insert` / `update` surface, but `tx`
 * lacks `$client` and `transaction` (no nested transactions) — so the
 * intersection is what callers can portably depend on.
 *
 * Used by `recordPRsForSession` so the same method body works for the
 * standalone post-hoc trigger (passes nothing → uses `getDb()`) AND
 * the bulk-record path that runs inside `SessionRepository.
 * recordSession`'s transaction (passes `tx` → all writes land in the
 * same atomic transaction as the session insert).
 */
export type DbOrTx = Omit<ReturnType<typeof getDb>, "$client" | "transaction">;

/**
 * Type alias mirroring the `record_type` Postgres enum at
 * `packages/db/src/schema.ts:60`. Kept as a separate type so callers
 * (handlers, services, tests) don't have to reach into the Drizzle
 * internals to construct enum literals.
 */
export type RecordType = (typeof recordTypeEnum.enumValues)[number];

/**
 * Personal-record entry surfaced to the client after a bulk `recordSession`
 * lands. Only includes PRs the user actually beat — first-occurrence
 * "best so far" rows are still upserted to `personal_records` (so future
 * sessions have a baseline) but are NOT surfaced here, mirroring Brad's
 * "no PRs come back if it's the first workout logged" rule.
 *
 * `exerciseName` is denormalised at response-build time so the mobile
 * Summary screen can render a PR card without a follow-up exercises
 * lookup. Matches legacy `RecordWorkoutResponse.personal_records[].exercise_name`.
 */
export interface DetectedPersonalRecord {
  exerciseId: string;
  exerciseName: string;
  recordType: RecordType;
  newValue: number;
  previousValue: number;
  setId: string;
}

/**
 * Record types V2 actively computes per session-complete.
 *
 * Legacy `record_type` enum carries eight values; M3 surfaces three on
 * the Summary screen — Epley-derived 1RM, the heaviest single weight
 * lifted regardless of reps, and the highest weight × reps in a single
 * set. The other five enum values (`3rm` / `5rm` / `10rm` / `max_reps` /
 * `best_time` / `longest_distance`) are reserved for future detection
 * passes; M3 keeps the detection surface focused so users aren't
 * overwhelmed with PR cards.
 */
const COMPUTED_RECORD_TYPES = ["1rm", "max_weight", "max_volume"] as const;

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
   * For every completed set in `sessionId` (joined through
   * session_exercises and workout_sessions to enforce userId scope),
   * computes three candidate record types — Epley-derived `1rm`,
   * `max_weight` (heaviest single weight regardless of reps), and
   * `max_volume` (highest weight × reps in a single set) — picks the
   * best set per `(exerciseId, recordType)` tuple, and upserts the
   * winners into `personal_records` keyed by `(user_id, exercise_id,
   * record_type)`.
   *
   * The Postgres unique index `personal_records_user_exercise_type_idx`
   * (`packages/db/src/schema.ts:470`) is what makes the upsert
   * idempotent on replay; the conflict clause's WHERE filter only
   * updates when the candidate value strictly beats the existing one,
   * so re-running this against a session that's already had its PRs
   * recorded is a no-op.
   *
   * **User-facing PR rule** (Brad's call after the device review of
   * Phase 3a): "if it's the first workout logged (no previous values)
   * then no PRs need to come back." A pre-upsert SELECT captures the
   * existing `personal_records.value` per touched `(exerciseId,
   * recordType)` tuple. The method returns ONLY the candidates that
   * (a) had a prior row in `personal_records` AND (b) beat that
   * prior — surfaced to the client with `previousValue` for the
   * "before → after" arrow on the Summary screen.
   *
   * First-occurrence candidates still INSERT a row into
   * `personal_records` (so future sessions have a baseline to beat) —
   * they're just not in the returned list. The set's
   * `is_personal_record` flag DOES still flip true for first
   * occurrences (the flag tracks "current canonical best holder," not
   * "user-facing PR" — and the mobile Summary screen reads the
   * returned list, not the flag).
   *
   * After the upsert pass, queries the table for the canonical PR
   * setIds belonging to this session's exercises and flips
   * `exercise_sets.is_personal_record = true` on the winners (and false
   * on superseded sets from earlier sessions). Same shape as before
   * the broadening — only the per-candidate logic above changed.
   *
   * Atomicity: the upsert pass + flag flip are NOT wrapped in a single
   * transaction. The whole operation is idempotent (unique index +
   * value comparison), so a partial failure can be safely re-run.
   * Callers (sessionsUpdateHandler) should call this after the session
   * status update commits, so a PR-detection failure leaves the
   * session in `completed` state with PRs not-yet-recorded — the next
   * call (or a manual retry) reconciles.
   */
  async recordPRsForSession(
    userId: string,
    sessionId: string,
    tx?: DbOrTx,
  ): Promise<DetectedPersonalRecord[]> {
    // Use the caller-provided transaction handle when present (e.g.
    // SessionRepository.recordSession runs the bulk-record flow inside
    // db.transaction(...) and passes `tx` here so PR detection lands
    // in the same atomic write). Falls back to getDb() for the
    // standalone post-hoc trigger from sessionsUpdateHandler.
    const db = tx ?? getDb();

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

    if (completedSets.length === 0) return [];

    // ── Step 1: enumerate per-set candidates across the 3 record types.
    // Bodyweight exercises (no weight) and timed-only exercises don't
    // fit the Epley / weight-based model; we just don't record PRs for
    // those — M4's measurement / progress surface can use other
    // signals.
    type Candidate = {
      exerciseId: string;
      recordType: RecordType;
      value: number;
      setId: string;
    };
    const candidates: Candidate[] = [];
    for (const set of completedSets) {
      if (set.weightKg == null || set.reps == null || set.reps <= 0) continue;
      const weight = parseFloat(set.weightKg);
      if (!Number.isFinite(weight) || weight <= 0) continue;

      candidates.push({
        exerciseId: set.exerciseId,
        recordType: "1rm",
        value: weight * (1 + set.reps / 30),
        setId: set.setId,
      });
      candidates.push({
        exerciseId: set.exerciseId,
        recordType: "max_weight",
        value: weight,
        setId: set.setId,
      });
      candidates.push({
        exerciseId: set.exerciseId,
        recordType: "max_volume",
        value: weight * set.reps,
        setId: set.setId,
      });
    }

    // ── Step 2: collapse to one winner per (exerciseId, recordType).
    type Key = string;
    const keyOf = (c: { exerciseId: string; recordType: RecordType }) =>
      `${c.exerciseId}|${c.recordType}`;
    const bestPerKey = new Map<Key, Candidate>();
    for (const c of candidates) {
      const k = keyOf(c);
      const existing = bestPerKey.get(k);
      if (!existing || c.value > existing.value) bestPerKey.set(k, c);
    }

    const touchedExerciseIds = [
      ...new Set(completedSets.map((s) => s.exerciseId)),
    ];

    // ── Step 3: pre-SELECT existing `personal_records` rows for the
    // touched exercises × computed record types. The map keyed by
    // `${exerciseId}|${recordType}` is the in-memory baseline used to
    // decide (a) whether a candidate is first-occurrence (no prior →
    // skip from the response) vs improvement (prior exists, was
    // beaten → include with previousValue), and (b) the actual prior
    // value carried back to the client.
    const priorByKey = new Map<Key, number>();
    if (bestPerKey.size > 0) {
      const existingPRs = await db
        .select({
          exerciseId: personalRecords.exerciseId,
          recordType: personalRecords.recordType,
          value: personalRecords.value,
        })
        .from(personalRecords)
        .where(
          and(
            eq(personalRecords.userId, userId),
            inArray(personalRecords.exerciseId, touchedExerciseIds),
            inArray(personalRecords.recordType, [...COMPUTED_RECORD_TYPES]),
          ),
        );
      for (const rec of existingPRs) {
        priorByKey.set(keyOf(rec), parseFloat(rec.value));
      }
    }

    // ── Step 4: upsert each winning candidate, building the response
    // list as we go. The upsert is race-safe via the unique index +
    // value-comparison WHERE; the response inclusion logic is purely
    // in-memory and uses `priorByKey` captured at step 3.
    //
    // **Precision discipline** (Inspector Brad finding): the DB stores
    // the value at 2-decimal precision (`numeric(10,2)`), the prior
    // is parsed from that 2dp string, but the raw candidate is a full
    // JS float. Without normalising, a JS float like 133.33333... and
    // a stored prior of 133.33 would disagree:
    //   - JS:  133.333... > 133.33 → true   → phantom PR pushed
    //   - PG:  excluded.value (133.33) < personal_records.value
    //          (133.33) → false → upsert no-ops
    // The Summary screen would then show a confusing "133.33 → 133.33"
    // PR card and the response setId wouldn't match what
    // `personal_records.setId` actually holds. Hits any reps where
    // reps/30 has a fractional .333… family (1, 4, 7, 10, 13, …) and
    // any float-multiplication artefact in max_volume (e.g. 99.99 ×
    // 10 = 999.9000000000001). Fix: round-trip through the same
    // `toFixed(2) → parseFloat` pipeline the DB sees, so JS and PG
    // agree byte-for-byte on whether a candidate is a real improvement.
    const detected: Array<Omit<DetectedPersonalRecord, "exerciseName">> = [];
    for (const [k, candidate] of bestPerKey) {
      const valueStr = candidate.value.toFixed(2);
      const candidateValueAtStoredPrecision = parseFloat(valueStr);

      await db
        .insert(personalRecords)
        .values({
          userId,
          exerciseId: candidate.exerciseId,
          recordType: candidate.recordType,
          value: valueStr,
          setId: candidate.setId,
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

      const prior = priorByKey.get(k);
      if (prior != null && candidateValueAtStoredPrecision > prior) {
        detected.push({
          exerciseId: candidate.exerciseId,
          recordType: candidate.recordType,
          // Use the rounded value for the response too so the mobile
          // client renders the same number the DB actually persisted —
          // no "PR! 133.33 → 133.33333..." mismatch.
          newValue: candidateValueAtStoredPrecision,
          previousValue: prior,
          setId: candidate.setId,
        });
      }
    }

    // Re-sync the `is_personal_record` flag on `exercise_sets` to
    // match the canonical state in `personal_records`. Two-step
    // process so the flag stays correct over time, not just at the
    // moment a set is recorded:
    //
    //   1. Demote: clear the flag on any previously-flagged set that
    //      no longer holds a canonical PR. Without this, sets from
    //      earlier sessions that were beaten by a later session would
    //      retain a stale `is_personal_record = true` indefinitely.
    //   2. Promote: set the flag on the current canonical PR setIds.
    //
    // Scope is bounded to the exercises this session touched (already
    // computed at step 2 above) — a user's other exercises (and other
    // users' data) are never queried or modified. The WHERE clause
    // threads userId via the session_exercises ⨝ workout_sessions join.
    const canonicalPRs = await db
      .select({ setId: personalRecords.setId })
      .from(personalRecords)
      .where(
        and(
          eq(personalRecords.userId, userId),
          inArray(personalRecords.exerciseId, touchedExerciseIds),
        ),
      );

    const canonicalSetIds = canonicalPRs
      .map((p) => p.setId)
      .filter((id): id is string => id !== null);

    // The user's session_exercises rows for the touched exercises —
    // i.e. every session_exercise this user has ever logged for any
    // of these exercises. Used as the scope of both demote (which
    // sets to maybe-clear) and promote (which sets to maybe-flag).
    // Reused as a subquery; Drizzle compiles it inline both times.
    const userSessionExerciseIdsScope = db
      .select({ id: sessionExercises.id })
      .from(sessionExercises)
      .innerJoin(
        workoutSessions,
        eq(sessionExercises.sessionId, workoutSessions.id),
      )
      .where(
        and(
          eq(workoutSessions.userId, userId),
          inArray(sessionExercises.exerciseId, touchedExerciseIds),
        ),
      );

    // Demote: clear the flag on flagged sets in scope that aren't
    // current canonical PRs. When canonicalSetIds is empty, the
    // notInArray clause is dropped so we still clear orphaned flags.
    const demoteFilters = [
      eq(exerciseSets.isPersonalRecord, true),
      inArray(exerciseSets.sessionExerciseId, userSessionExerciseIdsScope),
    ];
    if (canonicalSetIds.length > 0) {
      demoteFilters.push(notInArray(exerciseSets.id, canonicalSetIds));
    }
    await db
      .update(exerciseSets)
      .set({ isPersonalRecord: false })
      .where(and(...demoteFilters));

    // Promote: flag the current canonical PR setIds. Reaffirms any
    // pre-existing flags AND lights up new winners from this session.
    if (canonicalSetIds.length > 0) {
      await db
        .update(exerciseSets)
        .set({ isPersonalRecord: true })
        .where(inArray(exerciseSets.id, canonicalSetIds));
    }

    // ── Step 5: denormalise exerciseName onto each surfaced PR so the
    // mobile client can render a PR card without a follow-up join.
    // Mirrors legacy `RecordWorkoutResponse.personal_records[].exercise_name`
    // (persistence-mobile/lib/supabase/queries/workoutMutations.ts:815-817).
    // Skips the round-trip entirely when nothing was surfaced (the
    // common path for first-occurrence-only sessions under Brad's rule).
    if (detected.length === 0) return [];

    const detectedExerciseIds = [...new Set(detected.map((d) => d.exerciseId))];
    const nameRows = await db
      .select({ id: exercises.id, name: exercises.name })
      .from(exercises)
      .where(inArray(exercises.id, detectedExerciseIds));
    const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

    return detected.map((d) => ({
      ...d,
      exerciseName: nameById.get(d.exerciseId) ?? "Unknown",
    }));
  }
}
