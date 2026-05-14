import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  workoutSessions,
  sessionExercises,
  exerciseSets,
  type WorkoutSession,
  type NewWorkoutSession,
  type SessionExercise,
  type NewSessionExercise,
  type ExerciseSet,
  type NewExerciseSet,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type {
  DbOrTx,
  DetectedPersonalRecord,
} from "./personalRecordsRepository";

export interface SessionWithExercises extends WorkoutSession {
  exercises: SessionExercise[];
}

/**
 * Bulk-record session input — payload shape for the M3
 * `POST /sessions/record` flush path. Mirrors the legacy
 * `persistence-mobile` repo's `recordWorkout` mutation. Mobile
 * builds this once on Finish, server writes everything in a single
 * transaction including PR detection. See
 * `specs/milestones/M3-active-session/BACKEND_BRIEF.md` § 7.
 */
export interface RecordSessionInput {
  workoutId?: string | null;
  name?: string | null;
  startedAt: string;
  completedAt?: string | null;
  status: "completed" | "cancelled";
  totalDurationSeconds?: number | null;
  userNotes?: string | null;
  sessionRating?: number | null;
  overallRpe?: number | null;
  difficultyRanking?: number | null;
  exercises: Array<{
    exerciseId: string;
    sortOrder: number;
    supersetGroup?: number | null;
    isSubstituted?: boolean;
    originalExerciseId?: string | null;
    notes?: string | null;
    sets: Array<{
      setNumber: number;
      reps?: number | null;
      weightKg?: string | number | null;
      durationSeconds?: number | null;
      distanceMeters?: string | number | null;
      rpe?: number | null;
      restAfterSeconds?: number | null;
      isCompleted?: boolean;
      completedAt?: string | null;
    }>;
  }>;
}

export interface RecordedSession extends WorkoutSession {
  exercises: Array<
    SessionExercise & {
      sets: ExerciseSet[];
    }
  >;
  /**
   * Personal records the user beat in this session — each entry carries
   * `previousValue` for the legacy "before → after" arrow on the Summary
   * screen. First-occurrence records are NOT included (Brad's "no PRs
   * on the user's first workout" rule); they still upsert into the
   * `personal_records` table server-side so future sessions have a
   * baseline. Mirrors legacy
   * `RecordWorkoutResponse.personal_records[]` shape.
   */
  personalRecords: DetectedPersonalRecord[];
  /**
   * Number of completed workouts this user has finished THIS CALENDAR
   * MONTH (including the just-recorded session when its status is
   * `completed`). Computed inside the same transaction as the insert
   * via `SELECT COUNT(*) WHERE status='completed' AND completed_at >=
   * date_trunc('month', now())`, so a completed session is counted; a
   * cancelled one is not, and sessions from prior months fall out of
   * scope. Drives the legacy 3-stat strip's "Workouts this month" tile
   * + the subtitle copy ("You've completed N workouts this month. Keep
   * the momentum going!"). Renamed from the original
   * `totalWorkoutsCompleted` (which counted ALL-time completed
   * workouts) after the device review of Phase 3b — Brad wanted the
   * tile to surface a value that actually changes session-to-session
   * for established users.
   */
  workoutsThisMonth: number;
}

export class SessionRepository {
  static readonly key = "SessionRepository";

