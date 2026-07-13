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
  type Db,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type {
  DbOrTx,
  DetectedPersonalRecord,
} from "./personalRecordsRepository";

/**
 * The transaction handle Drizzle hands to a `db.transaction(async (tx) => …)`
 * callback — same idiom as `auditTrainerAction`'s `DbTransaction`. The coach
 * on-behalf `afterRecord` hook types its tx param with this (rather than the
 * looser `DbOrTx`) so the caller can pass the handle straight to
 * `auditTrainerAction` — which requires the tx handle, not the `Db` singleton —
 * with no cast.
 */
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

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
  /**
   * M13 sync-hardening: a client-generated stable id (the mobile
   * `active_sessions` local row id) used to make `POST /sessions/record`
   * retry-safe. When supplied, a second record with the same
   * `(userId, clientSessionId)` returns the first session instead of inserting
   * a duplicate. Omitted by legacy clients / direct-API callers — those keep
   * the pre-M13 non-deduped behaviour (each call inserts a fresh session).
   */
  clientSessionId?: string | null;
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

/**
 * Optional extras for {@link SessionRepository.recordSession}. The self
 * `/sessions/record` path omits this entirely (unchanged behaviour); the coach
 * on-behalf record path (`recordClientSessionOnBehalf`, M18 Start-live) supplies
 * both fields.
 */
