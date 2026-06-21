import type {
  CachedDashboard,
  DashboardPayload,
} from "@/domain/models/dashboard";
import type { Exercise, ExerciseFilters } from "@/domain/models/exercise";
import type {
  CachedProfilePage,
  ProfilePageData,
} from "@/domain/models/profilePage";
import type { Notification } from "@/domain/models/notification";
import type { NotificationPreferences } from "@/domain/models/notification-preferences";
import type { PersonalRecord, RecordType } from "@/domain/models/record";
import type {
  ReferenceEntry,
  ReferenceList,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import type { ExerciseSet, WorkoutSession } from "@/domain/models/session";
import type {
  CachedWorkoutDetail,
  CachedWorkoutsList,
  Workout,
  WorkoutListType,
  WorkoutQuota,
} from "@/domain/models/workout";
import type {
  EntitlementVerdict,
  SyncOperation,
  SyncStatus,
} from "@/domain/ports/sync.types";
import type {
  HomePayload,
  BodyTrendPoint,
  VolumeStats,
} from "@/domain/models/progress";
import type { Streak } from "@/domain/models/streak";
import type { Achievement } from "@/domain/models/achievement";
import type { HabitCompletion } from "@/domain/models/habit-completion";

/**
 * One row in the recent-sets cache. Keyed by (userId, exerciseId,
 * setNumber); last-write-wins on upsert. Carries the weight + reps the
 * user logged on their most recent attempt at that set number for that
 * exercise. Null weight or null reps are filtered out at upsert time.
 */
export type RecentSetEntry = {
  exerciseId: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  /** ISO timestamp from the originating session's completedAt. */
  recordedAt: string;
};

/**
 * Port for local persistence (SQLite).
 * Implementations: SQLiteStorageAdapter (prod), InMemoryStorageAdapter (test).
 *
 * Methods are added per-feature milestone.
 */
export interface StoragePort {
  /** Initialize local database tables */
  initialize(): Promise<void>;

  // -- Sync Queue --
  enqueueMutation(entry: EnqueueMutationInput): void;
  getPendingMutations(): SyncQueueEntry[];
  /**
   * Atomically claim a queue entry: flips status to `in_flight` ONLY
   * when the row is currently `pending` or `failed`. Returns `true`
   * if the caller now owns the entry (proceed with the fetch),
   * `false` if another drain has already claimed it (skip silently).
   *
   * This is the storage-layer guard against concurrent drains
   * processing the same entry — Inspector Brad PR #62 found this
   * race after the inline post-Submit drain landed: `useSyncWorker`
   * has its own `flushingRef` but the inline call from
   * `WorkoutRatingContainer.onSubmit` doesn't see that ref. With an
   * unconditional UPDATE, both drains could mark the same entry
   * in-flight + fire duplicate POSTs (and `recordSession` has no
   * idempotency key, so the server would create two session rows).
   * Conditional UPDATE + affected-rows check prevents that at the
   * SQL level, no matter how many concurrent callers exist.
   */
  markMutationInFlight(id: number): boolean;
  markMutationCompleted(id: number): void;
  markMutationFailed(id: number, errorMessage: string): void;
  /**
   * Rewrite the payload of an already-queued mutation, in place. Only
   * touches entries still in `pending` or `failed` — never an `in_flight`
   * entry (a drain may have already serialized its body) nor a
   * `completed`/`blocked_entitlement` one. No-op when the id isn't a
   * rewritable entry.
   *
   * Powers offline edit-coalescing (04.6): when a user edits an exercise
   * whose create POST hasn't flushed yet, `updateExerciseCommand` rewrites
   * that pending create's payload instead of enqueueing a second mutation
   * against a server id that doesn't exist yet. It also coalesces rapid
   * re-edits of an already-synced exercise onto a single pending PATCH.
   *
   * `payload` is serialized the same way as `enqueueMutation` so the
   * stored wire-format stays consistent.
   */
  updateMutationPayload(id: number, payload: unknown): void;
  /**
   * M10.6: flip a queue entry to `blocked_entitlement` and persist the
   * server's verdict on the row. The sync worker calls this in response
   * to HTTP 402 + `code: "ENTITLEMENT_DENIED"` and CONTINUES processing
   * the rest of the queue (one blocked entry never aborts the flush).
   *
   * Blocked entries are excluded from `getPendingMutations()` — they
   * only re-enter the pool via `unblockEntries` (called by
   * `useAutoRetryOnUpgrade` on tier-change or by an explicit user
   * "Retry" action) or via `discardEntries` (delete entirely).
   *
   * Verdict is stored on the row as JSON so a single-column schema
   * extension keeps the migration trivial (no sibling table) and
   * survives app restarts (AC 12.2).
   *
   * Spec: specs/11-payments-subscriptions/design.md § Sync-queue entitlement handling (M10.6)
   * Satisfies: requirements.md AC 12.1, 12.2
   */
  markMutationBlocked(id: number, verdict: EntitlementVerdict): void;
  /**
   * Read all entries currently in the `blocked_entitlement` state.
   * Powers `useBlockedSyncEntries` (banner + review screen) and the
   * tier-change unblock logic in `useAutoRetryOnUpgrade`.
   *
   * Returned in FIFO order (oldest first) so the UI's "earliest
   * blocked at" derives from the head row without an extra scan.
   */
  getBlockedEntries(): SyncQueueEntry[];
  /**
   * Flip the given entry ids from `blocked_entitlement` back to
   * `pending` and clear their stored verdict. Used by:
   *   1. Explicit user retry ("Retry these N items" on /sync-blocked)
   *   2. `useAutoRetryOnUpgrade` after observing a satisfying tier change
   *
   * Silently skips ids that aren't currently `blocked_entitlement`
   * (defensive — the verdict might already have been cleared by another
   * tab / a concurrent unblock).
   */
  unblockEntries(ids: readonly number[]): void;
  /**
   * Permanently delete the given queue entries. Called from the Discard
   * CTA on /sync-blocked. The container is responsible for any local-
   * data cleanup (e.g. the cached workout row the entry referenced) —
   * the storage layer doesn't reference-count across mutation types.
   */
  discardEntries(ids: readonly number[]): void;
  getSyncStats(): SyncStats;
  pruneCompletedMutations(olderThanHours?: number): void;

  // -- Sync Metadata --
  getLastSyncedAt(entityType: string): string | null;
  setLastSyncedAt(entityType: string, timestamp: string): void;

  // -- Exercise Cache --
  /** Read cached exercises, applying filters locally for instant response. */
  getCachedExercises(filters?: ExerciseFilters): Exercise[];
  /** Upsert a batch of exercises into the local cache (single transaction). */
  cacheExercises(exercises: Exercise[]): void;
  /** Read a single cached exercise by id, or null if not found. */
  getCachedExercise(id: string): Exercise | null;
  /** Age of the exercise cache as an ISO timestamp, or null if empty. */
  getExerciseCacheAge(): string | null;
  /**
   * Save a custom (user-created) exercise to the cache. Identical shape to
   * `cacheExercises` for a single row, but semantically separate so call-sites
   * document intent. Must set isCustom=true on the stored payload.
   */
  saveCustomExercise(exercise: Exercise): void;

  /**
   * Remove a single cached exercise by id. No-op when the row isn't
   * cached. Used by the delete-exercise command after a successful
   * API DELETE so the list updates immediately.
   */
  removeCachedExercise(id: string): void;

  // -- Reference-List Cache --
  /**
   * Read the cached reference list for a kind, or null if not cached yet.
   *
   * Spec: design.md § Reference-List Cache > Port extensions · AC 7.10, 7.14
   */
  getCachedReferenceList(kind: ReferenceListKind): ReferenceList | null;
  /**
   * Replace the cached entries for a kind in a single operation. Sets
   * `synced_at` to now in implementation.
   */
  cacheReferenceList(kind: ReferenceListKind, entries: ReferenceEntry[]): void;
  /**
   * Age of the cached reference list as an ISO timestamp, or null if empty.
   * Equivalent to `getCachedReferenceList(kind)?.syncedAt ?? null` but
   * cheaper when the caller only needs the timestamp.
   */
  getReferenceListAge(kind: ReferenceListKind): string | null;

  // -- Workouts Cache (M2) --
  /**
   * Read the cached workouts list slice for `(userId, type)`. Returns
   * null when the slice has never been cached. The query layer uses this
   * + `isWorkoutsListStale` to decide whether to render cache-first then
   * background-refresh.
   *
   * Spec: specs/04-workout-management/design.md § SQLite cache shape
   */
  getCachedWorkoutsList(
    userId: string,
    type: WorkoutListType,
  ): CachedWorkoutsList | null;

  /**
   * Write-through the latest backend list slice for `(userId, type)`.
   * Stamps `syncedAt = now()`. `quota` should be non-null only when
   * `type='mine'` (matching the backend's envelope semantics).
   */
  cacheWorkoutsList(
    userId: string,
    type: WorkoutListType,
    workouts: Workout[],
    quota: WorkoutQuota | null,
  ): void;

  /** ISO timestamp of the last cached refresh, or null if no row. */
  getWorkoutsListAge(userId: string, type: WorkoutListType): string | null;

  /**
   * Read the cached single-workout detail. Populated by the popover
   * detail open and refreshed by every list refetch (the list response
   * carries full workout payloads, so we splatter them into the detail
   * cache too).
   */
  getCachedWorkoutDetail(
    userId: string,
    workoutId: string,
  ): CachedWorkoutDetail | null;

  /** Write-through the workout detail. Stamps `syncedAt = now()`. */
  cacheWorkoutDetail(userId: string, workout: Workout): void;

  /**
   * Remove a workout from list + detail caches after a successful
   * delete. No-op when the rows aren't cached.
   */
  removeCachedWorkout(userId: string, workoutId: string): void;

  // -- Dashboard Cache (M1) --
  /**
   * Read the cached dashboard payload for a user, or null if none.
   *
   * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
   *       (M1) > Offline cache · requirements.md STORY-005 AC 5.9
   */
  getCachedDashboard(userId: string): CachedDashboard | null;
  /**
   * Write-through the latest backend payload for a user, stamping
   * `syncedAt = now()`.
   */
  cacheDashboard(userId: string, payload: DashboardPayload): void;
  /**
   * Age of the cached dashboard as an ISO timestamp, or null if none.
   * Equivalent to `getCachedDashboard(userId)?.syncedAt ?? null` but
   * cheaper when only the timestamp is needed (stale-indicator caption).
   */
  getDashboardAge(userId: string): string | null;
  /**
   * Drop the cached dashboard payload for a user. Called by mutation
   * commands that change data the dashboard depends on (e.g. workout
   * create / edit / delete affects `recentWorkouts`) so the next
   * dashboard read sees the cache as missing/stale and triggers a
   * fresh fetch instead of showing the pre-mutation snapshot.
   */
  invalidateDashboard(userId: string): void;

  // -- Notifications Cache (09) --
  /**
   * Read cached notifications, newest-first, capped at `limit` (default
   * 100 — the LRU bound). Powers the offline-first list render before
   * the background refresh. Not user-scoped: the cache holds one user's
   * rows at a time (wiped on sign-out via clearAll).
   *
   * Spec: specs/09-notifications-social/design.md § SQLite cache schema
   */
  getCachedNotifications(limit?: number): Notification[];
  /**
   * Upsert a batch of notifications (server-truth wins on id conflict),
   * then prune to the newest 100 by `created_at` (LRU). Called by the
   * list refresh write-through.
   */
  cacheNotifications(notifications: Notification[]): void;
  /**
   * Count cached unread rows (`read_at IS NULL`). Offline fallback for
   * the bell badge; the server-authoritative count comes from the list
   * response when online.
   */
  getCachedUnreadCount(): number;
  /**
   * Optimistically mark one cached row read. COALESCE semantics — only
   * stamps `read_at` when currently null — so an offline mark then a
   * later sync replay preserves the original moment (locked decision #3).
   */
  markCachedNotificationRead(id: string, readAt: string): void;
  /** Optimistically mark every cached unread row read (COALESCE). */
  markAllCachedNotificationsRead(readAt: string): void;
  /**
   * Read the cached per-type opt-in map, or null when nothing is cached
   * yet. Normalised to known types on read.
   */
  getCachedNotificationPreferences(): NotificationPreferences | null;
  /**
   * Write-through the per-type opt-in map (single row). Called on
   * preferences fetch, on optimistic toggle, and on sync-flush reset to
   * the server's merged column.
   */
  cacheNotificationPreferences(preferences: NotificationPreferences): void;

  // -- Profile-Page Cache (M6) --
  /**
   * Read the cached `/profile/page` payload for a user, or null if
   * none. One row per user — same shape as `cached_dashboard`.
   *
   * Spec: specs/milestones/M6-profile/BACKEND_BRIEF.md § Local-DB caching
   */
  getCachedProfilePage(userId: string): CachedProfilePage | null;
  /**
   * Write-through the latest backend payload for a user, stamping
   * `syncedAt = now()`.
   */
  cacheProfilePage(userId: string, payload: ProfilePageData): void;
  /**
   * Age of the cached profile-page row as an ISO timestamp, or null
   * when no row exists. Lets a caller fetch only the timestamp
   * without parsing the full JSON blob.
   */
  getProfilePageAge(userId: string): string | null;
  /**
   * Drop the cached profile-page payload for a user. Called by the
   * future PATCH /profile mutation (M6 PR-4) so a stale view doesn't
   * survive an edit. Available now so the storage surface stays
   * symmetrical with `invalidateDashboard`.
   */
  invalidateProfilePage(userId: string): void;

  // -- Home / Progress cache (M4 — 06-progress-goals) --
  /** Cached aggregate Home payload (cache-first cold-start render). */
  getCachedHome(userId: string): HomePayload | null;
  getHomeAge(userId: string): string | null;
  cacheHome(userId: string, payload: HomePayload): void;
  invalidateHome(userId: string): void;

  /** Cached streak rows (StreakHero + the deriveStreak server reconciliation). */
  getCachedStreaks(userId: string): Streak[];
  cacheStreaks(userId: string, streaks: Streak[]): void;

  /** Cached unlocked achievements (milestones row + drawer count). */
  getCachedAchievements(userId: string): Achievement[];
  cacheAchievements(userId: string, achievements: Achievement[]): void;

  /** Cached body-measurement trend (sparkline) — optimistic weigh-in appends here. */
  getCachedBodyTrend(userId: string): BodyTrendPoint[];
  cacheBodyTrend(userId: string, series: BodyTrendPoint[]): void;

  /** Cached You/Progress volume stats (workouts, tonnes, adherence, by-muscle). */
  getCachedVolumeStats(userId: string): VolumeStats | null;
  cacheVolumeStats(userId: string, stats: VolumeStats): void;

  /**
   * Row-level habit-completion cache — feeds the 7-day grid + the offline
   * `deriveStreak` walk. `since` filters to completions on/after a YYYY-MM-DD.
   */
  getCachedHabitCompletions(
    userId: string,
    opts?: { goalId?: string; since?: string },
  ): HabitCompletion[];
  /** Replace the whole cached set for a user (server refresh — server wins). */
  cacheHabitCompletions(userId: string, rows: HabitCompletion[]): void;
  /** Optimistic toggle-on: idempotent per (user, goal, local day). */
  upsertHabitCompletion(row: {
    id: string;
    userId: string;
    goalId: string;
    day: string;
    completedAt: string;
    value: number | null;
  }): void;
  /** Optimistic toggle-off for a (user, goal, local day). */
  removeHabitCompletion(userId: string, goalId: string, day: string): void;

  // -- Active Session (M3) --
  /**
   * Read the user's in-progress session, joining the three normalized
   * tables (`active_sessions` + `session_exercises` + `exercise_sets`)
   * back into a single `WorkoutSession`. Returns null when no row
   * exists. Single-active-session invariant — at most one row per
   * user.
   *
   * Spec: specs/05-active-session/requirements.md STORY-001 / STORY-008
   *       specs/milestones/M3-active-session/FRONTEND_BRIEF.md § StoragePort extensions
   */
  getActiveSession(userId: string): WorkoutSession | null;

  /**
   * Return the user's most recent session row regardless of status.
   * Used by the post-rating Summary screen to render stats AFTER
   * `completeSessionCommand` has flipped the row to `completed` (at
   * which point `getActiveSession` returns null). Distinct from
   * `getActiveSession` so the screens that genuinely need an
   * in-progress row (banner, active screen, rating screen) keep
   * their status filter.
   */
  getLatestSession(userId: string): WorkoutSession | null;

  /**
   * Write-through the entire session as a full upsert. Replaces the
   * three nested tables atomically per EXECUTION_PLAN § 3.4 — the
   * storage layer never sees partial sortOrder updates. Idempotent.
   */
  cacheActiveSession(userId: string, session: WorkoutSession): void;

  /**
   * Delete the user's session row regardless of status — used after
   * the Summary screen's Continue button to retire a flushed
   * `completed` / `cancelled` row. The pre-flush in-progress
   * surface only ever calls this implicitly via the worker's
   * post-success swap path.
   */
  clearActiveSession(userId: string): void;

  /**
   * Return `ExerciseSet` rows for `(sessionId, exerciseId)` scoped to
   * the user. Used by `SetLogger` quick-fill suggestions when the
   * personalRecords cache has nothing for the exercise (FRONTEND_BRIEF
   * § Group D).
   *
   * Empty array when the session is not the user's active session,
   * the exercise is absent, or no sets exist yet — never throws.
   */
  getSessionSets(
    userId: string,
    sessionId: string,
    exerciseId: string,
  ): ExerciseSet[];

  /**
   * Read the user's most recent set values keyed by (exerciseId,
   * setNumber) for the supplied exercises. Drives the legacy "Previous"
   * hint chip on each SetLogger row, mirroring legacy
   * `user_history.recent_sets`. Returns a nested map: outer key is
   * exerciseId, inner key is setNumber. Missing entries indicate the
   * user has never logged that exercise (or that set number) before.
   *
   * Out-of-band exerciseIds (not in the recent-sets cache) are simply
   * omitted from the result; callers treat absence as "no previous".
   */
  getRecentSetsByExercise(
    userId: string,
    exerciseIds: readonly string[],
  ): Record<string, Record<number, { weightKg: number; reps: number }>>;

  /**
   * Upsert the just-completed session's logged sets into the recent-sets
   * cache. Last-write-wins per (userId, exerciseId, setNumber) — a new
   * session's set 1 replaces any prior recent-sets entry for that
   * setNumber. Sets with null weight or null reps are skipped (no
   * meaningful "previous" hint to surface). Called from
   * `completeSessionCommand` immediately after the active-session row
   * flips to `completed`, before the bulk-record flush — local cache is
   * the source of truth for next-session "previous" hints.
   */
  upsertRecentSets(userId: string, sets: readonly RecentSetEntry[]): void;

  /**
   * Persist the server's augmented `/sessions/record` response — the
   * PR-of-the-session list (with `previousValue` for the "before →
   * after" arrow) and `workoutsThisMonth` count — so the Summary
   * screen can swap its local prediction for server-truth once the
   * sync worker drains the queue. Single row per user (single-active-
   * session invariant); last-write-wins. Cleared by
   * `clearActiveSession` so a fresh session never reads stale data
   * from the previous one.
   *
   * Lifecycle (the "α cache-and-subscribe" design):
   *   1. completeSessionCommand → cacheActiveSession + enqueueMutation
   *      → router.replace("/(app)/session/summary")
   *   2. Summary screen mounts → reads getLatestSession + local
   *      `detectPersonalRecords` → renders local prediction
   *   3. useSyncWorker drains the queue → POST /sessions/record →
   *      parses response → cacheRecordResponse(userId, ...)
   *   4. Summary container's poll detects the new cache slot → re-
   *      renders with server data (real previousValue / total count)
   *   5. User taps Continue → clearActiveSession (also clears this
   *      cache) → modal stack collapses
   */
  cacheRecordResponse(userId: string, response: RecordResponseSummary): void;

  /**
   * Read the cached `/sessions/record` server response for this user.
   * Returns null until the sync worker drains the bulk-record POST
   * (or if the user is offline). The Summary screen polls this slot
   * on focus + an interval so the cards re-render in place when the
   * server response lands.
   */
  getRecordResponse(userId: string): RecordResponseSummary | null;

  /**
   * Drop the cached record-response. Called by `clearActiveSession`
   * implicitly so the two lifecycles stay aligned, and available as a
   * standalone for tests that want to assert the cache is empty after
   * a clear.
   */
  clearRecordResponse(userId: string): void;

  /**
   * Upsert PR rows by `(userId, exerciseId, recordType)`. Latest write
   * wins — server-canonical reconciliation overwrites the predictive
   * client write after the bulk-record flush returns.
   */
  cachePersonalRecords(userId: string, records: PersonalRecord[]): void;

  /**
   * Read the user's PR cache, optionally filtered by exerciseId. Feeds
   * the Summary screen's predictive PR detector + SetLogger quick-fill.
   */
  getPersonalRecords(userId: string, exerciseId?: string): PersonalRecord[];

  /**
   * Rewrite `local-…`-prefixed ids on the four M3 tables once the
   * bulk-record flush returns server-assigned ids. Called from the
   * sync worker's reply path. No-op when neither the session nor any
   * nested row matches `localId`.
   *
   * Spec: specs/milestones/M3-active-session/EXECUTION_PLAN.md § 4
   */
  swapLocalSessionId(localId: string, serverId: string): void;

  /**
   * Rewrite a custom exercise's optimistic `local-…` id to the server-
   * assigned id once its create POST flushes. Updates the cached row (both
   * the PK and the id embedded in its blob) and re-points any queued
   * exercise mutations still addressed to the local id (a follow-up
   * PATCH/DELETE enqueued after the create completed). No-op when the ids
   * match or nothing references `localId`.
   *
   * Without this, a synced custom exercise keeps its `local-…` id until the
   * next full refresh — so the next edit enqueues `PATCH /exercises/local-…`
   * which 404s on every retry (the edit is silently dropped), and the
   * refresh duplicates the row under its real id. Mirrors
   * `swapLocalSessionId`. Called from the sync worker's reply path.
   */
  swapLocalExerciseId(localId: string, serverId: string): void;

  /**
   * Read the rest-timer state (started-at + total-seconds) for the
   * user's active session. Stored inline on `active_sessions` per
   * EXECUTION_PLAN § 3.1 — single-active-session invariant means a
   * separate timers table is overhead. Null when no active session
   * or when the timer is not running.
   */
  getRestTimerState(userId: string): RestTimerState | null;

  /**
   * Persist rest-timer start. Drift-tolerant: the hook reconciles
   * `wall-clock - startedAt` on resume so the timer survives
   * backgrounding without a wakeup tick.
   */
  setRestTimerState(userId: string, state: RestTimerState): void;

  /**
   * Clear the rest-timer state (Skip / Dismiss / Done). No-op when
   * no active session.
   */
  clearRestTimerState(userId: string): void;

  // -- Lifecycle --
  /** Clear all user data (sync queue, cached entities, metadata). Called on sign-out. */
  clearAll(): void;
}

/**
 * Persisted rest-timer state. Lives on the `active_sessions` row
 * (rest_timer_started_at + rest_timer_total_seconds columns).
 */
export type RestTimerState = {
  /** ISO timestamp the timer started. */
  startedAt: string;
  totalSeconds: number;
};

export type EnqueueMutationInput = {
  entityType: string;
  entityId?: string;
  operation: SyncOperation;
  payload: unknown;
  endpoint: string;
  method: string;
};

export type SyncQueueEntry = {
  id: number;
  entityType: string;
  entityId: string | null;
  operation: SyncOperation;
  payload: string;
  endpoint: string;
  method: string;
  status: SyncStatus;
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  createdAt: string;
  /**
   * M10.6: present iff `status === "blocked_entitlement"`. Captures the
   * server-side verdict (feature + currentTier + upgradeTo +
   * upgradePriceMonthly + blockedAt) at the moment the 402 landed.
   * Persisted as a JSON blob in the SQLite `entitlement_verdict`
   * column; the storage layer parses on read so callers always see
   * the camelCase object.
   */
  entitlementVerdict: EntitlementVerdict | null;
};

export type SyncStats = {
  pending: number;
  failed: number;
  inFlight: number;
  /**
   * M10.6: count of entries currently in `blocked_entitlement`.
   * Distinct from `failed` because the entry has a definitive verdict
   * from the server — retrying without a tier change won't help.
   */
  blocked: number;
};

/**
 * Per-PR entry inside the cached `/sessions/record` response. Mirrors
 * the backend's `DetectedPersonalRecord` shape 1:1 (every field that
 * lands on the wire). `previousValue` is always non-null for surfaced
 * PRs — first-occurrence records are filtered server-side per Brad's
 * "no PRs on the first workout" rule, so the client never has to
 * branch on the absence.
 *
 * Spec: microservices/core/src/application/repositories/personalRecordsRepository.ts
 *       (DetectedPersonalRecord). Numbers arrive 2dp-rounded — the
 *       server does the toFixed(2) → parseFloat round-trip so the
 *       client renders the same value the DB persisted.
 */
export type RecordResponseSummaryPR = {
  exerciseId: string;
  exerciseName: string;
  recordType: RecordType;
  newValue: number;
  previousValue: number;
  setId: string;
};

export type RecordResponseSummary = {
  /**
   * The local-prefixed session id whose POST produced this cache
   * entry. Single-active-session invariant means this is always the
   * user's current session at write time. Used by the
   * `SessionSummaryContainer` poll to reject stale cache slots from
   * a prior session that haven't been cleared yet (Inspector Brad
   * PR #62 regression).
   */
  localSessionId: string;
  personalRecords: readonly RecordResponseSummaryPR[];
  /**
   * The user's completed-workout count for the current calendar month
   * (including the just-recorded session when its status is
   * `completed`), sourced from the server response. `null` when the
   * server response either didn't carry the field or carried it as
   * null — the Summary screen then falls back to its em-dash +
   * dropped-count subtitle, exactly as it does pre-server.
   * Distinguished from a literal `0` so a deploy skew or partial
   * backend rollback can't cause the presenter to render "You've
   * completed 0 workouts this month" immediately after the user has
   * finished a workout (Inspector Brad PR #62 medium-severity).
   *
   * Renamed from `totalWorkoutsCompleted` in PR #62's follow-up —
   * Brad's call after the Phase 3b device review was that an all-time
   * count drifts upward forever and stops being meaningful; the tile
   * now resets at every calendar-month boundary so established users
   * get a number that actually moves session-to-session.
   */
  workoutsThisMonth: number | null;
  /** ISO timestamp the response was cached at. */
  cachedAt: string;
};