  async list(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      /**
       * Filter by session status. Used by the mobile client's resume-on-
       * launch flow (`?status=in_progress` returns the user's active
       * session if any).
       */
      status?: "in_progress" | "completed" | "cancelled";
    } = {},
  ): Promise<WorkoutSession[]> {
    const db = getDb();
    const { limit = 20, offset = 0, status } = options;

    const whereClause = status
      ? and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, status),
        )
      : eq(workoutSessions.userId, userId);

    return db
      .select()
      .from(workoutSessions)
      .where(whereClause)
      .orderBy(desc(workoutSessions.startedAt))
      .limit(limit)
      .offset(offset);
  }

  async getById(
    id: string,
    userId: string,
  ): Promise<SessionWithExercises | null> {
    const db = getDb();

    const session = await db
      .select()
      .from(workoutSessions)
      .where(
        and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)),
      )
      .limit(1);

    if (!session[0]) {
      return null;
    }

    const exercises = await db
      .select({
        id: sessionExercises.id,
        sessionId: sessionExercises.sessionId,
        exerciseId: sessionExercises.exerciseId,
        sortOrder: sessionExercises.sortOrder,
        supersetGroup: sessionExercises.supersetGroup,
        isSubstituted: sessionExercises.isSubstituted,
        originalExerciseId: sessionExercises.originalExerciseId,
        notes: sessionExercises.notes,
        createdAt: sessionExercises.createdAt,
      })
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, id))
      .orderBy(sessionExercises.sortOrder);

    return {
      ...session[0],
      exercises,
    };
  }

  async create(
    userId: string,
    data: Omit<NewWorkoutSession, "userId" | "startedAt" | "createdAt">,
  ): Promise<WorkoutSession> {
    const db = getDb();

    const result = await db
      .insert(workoutSessions)
      .values({
        ...data,
        userId,
      } as NewWorkoutSession)
      .returning();

    return result[0];
  }

  /**
   * Bulk-record a completed (or cancelled) session in one transaction.
   * The M3 active-session flush path: mobile keeps the active session
   * in local state, then on Finish posts the entire payload here.
   *
   * Sequence inside the transaction:
   *
   *   1. Insert workout_sessions row (userId from JWT, never the body)
   *   2. For each input exercise: insert session_exercises row, capturing
   *      the server id
   *   3. For each input set under that exercise: insert exercise_sets
   *      row pointed at the session_exercises id from step 2
   *   4. If status === 'completed': call
   *      personalRecordsRepository.recordPRsForSession(userId, sid, tx)
   *      so PR detection lands inside the same transaction. The PR
   *      repo is injected via constructor — we don't import it here
   *      to keep the SessionRepository module free of the cross-repo
   *      coupling that DI exists to manage.
   *   5. Return the inserted session with nested exercises + sets so
   *      the mobile client can swap its `local-` ids for server uuids.
   *
   * Atomicity: any failure rolls the whole transaction back. Either
   * the entire session lands or none of it does. There's no
   * "session created but sets failed" intermediate state.
   *
   * Idempotency: NOT replay-safe. Calling this twice for the same
   * mobile-side session would create two DB sessions. The mobile sync
   * worker is responsible for not retrying past success. (Distinct
   * from `recordPRsForSession`, which IS idempotent on its own.)
   *
   * Spec: specs/milestones/M3-active-session/BACKEND_BRIEF.md § 7.
   */
  async recordSession(
    userId: string,
    payload: RecordSessionInput,
    runPRDetection: (
      userId: string,
      sessionId: string,
      tx: DbOrTx,
    ) => Promise<DetectedPersonalRecord[]>,
  ): Promise<RecordedSession> {
    const db = getDb();

    return db.transaction(async (tx) => {
      // 1. Insert the session root.
      const [session] = await tx
        .insert(workoutSessions)
        .values({
          userId,
          workoutId: payload.workoutId ?? null,
          name: payload.name ?? null,
          status: payload.status,
          startedAt: new Date(payload.startedAt),
          completedAt: payload.completedAt
            ? new Date(payload.completedAt)
            : null,
          totalDurationSeconds: payload.totalDurationSeconds ?? null,
          userNotes: payload.userNotes ?? null,
          sessionRating: payload.sessionRating ?? null,
          overallRpe: payload.overallRpe ?? null,
          difficultyRanking: payload.difficultyRanking ?? null,
          updatedAt: new Date(),
        } as NewWorkoutSession)
        .returning();

      // 2. Insert each exercise + its sets in payload order. Sequential
      //    inserts within the tx — N round-trips inside one DB tx,
      //    not N separate API roundtrips. For typical M3 sessions
      //    (3-8 exercises × 3-5 sets) the cost is bounded. Discard the
      //    .returning() snapshots: PR detection in step 3 will flip
      //    is_personal_record on some of these rows, so we re-fetch
      //    the canonical state in step 4 before responding.
      for (const ex of payload.exercises) {
        const [exerciseRow] = await tx
          .insert(sessionExercises)
          .values({
            sessionId: session.id,
            exerciseId: ex.exerciseId,
            sortOrder: ex.sortOrder,
            supersetGroup: ex.supersetGroup ?? null,
            isSubstituted: ex.isSubstituted ?? false,
            originalExerciseId: ex.originalExerciseId ?? null,
            notes: ex.notes ?? null,
          } as NewSessionExercise)
          .returning({ id: sessionExercises.id });

        for (const set of ex.sets) {
          await tx.insert(exerciseSets).values({
            sessionExerciseId: exerciseRow.id,
            setNumber: set.setNumber,
            reps: set.reps ?? null,
            weightKg:
              set.weightKg !== undefined && set.weightKg !== null
                ? String(set.weightKg)
                : null,
            durationSeconds: set.durationSeconds ?? null,
            distanceMeters:
              set.distanceMeters !== undefined && set.distanceMeters !== null
                ? String(set.distanceMeters)
                : null,
            rpe: set.rpe ?? null,
            restAfterSeconds: set.restAfterSeconds ?? null,
            isCompleted: set.isCompleted ?? false,
            completedAt: set.completedAt ? new Date(set.completedAt) : null,
            isPersonalRecord: false, // PR detection flips this in step 3
          } as NewExerciseSet);
        }
      }

      // 3. PR detection inside the same transaction. Injected so this
      //    repo doesn't depend on personalRecordsRepository directly
      //    — the handler wires the two together. Skipped for cancelled
      //    sessions per `recordWorkout` legacy parity (a discarded
      //    workout shouldn't generate PRs). The detection pass upserts
      //    `personal_records` and flips `is_personal_record` on the
      //    canonical PR sets via the DEMOTE/PROMOTE flag re-sync, AND
      //    returns the list of surfaced PRs (first-occurrence rows are
      //    written but excluded — Brad's "no PRs on the first workout"
      //    rule).
      let personalRecordsForResponse: DetectedPersonalRecord[] = [];
      if (session.status === "completed") {
        personalRecordsForResponse = await runPRDetection(
          userId,
          session.id,
          tx,
        );
      }

      // 4. Re-fetch the full nested session inside the same tx so the
      //    response reflects the post-PR-detection state — in
      //    particular the `is_personal_record` flags step 3 just
      //    flipped on canonical PR sets. The bare `.returning()`
      //    snapshots from step 2 are pre-detection and would lie on
      //    the wire (mobile relies on these flags for the Summary
      //    screen's PR badge). Querying inside the tx guarantees we
      //    see our own writes. Spec: BACKEND_BRIEF § 7 step 5.
      const [refreshedSession] = await tx
        .select()
        .from(workoutSessions)
        .where(eq(workoutSessions.id, session.id))
        .limit(1);

      const refreshedExercises = await tx
        .select()
        .from(sessionExercises)
        .where(eq(sessionExercises.sessionId, session.id))
        .orderBy(sessionExercises.sortOrder);

      const exerciseIds = refreshedExercises.map((e) => e.id);
      const refreshedSets =
        exerciseIds.length === 0
          ? []
          : await tx
              .select()
              .from(exerciseSets)
              .where(inArray(exerciseSets.sessionExerciseId, exerciseIds))
              .orderBy(exerciseSets.setNumber);

      const setsByExerciseId = new Map<string, ExerciseSet[]>();
      for (const s of refreshedSets) {
        const arr = setsByExerciseId.get(s.sessionExerciseId);
        if (arr) arr.push(s);
        else setsByExerciseId.set(s.sessionExerciseId, [s]);
      }

      // 5. Current-calendar-month completed-workout count for this
      //    user, computed inside the same transaction so the COUNT(*)
      //    sees the row we just inserted (when `status='completed'`).
      //    Drives the legacy Summary screen's "Workouts this month"
      //    stat + the subtitle "You've completed N workouts this
      //    month. Keep the momentum going!"
      //
      //    Scoping rationale (Brad's call after the Phase 3b device
      //    review): cumulative all-time count drifts upward
      //    indefinitely and stops surfacing meaningful momentum after
      //    the first few months. Scoping to the current month gives
      //    established users a number that actually resets and grows
      //    each session.
      //
      //    Filter:
      //      * `status = 'completed'`              — same as before;
      //                                              cancelled sessions
      //                                              count themselves
      //                                              out.
      //      * `completed_at >=
      //        date_trunc('month', now())`         — month-start in the
      //                                              database's
      //                                              timezone. Matches
      //                                              dashboardRepository's
      //                                              `workoutsThisMonth`
      //                                              bucketing (which
      //                                              uses UTC month-keys
      //                                              host-side); a brief
      //                                              cross-DST or cross-
      //                                              timezone disagreement
      //                                              is acceptable because
      //                                              the user only ever
      //                                              sees one of the two
      //                                              numbers at a time.
      const [totalsRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.status, "completed"),
            sql`${workoutSessions.completedAt} >= date_trunc('month', now())`,
          ),
        );
      const workoutsThisMonth = totalsRow?.count ?? 0;

      return {
        ...refreshedSession,
        exercises: refreshedExercises.map((e) => ({
          ...e,
          sets: setsByExerciseId.get(e.id) ?? [],
        })),
        personalRecords: personalRecordsForResponse,
        workoutsThisMonth,
      };
    });
  }

  async update(
    id: string,
    userId: string,
    data: Partial<Omit<WorkoutSession, "id" | "userId" | "createdAt">>,
  ): Promise<WorkoutSession | null> {
    const db = getDb();

    // Verify ownership
    const existing = await db
      .select()
      .from(workoutSessions)
      .where(
        and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)),
      )
      .limit(1);

    if (!existing[0]) {
      return null;
    }

    // Refresh updatedAt on every mutation. Per
    // microservices/core/src/application/sessions/CLAUDE.md § Status
    // Transitions: "Status change must update `updatedAt` timestamp."
    // Stamping unconditionally on every PATCH covers status + notes +
    // any future fields without each handler having to remember.
    const result = await db
      .update(workoutSessions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(workoutSessions.id, id))
      .returning();

    return result[0] ?? null;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const db = getDb();

    // Verify ownership
    const existing = await db
      .select()
      .from(workoutSessions)
      .where(
        and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)),
      )
      .limit(1);

    if (!existing[0]) {
      return false;
    }

    const result = await db
      .delete(workoutSessions)
      .where(eq(workoutSessions.id, id))
      .returning();

    return !!result[0];
  }

  // Session Exercise operations
  async addExercise(
    data: Omit<NewSessionExercise, "createdAt" | "id">,
  ): Promise<SessionExercise> {
    const db = getDb();

    const result = await db
      .insert(sessionExercises)
      .values(data as NewSessionExercise)
      .returning();

    return result[0];
  }

  async getSessionExercises(sessionId: string): Promise<SessionExercise[]> {
    const db = getDb();

    return db
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, sessionId))
      .orderBy(sessionExercises.sortOrder);
  }

  async removeExercise(exerciseId: string, userId: string): Promise<boolean> {
    const db = getDb();

    // Verify ownership by checking if session belongs to user
    const sessionExercise = await db
      .select({ sessionId: sessionExercises.sessionId })
      .from(sessionExercises)
      .where(eq(sessionExercises.id, exerciseId))
      .limit(1);

    if (!sessionExercise[0]) {
      return false;
    }

    const session = await db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.id, sessionExercise[0].sessionId),
          eq(workoutSessions.userId, userId),
        ),
      )
      .limit(1);

    if (!session[0]) {
      return false;
    }

    const result = await db
      .delete(sessionExercises)
      .where(eq(sessionExercises.id, exerciseId))
      .returning();

    return !!result[0];
  }

  // Exercise Set operations
  async addSet(data: Omit<NewExerciseSet, "createdAt">): Promise<ExerciseSet> {
    const db = getDb();

    const result = await db
      .insert(exerciseSets)
      .values(data as NewExerciseSet)
      .returning();

    return result[0];
  }

  async getExerciseSets(sessionExerciseId: string): Promise<ExerciseSet[]> {
    const db = getDb();

    return db
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.sessionExerciseId, sessionExerciseId))
      .orderBy(exerciseSets.setNumber);
  }

  /**
   * Returns the set only if it belongs to the given session exercise and
   * session (and session belongs to user). Used to enforce URL hierarchy.
   */
  async getSetInSession(
    sessionId: string,
    sessionExerciseId: string,
    setId: string,
    userId: string,
  ): Promise<ExerciseSet | null> {
    const db = getDb();

    const rows = await db
      .select({ set: exerciseSets })
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
          eq(exerciseSets.id, setId),
          eq(exerciseSets.sessionExerciseId, sessionExerciseId),
          eq(sessionExercises.sessionId, sessionId),
          eq(workoutSessions.userId, userId),
        ),
      )
      .limit(1);

    return rows[0]?.set ?? null;
  }

  /**
   * Folds JWT-scoped ownership into the mutation WHERE via a
   * correlated subquery. Single round-trip; race-free; the set is
   * only mutated if it belongs to a session_exercise whose session
   * belongs to `userId`. Returns null when the join filters everything
   * out (set doesn't exist, or it does but isn't ours) — same surface
   * as the prior SELECT-then-update implementation, no client-visible
   * change.
   *
   * Fixes the M2 learning #14 regression flagged in the M3 BACKEND_BRIEF
   * § 4: the previous implementation cascaded SELECT exerciseSets →
   * SELECT sessionExercises → SELECT workoutSessions → mutate, leaving
   * a TOCTOU window between the final ownership check and the
   * mutation.
   */
  async updateSet(
    setId: string,
    userId: string,
    data: Partial<Omit<ExerciseSet, "id" | "createdAt">>,
  ): Promise<ExerciseSet | null> {
    const db = getDb();

    const result = await db
      .update(exerciseSets)
      .set(data)
      .where(
        and(
          eq(exerciseSets.id, setId),
          inArray(
            exerciseSets.sessionExerciseId,
            db
              .select({ id: sessionExercises.id })
              .from(sessionExercises)
              .innerJoin(
                workoutSessions,
                eq(sessionExercises.sessionId, workoutSessions.id),
              )
              .where(eq(workoutSessions.userId, userId)),
          ),
        ),
      )
      .returning();

    return result[0] ?? null;
  }

  /** Same TOCTOU-safe pattern as `updateSet`. See its docstring. */
  async deleteSet(setId: string, userId: string): Promise<boolean> {
    const db = getDb();

    const result = await db
      .delete(exerciseSets)
      .where(
        and(
          eq(exerciseSets.id, setId),
          inArray(
            exerciseSets.sessionExerciseId,
            db
              .select({ id: sessionExercises.id })
              .from(sessionExercises)
              .innerJoin(
                workoutSessions,
                eq(sessionExercises.sessionId, workoutSessions.id),
              )
              .where(eq(workoutSessions.userId, userId)),
          ),
        ),
      )
      .returning();

    return !!result[0];
  }
}