export interface RecordSessionOptions {
  /**
   * Stamp `logged_by_user_id` on the `workout_sessions` row — the acting coach
   * when a session is recorded ON BEHALF of a client. Omitted for self records
   * (column stays null). Mirrors the `logged_by_user_id` stamp on the header-only
   * `SessionRepository.create` on-behalf path.
   */
  loggedByUserId?: string;
  /**
   * In-transaction hook run for EVERY recorded session — completed AND
   * cancelled — after the session root + all exercises/sets are inserted. The
   * coach on-behalf path writes its `trainer_actions_audit` row here so the
   * cross-cuts § 1.4.2 invariant ("no `logged_by_user_id` row without a matching
   * audit entry") holds regardless of session status. Distinct from
   * `afterCompletedRecord`, which is completed-only (adherence isn't recorded
   * for a discarded workout). If this throws, the whole record rolls back.
   */
  afterRecord?: (
    userId: string,
    sessionId: string,
    tx: DbTransaction,
  ) => Promise<void>;
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
  /**
   * M13 sync-hardening: `true` when this response is an idempotent REPLAY of an
   * already-recorded session (the client re-sent a `/sessions/record` with a
   * `clientSessionId` that was already committed), `false` for a fresh record.
   * Callers use this to skip NON-idempotent post-commit side effects on a
   * replay — notably the coach on-behalf client notification/push, which would
   * otherwise fire again on every retry. The in-tx effects (PR detection, the
   * completed-only hook, the audit hook) are already skipped on the replay path
   * because the transaction body itself is skipped.
   */
  wasReplay: boolean;
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
    // Optional transaction handle — the coach on-behalf session write threads
    // its `db.transaction` handle through here so the session insert and the
    // `trainer_actions_audit` insert land in ONE transaction (cross-cuts
    // § 1.4.2). Same optional-`tx` pattern as `MeasurementRepository.create`.
    tx?: DbOrTx,
  ): Promise<WorkoutSession> {
    const db = tx ?? getDb();

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
   * Idempotency (M13 sync-hardening): replay-safe WHEN the payload carries a
   * `clientSessionId`. The mobile sync queue retries an ambiguously-failed
   * flush (server committed but the ack was lost), so a retry with the same
   * `(userId, clientSessionId)` returns the already-recorded session instead of
   * inserting a duplicate — proven by the `workout_sessions_user_client_session_idx`
   * unique index (a first-line SELECT for the common sequential retry, plus an
   * `onConflictDoNothing` backstop for a concurrent double-submit). A replay
   * does not RE-RUN PR detection, the completed-only hook, or the audit hook
   * (they already committed on the first write, and re-running them would
   * double-count) — but the response's top-level `personalRecords` list IS
   * reconstructed via `getReplayPersonalRecords` (Cluster 1a Task 1 fix) so a
   * genuine retry-after-success doesn't blank the Summary screen's PR list.
   * Callers that omit `clientSessionId` (legacy clients / direct-API) keep
   * the pre-M13 behaviour: every call inserts a fresh session.
   *
   * Spec: specs/milestones/M3-active-session/BACKEND_BRIEF.md § 7,
   * specs/milestones/M13-sync-hardening/BACKEND_BRIEF.md.
   */
  async recordSession(
    userId: string,
    payload: RecordSessionInput,
    runPRDetection: (
      userId: string,
      sessionId: string,
      tx: DbOrTx,
    ) => Promise<DetectedPersonalRecord[]>,
    // Optional post-record hook run inside the SAME transaction for
    // completed sessions — the handler wires programme-assignment
    // completion linking through here (specs/19-programs § Materialisation)
    // without coupling this repo to the programme tables. Same DI rationale
    // as `runPRDetection`.
    afterCompletedRecord?: (
      userId: string,
      sessionId: string,
      tx: DbOrTx,
    ) => Promise<void>,
    // Optional extras — the coach on-behalf record path (M18 Start-live) stamps
    // `logged_by_user_id` and threads an unconditional in-tx audit hook through
    // here. The self path omits this argument (behaviour unchanged).
    options?: RecordSessionOptions,
    // M13 sync-hardening (Cluster 1a Task 1): replay-safe reconstruction of the
    // `personalRecords` response list, called ONLY on the two replay paths
    // below (the step-0 short-circuit and the concurrent-race backstop)
    // instead of re-running `runPRDetection` — which is self-referential
    // against the already-upserted `personal_records` row and would silently
    // return `[]` again, blanking the Summary screen's PR list on every
    // retry. Optional + defaults to the pre-fix `[]` behaviour so a caller
    // that hasn't wired this yet degrades gracefully rather than throwing;
    // both current callers (`sessionsRecordHandler`,
    // `recordClientSessionOnBehalf`) wire it via
    // `PersonalRecordsRepository.getPersonalRecordsForSessionReplay`.
    getReplayPersonalRecords: (
      userId: string,
      sessionId: string,
      tx: DbOrTx,
    ) => Promise<DetectedPersonalRecord[]> = async () => [],
  ): Promise<RecordedSession> {
    const db = getDb();

    return db.transaction(async (tx) => {
      // M13 dedup: find an already-recorded session for this stable client id.
      // Returns undefined when no clientSessionId was supplied (legacy caller)
      // or none exists yet. Reused by the sequential short-circuit (step 0) and
      // the concurrent-race backstop below, so both share one query + the
      // null-narrowing.
      const clientSessionId = payload.clientSessionId ?? null;
      const findExistingSessionId = async (): Promise<string | undefined> => {
        if (!clientSessionId) return undefined;
        const [row] = await tx
          .select({ id: workoutSessions.id })
          .from(workoutSessions)
          .where(
            and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessions.clientSessionId, clientSessionId),
            ),
          )
          .limit(1);
        return row?.id;
      };

      // 0. Idempotency short-circuit (M13). If a session for
      //    (userId, clientSessionId) already exists, this is a retry of an
      //    already-committed record — return that session unchanged rather than
      //    inserting a duplicate. Handles the common sequential retry (the sync
      //    queue re-POSTs after an ambiguous failure). The concurrent
      //    double-submit is caught by the onConflictDoNothing backstop below.
      const existingSessionId = await findExistingSessionId();
      if (existingSessionId) {
        const replayPersonalRecords = await getReplayPersonalRecords(
          userId,
          existingSessionId,
          tx,
        );
        return this.buildRecordedSession(
          tx,
          userId,
          existingSessionId,
          replayPersonalRecords,
          true,
        );
      }

      // 1. Insert the session root.
      //
      // `completedAt` is coalesced to "now" when status === 'completed'
      // and the client didn't supply one. The wire schema permits
      // `{ status: "completed", completedAt: null }` (the `t.Optional`
      // on the handler) and the column is nullable in Postgres, so
      // without this coalesce a completed session can land with
      // `completed_at = NULL` — which then silently drops out of the
      // current-month COUNT below (NULL >= date_trunc(...) → NULL →
      // excluded), and the response's `workoutsThisMonth` undercounts
      // the very session we just inserted. The mobile client today
      // always sends completedAt, so users won't hit this in practice;
      // the coalesce protects future integrations / backfills /
      // direct-API callers from a surprising failure mode and keeps
      // the docstring claim "including the just-recorded session when
      // its status is completed" literally true. For cancelled
      // sessions completedAt stays null — they're discarded workouts,
      // not finished ones.
      const completedAtFromPayload = payload.completedAt
        ? new Date(payload.completedAt)
        : null;
      const completedAt =
        payload.status === "completed"
          ? (completedAtFromPayload ?? new Date())
          : completedAtFromPayload;

      const insertedSessions = await tx
        .insert(workoutSessions)
        .values({
          userId,
          // Coach on-behalf records stamp the acting trainer here (M18); self
          // records leave it null.
          loggedByUserId: options?.loggedByUserId ?? null,
          // M13: stable client id for retry-dedup (null for legacy callers —
          // NULLs are distinct in the unique index so they never conflict).
          clientSessionId,
          workoutId: payload.workoutId ?? null,
          name: payload.name ?? null,
          status: payload.status,
          startedAt: new Date(payload.startedAt),
          completedAt,
          totalDurationSeconds: payload.totalDurationSeconds ?? null,
          userNotes: payload.userNotes ?? null,
          sessionRating: payload.sessionRating ?? null,
          overallRpe: payload.overallRpe ?? null,
          difficultyRanking: payload.difficultyRanking ?? null,
          updatedAt: new Date(),
        } as NewWorkoutSession)
        // M13 concurrent-submit backstop: two racing retries can both pass the
        // step-0 SELECT before either inserts. The unique
        // (user_id, client_session_id) index makes the loser's insert a no-op
        // (returns []) instead of a duplicate; we then return the winner's row.
        // A null clientSessionId never conflicts (NULLs are distinct), so legacy
        // callers always get their fresh row back here.
        .onConflictDoNothing({
          target: [workoutSessions.userId, workoutSessions.clientSessionId],
        })
        .returning();

      if (insertedSessions.length === 0) {
        // Lost the concurrent race — a racing retry with the same
        // clientSessionId committed between our step-0 SELECT and this insert,
        // and the unique (user_id, client_session_id) index made ours a no-op.
        // Only reachable with a non-null clientSessionId (a null id never
        // conflicts), so findExistingSessionId must resolve.
        const winnerId = await findExistingSessionId();
        if (!winnerId) {
          throw new Error(
            "recordSession: insert returned no row but no existing session found",
          );
        }
        const replayPersonalRecords = await getReplayPersonalRecords(
          userId,
          winnerId,
          tx,
        );
        return this.buildRecordedSession(
          tx,
          userId,
          winnerId,
          replayPersonalRecords,
          true,
        );
      }

      const session = insertedSessions[0];

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
        // 3b. Programme-assignment completion linking (specs/19-programs),
        //     same-tx so an occurrence can never be marked completed
        //     against a session that failed to commit. Skipped for
        //     cancelled sessions — a discarded workout isn't adherence.
        if (afterCompletedRecord) {
          await afterCompletedRecord(userId, session.id, tx);
        }
      }

      // 3c. Unconditional in-tx hook (completed AND cancelled). The coach
      //     on-behalf record path writes its trainer_actions_audit row here so
      //     a discarded (cancelled) on-behalf session is audited too — the
      //     § 1.4.2 invariant applies to any `logged_by_user_id` write, not
      //     just completed ones. The self path leaves this undefined.
      if (options?.afterRecord) {
        await options.afterRecord(userId, session.id, tx);
      }

      // 4-5. Re-fetch the full nested session + current-month count and shape
      //      the response. Extracted into buildRecordedSession so the M13
      //      idempotency short-circuit (step 0) and the concurrent-race
      //      backstop return the identical shape for an already-recorded
      //      session without duplicating the query logic.
      return this.buildRecordedSession(
        tx,
        userId,
        session.id,
        personalRecordsForResponse,
        false,
      );
    });
  }

  /**
   * Re-fetch a recorded session's canonical nested shape (post-PR-detection
   * `is_personal_record` flags included) plus the user's current-calendar-month
   * completed count, and assemble the {@link RecordedSession} response. Runs
   * inside the caller's transaction so it sees the caller's own writes.
   *
   * Shared by three paths in {@link recordSession}: the normal insert, the M13
   * idempotency short-circuit (a sequential retry), and the M13 concurrent-race
   * backstop. `personalRecords` is passed through from the caller — the normal
   * path supplies the freshly-detected PRs; the two replay paths supply the
   * RECONSTRUCTED list from `getReplayPersonalRecords` (Cluster 1a Task 1) so
   * a retried record still returns the PRs the user actually earned, not `[]`.
   */
  private async buildRecordedSession(
    tx: DbTransaction,
    userId: string,
    sessionId: string,
    personalRecords: DetectedPersonalRecord[],
    wasReplay: boolean,
  ): Promise<RecordedSession> {
    // Re-fetch the full nested session inside the same tx so the response
    // reflects the post-PR-detection state — in particular the
    // `is_personal_record` flags PR detection flips on canonical PR sets. The
    // bare `.returning()` snapshots from the insert are pre-detection and would
    // lie on the wire (mobile relies on these flags for the Summary screen's PR
    // badge). Querying inside the tx guarantees we see our own writes.
    const [refreshedSession] = await tx
      .select()
      .from(workoutSessions)
      .where(eq(workoutSessions.id, sessionId))
      .limit(1);

    const refreshedExercises = await tx
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.sessionId, sessionId))
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

    // Current-calendar-month completed-workout count for this user, computed
    // inside the same transaction so the COUNT(*) sees the row we just inserted
    // (when `status='completed'`). Drives the legacy Summary screen's "Workouts
    // this month" stat + the subtitle "You've completed N workouts this month.
    // Keep the momentum going!"
    //
    // Scoping rationale (Brad's call after the Phase 3b device review):
    // cumulative all-time count drifts upward indefinitely and stops surfacing
    // meaningful momentum after the first few months. Scoping to the current
    // month gives established users a number that actually resets and grows each
    // session.
    //
    // Filter:
    //   * `status = 'completed'`  — cancelled sessions count themselves out.
    //   * `COALESCE(completed_at, created_at) >= date_trunc('month', now())` —
    //     month-start in the DB timezone. COALESCE with created_at catches any
    //     legacy rows whose completed_at is NULL (they existed under the pre-PR-3
    //     all-time filter and would otherwise fall out of scope now). Fresh
    //     writes always carry a non-null completed_at when status = 'completed'.
    //     Matches dashboardRepository's `workoutsThisMonth` bucketing.
    const [totalsRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
          sql`COALESCE(${workoutSessions.completedAt}, ${workoutSessions.createdAt}) >= date_trunc('month', now())`,
        ),
      );
    const workoutsThisMonth = totalsRow?.count ?? 0;

    return {
      ...refreshedSession,
      exercises: refreshedExercises.map((e) => ({
        ...e,
        sets: setsByExerciseId.get(e.id) ?? [],
      })),
      personalRecords,
      workoutsThisMonth,
      wasReplay,
    };
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
