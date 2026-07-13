import type {
  CachedDashboard,
  DashboardPayload,
} from "@/domain/models/dashboard";
import {
  deriveExerciseOwnership,
  type Exercise,
  type ExerciseFilters,
} from "@/domain/models/exercise";
import type {
  CachedProfilePage,
  ProfilePageData,
} from "@/domain/models/profilePage";
import type { Notification } from "@/domain/models/notification";
import type { NotificationPreferences } from "@/domain/models/notification-preferences";
import type { CoachOverview } from "@/domain/models/coachOverview";
import type { ClientDetail } from "@/domain/models/clientDetail";
import type { TrainerClient } from "@/domain/models/trainerClient";
import type { ProgramSummary } from "@/domain/models/program";
import type { PersonalRecord } from "@/domain/models/record";
import type {
  ReferenceEntry,
  ReferenceList,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import type { ExerciseSet, WorkoutSession } from "@/domain/models/session";
import type {
  CachedWorkoutDetail,
  CachedWorkoutHistory,
  CachedWorkoutsList,
  Workout,
  WorkoutHistory,
  WorkoutListType,
  WorkoutQuota,
} from "@/domain/models/workout";
import { filterExercises } from "@/domain/services/exercise.service";
import type {
  StoragePort,
  SyncQueueEntry,
  SyncStats,
  EnqueueMutationInput,
  RecentSetEntry,
  RecordResponseSummary,
  RestTimerState,
} from "@/domain/ports/storage.port";
import type {
  HomePayload,
  BodyTrendPoint,
  VolumeStats,
} from "@/domain/models/progress";
import type { Streak } from "@/domain/models/streak";
import type { Achievement } from "@/domain/models/achievement";
import type { Goal } from "@/domain/models/goal";
import type { HabitCompletion } from "@/domain/models/habit-completion";
import type { HabitConfig } from "@/domain/models/habit-config";
import type { EntitlementVerdict, SyncStatus } from "@/domain/ports/sync.types";
import type {
  Food,
  FuelToday,
  Meal,
  NutritionTarget,
  Recipe,
} from "@/domain/models/nutrition";

/**
 * In-memory storage adapter for testing.
 * No SQLite dependency — stores everything in arrays/maps.
 */
export class InMemoryStorageAdapter implements StoragePort {
  private queue: SyncQueueEntry[] = [];
  private metadata: Map<string, string> = new Map();
  private exerciseCache: Map<string, { exercise: Exercise; syncedAt: string }> =
    new Map();
  private referenceLists: Map<ReferenceListKind, ReferenceList> = new Map();
  private dashboardCache: Map<string, CachedDashboard> = new Map();
  private coachOverviewCache: Map<
    string,
    { payload: CoachOverview; syncedAt: string }
  > = new Map();
  private clientDetailCache: Map<
    string,
    { payload: ClientDetail; syncedAt: string }
  > = new Map();
  private trainerClientsCache: Map<
    string,
    { payload: TrainerClient[]; syncedAt: string }
  > = new Map();
  private programsCache: Map<
    string,
    { payload: ProgramSummary[]; syncedAt: string }
  > = new Map();
  private profilePageCache: Map<string, CachedProfilePage> = new Map();
  private workoutsListCache: Map<string, CachedWorkoutsList> = new Map();
  private workoutDetailCache: Map<string, CachedWorkoutDetail> = new Map();
  private workoutHistoryCache: Map<string, CachedWorkoutHistory> = new Map();
  private activeSessions: Map<string, WorkoutSession> = new Map();
  private recordResponses: Map<string, RecordResponseSummary> = new Map();
  private personalRecords: Map<string, PersonalRecord[]> = new Map();
  private recentSets: Map<string, RecentSetEntry[]> = new Map();
  private restTimers: Map<string, RestTimerState> = new Map();
  private notificationsCache: Map<string, Notification> = new Map();
  private notificationPreferencesCache: NotificationPreferences | null = null;
  private nextId = 1;

  private workoutsListKey(userId: string, type: WorkoutListType): string {
    return `${userId}::${type}`;
  }

  private workoutDetailKey(userId: string, workoutId: string): string {
    return `${userId}::${workoutId}`;
  }

  async initialize(): Promise<void> {
    // No-op for in-memory
  }

  enqueueMutation(entry: EnqueueMutationInput): void {
    this.queue.push({
      id: this.nextId++,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      operation: entry.operation,
      payload: JSON.stringify(entry.payload),
      endpoint: entry.endpoint,
      method: entry.method,
      status: "pending",
      retryCount: 0,
      maxRetries: 3,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      entitlementVerdict: null,
    });
  }

  getPendingMutations(): SyncQueueEntry[] {
    // M10.6: parity with SQLite — `blocked_entitlement` is excluded.
    // Those entries only re-enter the pool via `unblockEntries` (tier
    // upgrade or explicit user retry) or get deleted via `discardEntries`.
    return this.queue.filter(
      (e) =>
        (e.status === "pending" || e.status === "failed") &&
        e.retryCount < e.maxRetries,
    );
  }

  markMutationInFlight(id: number): boolean {
    // Mirror the SQLite adapter's row-conditional claim: returns
    // `true` only when the entry was actually flipped from
    // pending/failed → in_flight. A second concurrent caller racing
    // for the same id gets `false` and skips. Inspector Brad PR #62
    // race fix; see storage.port.ts:50-67 for the full context.
    const entry = this.queue.find((e) => e.id === id);
    if (!entry) return false;
    if (entry.status !== "pending" && entry.status !== "failed") return false;
    entry.status = "in_flight";
    return true;
  }

  markMutationCompleted(id: number): void {
    this.updateStatus(id, "completed");
  }

  markMutationFailed(id: number, errorMessage: string): void {
    const entry = this.queue.find((e) => e.id === id);
    if (entry) {
      entry.status = "failed";
      entry.errorMessage = errorMessage;
      entry.retryCount++;
    }
  }

  updateMutationPayload(id: number, payload: unknown): void {
    // Mirror the SQLite adapter: only `pending`/`failed` entries are
    // rewritable. An in-flight entry may already be mid-flush; a
    // completed/blocked one is done. No-op otherwise.
    const entry = this.queue.find((e) => e.id === id);
    if (!entry) return;
    if (entry.status !== "pending" && entry.status !== "failed") return;
    entry.payload = JSON.stringify(payload);
  }

  markMutationBlocked(id: number, verdict: EntitlementVerdict): void {
    // M10.6: parity with SQLite — flip to blocked_entitlement and
    // persist the verdict. `errorMessage` + `retryCount` untouched so
    // the unblock path returns the row to pending with its budget intact.
    const entry = this.queue.find((e) => e.id === id);
    if (!entry) return;
    entry.status = "blocked_entitlement";
    entry.entitlementVerdict = { ...verdict };
  }

  getBlockedEntries(): SyncQueueEntry[] {
    // FIFO order — the in-memory queue is already insertion-ordered
    // since we push to the end.
    return this.queue
      .filter((e) => e.status === "blocked_entitlement")
      .map((e) => ({
        ...e,
        entitlementVerdict: e.entitlementVerdict
          ? { ...e.entitlementVerdict }
          : null,
      }));
  }

  unblockEntries(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    for (const entry of this.queue) {
      if (!idSet.has(entry.id)) continue;
      if (entry.status !== "blocked_entitlement") continue;
      entry.status = "pending";
      entry.entitlementVerdict = null;
    }
  }

  discardEntries(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    this.queue = this.queue.filter((e) => !idSet.has(e.id));
  }

  getFailedExhaustedEntries(): SyncQueueEntry[] {
    // Parity with SQLite: FIFO order (insertion-ordered already, we
    // just push to the end).
    return this.queue.filter(
      (e) => e.status === "failed" && e.retryCount >= e.maxRetries,
    );
  }

  resetFailedEntries(ids: readonly number[]): void {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    for (const entry of this.queue) {
      if (!idSet.has(entry.id)) continue;
      if (entry.status !== "failed") continue;
      entry.status = "pending";
      entry.retryCount = 0;
      entry.errorMessage = null;
    }
  }

  getSyncStats(): SyncStats {
    const stats: SyncStats = { pending: 0, failed: 0, inFlight: 0, blocked: 0 };
    for (const entry of this.queue) {
      if (entry.status === "pending") stats.pending++;
      else if (entry.status === "failed") stats.failed++;
      else if (entry.status === "in_flight") stats.inFlight++;
      else if (entry.status === "blocked_entitlement") stats.blocked++;
    }
    return stats;
  }

  pruneCompletedMutations(_olderThanHours?: number): void {
    this.queue = this.queue.filter((e) => e.status !== "completed");
  }

  getLastSyncedAt(entityType: string): string | null {
    return this.metadata.get(entityType) ?? null;
  }

  setLastSyncedAt(entityType: string, timestamp: string): void {
    this.metadata.set(entityType, timestamp);
  }

  getCachedExercises(filters?: ExerciseFilters): Exercise[] {
    const all = Array.from(this.exerciseCache.values()).map((v) =>
      deriveExerciseOwnership(v.exercise),
    );
    if (!filters) return all;
    return filterExercises(all, filters);
  }

  cacheExercises(exercises: Exercise[]): void {
    const now = new Date().toISOString();
    for (const exercise of exercises) {
      this.exerciseCache.set(exercise.id, { exercise, syncedAt: now });
    }
  }

  getCachedExercise(id: string): Exercise | null {
    const cached = this.exerciseCache.get(id)?.exercise;
    return cached ? deriveExerciseOwnership(cached) : null;
  }

  getExerciseCacheAge(): string | null {
    if (this.exerciseCache.size === 0) return null;
    let oldest: string | null = null;
    for (const { syncedAt } of this.exerciseCache.values()) {
      if (oldest === null || syncedAt < oldest) oldest = syncedAt;
    }
    return oldest;
  }

  saveCustomExercise(exercise: Exercise): void {
    this.exerciseCache.set(exercise.id, {
      exercise: { ...exercise, isCustom: true },
      syncedAt: new Date().toISOString(),
    });
  }

  removeCachedExercise(id: string): void {
    this.exerciseCache.delete(id);
  }

  swapLocalExerciseId(localId: string, serverId: string): void {
    if (localId === serverId) return;
    const entry = this.exerciseCache.get(localId);
    if (entry) {
      this.exerciseCache.delete(localId);
      this.exerciseCache.set(serverId, {
        exercise: { ...entry.exercise, id: serverId },
        syncedAt: entry.syncedAt,
      });
    }
    for (const e of this.queue) {
      if (e.entityType === "exercise" && e.entityId === localId) {
        e.entityId = serverId;
        if (e.endpoint === `/exercises/${localId}`) {
          e.endpoint = `/exercises/${serverId}`;
        }
      }
    }
  }

  swapLocalNutritionEntryId(localId: string, serverId: string): void {
    if (localId === serverId) return;
    for (const { payload } of this.fuelTodayCache.values()) {
      for (const list of Object.values(payload.entriesBySlot)) {
        for (const e of list) {
          if (e.id === localId) e.id = serverId;
        }
      }
    }
    for (const e of this.queue) {
      if (e.entityType === "nutrition_entry" && e.entityId === localId) {
        e.entityId = serverId;
        if (e.endpoint === `/nutrition/entries/${localId}`) {
          e.endpoint = `/nutrition/entries/${serverId}`;
        }
      }
    }
  }

  getCachedReferenceList(kind: ReferenceListKind): ReferenceList | null {
    return this.referenceLists.get(kind) ?? null;
  }

  cacheReferenceList(kind: ReferenceListKind, entries: ReferenceEntry[]): void {
    this.referenceLists.set(kind, {
      kind,
      entries,
      syncedAt: new Date().toISOString(),
    });
  }

  getReferenceListAge(kind: ReferenceListKind): string | null {
    return this.referenceLists.get(kind)?.syncedAt ?? null;
  }

  getCachedDashboard(userId: string): CachedDashboard | null {
    return this.dashboardCache.get(userId) ?? null;
  }

  cacheDashboard(userId: string, payload: DashboardPayload): void {
    this.dashboardCache.set(userId, {
      userId,
      payload,
      syncedAt: new Date().toISOString(),
    });
  }

  getDashboardAge(userId: string): string | null {
    return this.dashboardCache.get(userId)?.syncedAt ?? null;
  }

  invalidateDashboard(userId: string): void {
    this.dashboardCache.delete(userId);
  }

  // -- Coach You Cache (10-trainer-features) --

  getCachedCoachOverview(userId: string): CoachOverview | null {
    return this.coachOverviewCache.get(userId)?.payload ?? null;
  }

  cacheCoachOverview(userId: string, payload: CoachOverview): void {
    this.coachOverviewCache.set(userId, {
      payload,
      syncedAt: new Date().toISOString(),
    });
  }

  getCoachOverviewAge(userId: string): string | null {
    return this.coachOverviewCache.get(userId)?.syncedAt ?? null;
  }

  // -- Client Detail Cache (M8 Coach Phase 5) --

  private clientDetailKey(userId: string, clientId: string): string {
    return `${userId}:${clientId}`;
  }

  getCachedClientDetail(userId: string, clientId: string): ClientDetail | null {
    return (
      this.clientDetailCache.get(this.clientDetailKey(userId, clientId))
        ?.payload ?? null
    );
  }

  cacheClientDetail(
    userId: string,
    clientId: string,
    payload: ClientDetail,
  ): void {
    this.clientDetailCache.set(this.clientDetailKey(userId, clientId), {
      payload,
      syncedAt: new Date().toISOString(),
    });
  }

  getClientDetailAge(userId: string, clientId: string): string | null {
    return (
      this.clientDetailCache.get(this.clientDetailKey(userId, clientId))
        ?.syncedAt ?? null
    );
  }

  // -- Clients Roster Cache (10-trainer-features) --

  getCachedTrainerClients(userId: string): TrainerClient[] | null {
    return this.trainerClientsCache.get(userId)?.payload ?? null;
  }

  cacheTrainerClients(userId: string, payload: TrainerClient[]): void {
    this.trainerClientsCache.set(userId, {
      payload,
      syncedAt: new Date().toISOString(),
    });
  }

  getTrainerClientsAge(userId: string): string | null {
    return this.trainerClientsCache.get(userId)?.syncedAt ?? null;
  }

  // -- Programmes List Cache (19-programs, Phase 9 mobile — coach F1) --

  getCachedPrograms(userId: string): ProgramSummary[] | null {
    return this.programsCache.get(userId)?.payload ?? null;
  }

  cachePrograms(userId: string, payload: ProgramSummary[]): void {
    this.programsCache.set(userId, {
      payload,
      syncedAt: new Date().toISOString(),
    });
  }

  getProgramsAge(userId: string): string | null {
    return this.programsCache.get(userId)?.syncedAt ?? null;
  }

  // -- Notifications Cache (09) --

  getCachedNotifications(limit = 100): Notification[] {
    return [...this.notificationsCache.values()]
      .sort((a, b) => {
        if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : -1;
        return a.createdAt < b.createdAt ? 1 : -1;
      })
      .slice(0, limit);
  }

  cacheNotifications(notifications: Notification[]): void {
    for (const n of notifications) {
      // Mirror the SQLite COALESCE: keep an already-set (optimistic)
      // read_at rather than letting a server write-through reset it to
      // null before the mark-read flushes (Inspector Brad).
      const prev = this.notificationsCache.get(n.id);
      this.notificationsCache.set(n.id, {
        ...n,
        readAt: prev?.readAt ?? n.readAt,
      });
    }
    const keep = new Set(this.getCachedNotifications(100).map((n) => n.id));
    for (const id of [...this.notificationsCache.keys()]) {
      if (!keep.has(id)) this.notificationsCache.delete(id);
    }
  }

  getCachedUnreadCount(): number {
    return [...this.notificationsCache.values()].filter(
      (n) => n.readAt === null,
    ).length;
  }

  markCachedNotificationRead(id: string, readAt: string): void {
    const n = this.notificationsCache.get(id);
    if (n && n.readAt === null) {
      this.notificationsCache.set(id, { ...n, readAt });
    }
  }

  markAllCachedNotificationsRead(readAt: string): void {
    for (const [id, n] of this.notificationsCache) {
      if (n.readAt === null) {
        this.notificationsCache.set(id, { ...n, readAt });
      }
    }
  }

  getCachedNotificationPreferences(): NotificationPreferences | null {
    return this.notificationPreferencesCache
      ? { ...this.notificationPreferencesCache }
      : null;
  }

  cacheNotificationPreferences(preferences: NotificationPreferences): void {
    this.notificationPreferencesCache = { ...preferences };
  }

  // -- Profile-Page Cache (M6) --

  getCachedProfilePage(userId: string): CachedProfilePage | null {
    return this.profilePageCache.get(userId) ?? null;
  }

  cacheProfilePage(userId: string, payload: ProfilePageData): void {
    this.profilePageCache.set(userId, {
      userId,
      payload,
      syncedAt: new Date().toISOString(),
    });
  }

  getProfilePageAge(userId: string): string | null {
    return this.profilePageCache.get(userId)?.syncedAt ?? null;
  }

  invalidateProfilePage(userId: string): void {
    this.profilePageCache.delete(userId);
  }

  // -- Workouts Cache (M2) --

  getCachedWorkoutsList(
    userId: string,
    type: WorkoutListType,
  ): CachedWorkoutsList | null {
    return (
      this.workoutsListCache.get(this.workoutsListKey(userId, type)) ?? null
    );
  }

  cacheWorkoutsList(
    userId: string,
    type: WorkoutListType,
    workouts: Workout[],
    quota: WorkoutQuota | null,
  ): void {
    this.workoutsListCache.set(this.workoutsListKey(userId, type), {
      userId,
      type,
      workouts,
      quota,
      syncedAt: new Date().toISOString(),
    });
  }

  getWorkoutsListAge(userId: string, type: WorkoutListType): string | null {
    return (
      this.workoutsListCache.get(this.workoutsListKey(userId, type))
        ?.syncedAt ?? null
    );
  }

  getCachedWorkoutDetail(
    userId: string,
    workoutId: string,
  ): CachedWorkoutDetail | null {
    return (
      this.workoutDetailCache.get(this.workoutDetailKey(userId, workoutId)) ??
      null
    );
  }

  cacheWorkoutDetail(userId: string, workout: Workout): void {
    this.workoutDetailCache.set(this.workoutDetailKey(userId, workout.id), {
      userId,
      workoutId: workout.id,
      workout,
      syncedAt: new Date().toISOString(),
    });
  }

  getCachedWorkoutHistory(
    userId: string,
    workoutId: string,
  ): CachedWorkoutHistory | null {
    return (
      this.workoutHistoryCache.get(this.workoutDetailKey(userId, workoutId)) ??
      null
    );
  }

  cacheWorkoutHistory(
    userId: string,
    workoutId: string,
    history: WorkoutHistory,
  ): void {
    this.workoutHistoryCache.set(this.workoutDetailKey(userId, workoutId), {
      userId,
      workoutId,
      history,
      syncedAt: new Date().toISOString(),
    });
  }

  removeCachedWorkout(userId: string, workoutId: string): void {
    this.workoutDetailCache.delete(this.workoutDetailKey(userId, workoutId));
    this.workoutHistoryCache.delete(this.workoutDetailKey(userId, workoutId));
    for (const [key, slice] of this.workoutsListCache.entries()) {
      if (slice.userId !== userId) continue;
      const filtered = slice.workouts.filter((w) => w.id !== workoutId);
      if (filtered.length !== slice.workouts.length) {
        this.workoutsListCache.set(key, { ...slice, workouts: filtered });
      }
    }
  }

  // -- Active Session (M3) --

  getActiveSession(userId: string): WorkoutSession | null {
    const session = this.activeSessions.get(userId);
    if (!session || session.status !== "in_progress") return null;
    return cloneSession(session);
  }

  getLatestSession(userId: string): WorkoutSession | null {
    const session = this.activeSessions.get(userId);
    return session ? cloneSession(session) : null;
  }

  cacheActiveSession(userId: string, session: WorkoutSession): void {
    this.activeSessions.set(userId, cloneSession(session));
    // Inspector Brad PR #62 (high severity, belt-and-braces): drop a
    // stale record-response cache slot if it belongs to a DIFFERENT
    // session id (prior session's payload would otherwise leak into
    // the new Summary screen via FIFO sync drains). Mid-session
    // updates (same session.id) don't touch the slot. Container-side
    // `localSessionId` guard is the primary fix; this is parity with
    // the SQLite adapter's same defensive clear.
    const cached = this.recordResponses.get(userId);
    if (cached && cached.localSessionId !== session.id) {
      this.recordResponses.delete(userId);
    }
  }

  clearActiveSession(userId: string): void {
    this.activeSessions.delete(userId);
    // Parity with SQLite: the rest-timer state lives inline on the
    // active_sessions row (rest_timer_started_at + rest_timer_total_seconds
    // columns), so deleting the parent kills the timer atomically.
    // The in-memory adapter uses a separate map; drop the entry here
    // so a follow-up `cacheActiveSession` for the same user doesn't
    // surface a stale timer from the prior session.
    this.restTimers.delete(userId);
    // Same lifecycle for the cached server-response (M3 Phase 3b) —
    // clearing the active session also retires whatever bulk-record
    // response was cached for that session, so a fresh session starts
    // with no stale PRs / workoutsThisMonth on the Summary screen.
    this.recordResponses.delete(userId);
  }

  cacheRecordResponse(userId: string, response: RecordResponseSummary): void {
    // Deep-clone so tests can mutate the returned object without
    // poisoning the cache. Matches the cloneSession pattern used for
    // active_sessions above.
    this.recordResponses.set(userId, JSON.parse(JSON.stringify(response)));
  }

  getRecordResponse(userId: string): RecordResponseSummary | null {
    const cached = this.recordResponses.get(userId);
    if (!cached) return null;
    return JSON.parse(JSON.stringify(cached)) as RecordResponseSummary;
  }

  clearRecordResponse(userId: string): void {
    this.recordResponses.delete(userId);
  }

  getSessionSets(
    userId: string,
    sessionId: string,
    exerciseId: string,
  ): ExerciseSet[] {
    const session = this.activeSessions.get(userId);
    if (!session || session.id !== sessionId) return [];
    const matching = session.exercises.filter(
      (ex) => ex.exerciseId === exerciseId,
    );
    const sets: ExerciseSet[] = [];
    for (const ex of matching) {
      for (const set of ex.sets) sets.push({ ...set });
    }
    return sets;
  }

  cachePersonalRecords(userId: string, records: PersonalRecord[]): void {
    if (records.length === 0) return;
    const existing = this.personalRecords.get(userId) ?? [];
    const byKey = new Map(
      existing.map((r) => [`${r.exerciseId}::${r.recordType}`, r] as const),
    );
    for (const rec of records) {
      byKey.set(`${rec.exerciseId}::${rec.recordType}`, { ...rec });
    }
    this.personalRecords.set(userId, Array.from(byKey.values()));
  }

  getPersonalRecords(userId: string, exerciseId?: string): PersonalRecord[] {
    const all = this.personalRecords.get(userId) ?? [];
    const list = exerciseId
      ? all.filter((r) => r.exerciseId === exerciseId)
      : all;
    return list
      .slice()
      .sort((a, b) => (a.achievedAt < b.achievedAt ? 1 : -1))
      .map((r) => ({ ...r }));
  }

  getRecentSetsByExercise(
    userId: string,
    exerciseIds: readonly string[],
  ): Record<string, Record<number, { weightKg: number; reps: number }>> {
    if (exerciseIds.length === 0) return {};
    const all = this.recentSets.get(userId) ?? [];
    const wanted = new Set(exerciseIds);
    const map: Record<
      string,
      Record<number, { weightKg: number; reps: number }>
    > = {};
    for (const entry of all) {
      if (!wanted.has(entry.exerciseId)) continue;
      const exMap = map[entry.exerciseId] ?? (map[entry.exerciseId] = {});
      exMap[entry.setNumber] = {
        weightKg: entry.weightKg,
        reps: entry.reps,
      };
    }
    return map;
  }

  upsertRecentSets(userId: string, sets: readonly RecentSetEntry[]): void {
    if (sets.length === 0) return;
    const existing = this.recentSets.get(userId) ?? [];
    const byKey = new Map(
      existing.map(
        (entry) => [`${entry.exerciseId}::${entry.setNumber}`, entry] as const,
      ),
    );
    for (const s of sets) {
      byKey.set(`${s.exerciseId}::${s.setNumber}`, { ...s });
    }
    this.recentSets.set(userId, Array.from(byKey.values()));
  }

  getRestTimerState(userId: string): RestTimerState | null {
    const session = this.activeSessions.get(userId);
    if (!session || session.status !== "in_progress") return null;
    return this.restTimers.get(userId) ?? null;
  }

  setRestTimerState(userId: string, state: RestTimerState): void {
    const session = this.activeSessions.get(userId);
    if (!session || session.status !== "in_progress") return;
    this.restTimers.set(userId, { ...state });
  }

  clearRestTimerState(userId: string): void {
    this.restTimers.delete(userId);
  }

  swapLocalSessionId(localId: string, serverId: string): void {
    if (localId === serverId) return;
    for (const [userId, session] of this.activeSessions) {
      if (session.id !== localId) continue;
      // Mirror the SQLite adapter (sqlite.adapter.ts § swapLocalSessionId):
      // session_exercises.session_id is rewritten alongside the parent
      // session.id. The in-memory representation nests exercises inside
      // the session row, so rewrite each exercise.sessionId in the same
      // pass — otherwise nested children carry the stale local id and
      // tests using this adapter miss bugs where production code relies
      // on `exercise.sessionId === session.id` post-flush.
      this.activeSessions.set(userId, {
        ...session,
        id: serverId,
        exercises: session.exercises.map((ex) =>
          ex.sessionId === localId ? { ...ex, sessionId: serverId } : ex,
        ),
      });
    }
    for (const [userId, records] of this.personalRecords) {
      let changed = false;
      const next = records.map((r) => {
        if (r.sessionId === localId) {
          changed = true;
          return { ...r, sessionId: serverId };
        }
        return r;
      });
      if (changed) this.personalRecords.set(userId, next);
    }
  }

  // -- Nutrition / Fuel cache (M9) --
  private fuelTodayCache: Map<
    string,
    { payload: FuelToday; syncedAt: string }
  > = new Map();
  private foodsCache: Map<string, Food> = new Map();
  private nutritionTargetCache: Map<
    string,
    { payload: NutritionTarget; syncedAt: string }
  > = new Map();
  private recipesCache: Map<string, Map<string, Recipe>> = new Map();
  private mealsCache: Map<string, Map<string, Meal>> = new Map();
  private fuelKey(userId: string, date: string): string {
    return `${userId}::${date}`;
  }

  getCachedFuelToday(userId: string, date: string): FuelToday | null {
    return this.fuelTodayCache.get(this.fuelKey(userId, date))?.payload ?? null;
  }
  getFuelTodayAge(userId: string, date: string): string | null {
    return (
      this.fuelTodayCache.get(this.fuelKey(userId, date))?.syncedAt ?? null
    );
  }
  cacheFuelToday(userId: string, date: string, payload: FuelToday): void {
    this.fuelTodayCache.set(this.fuelKey(userId, date), {
      payload,
      syncedAt: new Date().toISOString(),
    });
  }

  getCachedFoodByBarcode(barcode: string): Food | null {
    for (const food of this.foodsCache.values()) {
      if (food.barcode === barcode) return food;
    }
    return null;
  }
  getCachedFoodById(id: string): Food | null {
    return this.foodsCache.get(id) ?? null;
  }
  cacheFoods(foods: Food[]): void {
    for (const food of foods) this.foodsCache.set(food.id, food);
  }

  getCachedNutritionTarget(userId: string): NutritionTarget | null {
    return this.nutritionTargetCache.get(userId)?.payload ?? null;
  }
  getNutritionTargetAge(userId: string): string | null {
    return this.nutritionTargetCache.get(userId)?.syncedAt ?? null;
  }
  cacheNutritionTarget(userId: string, target: NutritionTarget): void {
    this.nutritionTargetCache.set(userId, {
      payload: target,
      syncedAt: new Date().toISOString(),
    });
  }

  getCachedRecipes(userId: string): Recipe[] {
    return Array.from(this.recipesCache.get(userId)?.values() ?? []);
  }
  getCachedRecipe(userId: string, id: string): Recipe | null {
    return this.recipesCache.get(userId)?.get(id) ?? null;
  }
  cacheRecipes(userId: string, recipes: Recipe[]): void {
    const map = new Map<string, Recipe>();
    for (const r of recipes) map.set(r.id, r);
    this.recipesCache.set(userId, map);
  }
  cacheRecipe(userId: string, recipe: Recipe): void {
    const map = this.recipesCache.get(userId) ?? new Map<string, Recipe>();
    map.set(recipe.id, recipe);
    this.recipesCache.set(userId, map);
  }
  removeCachedRecipe(userId: string, id: string): void {
    this.recipesCache.get(userId)?.delete(id);
  }

  getCachedMeals(userId: string): Meal[] {
    return Array.from(this.mealsCache.get(userId)?.values() ?? []);
  }
  cacheMeals(userId: string, meals: Meal[]): void {
    const map = new Map<string, Meal>();
    for (const m of meals) map.set(m.id, m);
    this.mealsCache.set(userId, map);
  }
  cacheMeal(userId: string, meal: Meal): void {
    const map = this.mealsCache.get(userId) ?? new Map<string, Meal>();
    map.set(meal.id, meal);
    this.mealsCache.set(userId, map);
  }
  removeCachedMeal(userId: string, id: string): void {
    this.mealsCache.get(userId)?.delete(id);
  }

  clearAll(): void {
    this.queue = [];
    this.metadata.clear();
    this.exerciseCache.clear();
    this.referenceLists.clear();
    this.dashboardCache.clear();
    this.coachOverviewCache.clear();
    this.clientDetailCache.clear();
    this.trainerClientsCache.clear();
    this.programsCache.clear();
    this.profilePageCache.clear();
    this.workoutsListCache.clear();
    this.workoutDetailCache.clear();
    this.workoutHistoryCache.clear();
    this.coachWorkoutLibraryCache.clear();
    this.activeSessions.clear();
    this.personalRecords.clear();
    this.recentSets.clear();
    this.restTimers.clear();
    this.notificationsCache.clear();
    this.notificationPreferencesCache = null;
    this.fuelTodayCache.clear();
    this.foodsCache.clear();
    this.nutritionTargetCache.clear();
    this.recipesCache.clear();
    this.mealsCache.clear();
    this.nextId = 1;
  }

  private updateStatus(id: number, status: SyncStatus): void {
    const entry = this.queue.find((e) => e.id === id);
    if (entry) entry.status = status;
  }

  // -- Home / Progress cache (M4 — 06-progress-goals) --
  private homeCache: Map<string, { payload: HomePayload; syncedAt: string }> =
    new Map();
  private streaksCache: Map<string, Streak[]> = new Map();
  private achievementsCache: Map<string, Achievement[]> = new Map();
  private habitCompletionsCache: Map<string, HabitCompletion[]> = new Map();

  getCachedHome(userId: string): HomePayload | null {
    return this.homeCache.get(userId)?.payload ?? null;
  }
  getHomeAge(userId: string): string | null {
    return this.homeCache.get(userId)?.syncedAt ?? null;
  }
  cacheHome(userId: string, payload: HomePayload): void {
    this.homeCache.set(userId, { payload, syncedAt: new Date().toISOString() });
  }
  invalidateHome(userId: string): void {
    this.homeCache.delete(userId);
  }

  // -- Goals cache (M16 — Athlete Training page) --
  private goalsCache: Map<string, { goals: Goal[]; syncedAt: string }> =
    new Map();
  getCachedGoals(userId: string): Goal[] | null {
    return this.goalsCache.get(userId)?.goals ?? null;
  }
  getGoalsAge(userId: string): string | null {
    return this.goalsCache.get(userId)?.syncedAt ?? null;
  }
  cacheGoals(userId: string, goals: Goal[]): void {
    this.goalsCache.set(userId, { goals, syncedAt: new Date().toISOString() });
  }
  invalidateGoals(userId: string): void {
    this.goalsCache.delete(userId);
  }

  // -- Coach Workout library cache (Workout Authoring v2, S3) --
  private coachWorkoutLibraryCache: Map<
    string,
    { workouts: Workout[]; syncedAt: string }
  > = new Map();
  getCachedCoachWorkoutLibrary(userId: string): Workout[] | null {
    return this.coachWorkoutLibraryCache.get(userId)?.workouts ?? null;
  }
  cacheCoachWorkoutLibrary(userId: string, workouts: Workout[]): void {
    this.coachWorkoutLibraryCache.set(userId, {
      workouts,
      syncedAt: new Date().toISOString(),
    });
  }

  getCachedStreaks(userId: string): Streak[] {
    return this.streaksCache.get(userId) ?? [];
  }
  cacheStreaks(userId: string, streaks: Streak[]): void {
    this.streaksCache.set(userId, streaks);
  }

  getCachedAchievements(userId: string): Achievement[] {
    return this.achievementsCache.get(userId) ?? [];
  }
  cacheAchievements(userId: string, achievements: Achievement[]): void {
    this.achievementsCache.set(userId, achievements);
  }

  private bodyTrendCache: Map<string, BodyTrendPoint[]> = new Map();
  getCachedBodyTrend(userId: string): BodyTrendPoint[] {
    return this.bodyTrendCache.get(userId) ?? [];
  }
  cacheBodyTrend(userId: string, series: BodyTrendPoint[]): void {
    this.bodyTrendCache.set(userId, [...series]);
  }

  private volumeStatsCache: Map<string, VolumeStats> = new Map();
  getCachedVolumeStats(userId: string): VolumeStats | null {
    return this.volumeStatsCache.get(userId) ?? null;
  }
  cacheVolumeStats(userId: string, stats: VolumeStats): void {
    this.volumeStatsCache.set(userId, stats);
  }

  getCachedHabitCompletions(
    userId: string,
    opts?: { goalId?: string; since?: string },
  ): HabitCompletion[] {
    let rows = this.habitCompletionsCache.get(userId) ?? [];
    if (opts?.goalId) rows = rows.filter((r) => r.goalId === opts.goalId);
    if (opts?.since) {
      rows = rows.filter((r) => dayOf(r) >= opts.since!);
    }
    return rows;
  }
  cacheHabitCompletions(userId: string, rows: HabitCompletion[]): void {
    this.habitCompletionsCache.set(userId, [...rows]);
  }
  upsertHabitCompletion(row: {
    id: string;
    userId: string;
    goalId: string;
    day: string;
    completedAt: string;
    value: number | null;
  }): void {
    const rows = this.habitCompletionsCache.get(row.userId) ?? [];
    const filtered = rows.filter(
      (r) => !(r.goalId === row.goalId && dayOf(r) === row.day),
    );
    filtered.push({
      id: row.id,
      userId: row.userId,
      goalId: row.goalId,
      completedAt: row.completedAt,
      localCompletedDate: row.day,
      value: row.value,
    });
    this.habitCompletionsCache.set(row.userId, filtered);
  }
  removeHabitCompletion(userId: string, goalId: string, day: string): void {
    const rows = this.habitCompletionsCache.get(userId) ?? [];
    this.habitCompletionsCache.set(
      userId,
      rows.filter((r) => !(r.goalId === goalId && dayOf(r) === day)),
    );
  }

  private habitConfigsCache: Map<string, HabitConfig[]> = new Map();
  getHabitConfigs(userId: string): HabitConfig[] {
    return this.habitConfigsCache.get(userId) ?? [];
  }
  cacheHabitConfigs(userId: string, configs: HabitConfig[]): void {
    this.habitConfigsCache.set(userId, [...configs]);
  }
  upsertHabitConfig(userId: string, config: HabitConfig): void {
    const rows = this.habitConfigsCache.get(userId) ?? [];
    const filtered = rows.filter((c) => c.category !== config.category);
    filtered.push(config);
    this.habitConfigsCache.set(userId, filtered);
  }
  removeHabitConfig(userId: string, category: string): void {
    const rows = this.habitConfigsCache.get(userId) ?? [];
    this.habitConfigsCache.set(
      userId,
      rows.filter((c) => c.category !== category),
    );
  }

  swapLocalHabitGoalId(localGoalId: string, serverGoalId: string): void {
    if (localGoalId === serverGoalId) return;

    // Re-key any cached completion rows written under the local goalId
    // (mirrors the SQLite adapter — scans every user's cache since the swap
    // is goalId-scoped, not user-scoped).
    for (const [userId, rows] of this.habitCompletionsCache) {
      const swapped = rows.map((r) =>
        r.goalId === localGoalId ? { ...r, goalId: serverGoalId } : r,
      );
      this.habitCompletionsCache.set(userId, swapped);
    }

    // Re-point any queued /habit-completions mutation still addressed to the
    // local goalId — the payload JSON AND (for DELETE) the query-string
    // endpoint. Only pending/failed rows, mirroring updateMutationPayload.
    for (const e of this.queue) {
      if (
        e.entityType !== "habit_completion" ||
        (e.status !== "pending" && e.status !== "failed")
      ) {
        continue;
      }
      let payload: { goalId?: string } | null = null;
      try {
        payload = JSON.parse(e.payload) as { goalId?: string };
      } catch {
        continue;
      }
      if (payload?.goalId !== localGoalId) continue;

      e.payload = JSON.stringify({ ...payload, goalId: serverGoalId });
      e.endpoint = e.endpoint.replace(
        `goalId=${encodeURIComponent(localGoalId)}`,
        `goalId=${encodeURIComponent(serverGoalId)}`,
      );
      if (e.entityId?.startsWith(`${localGoalId}:`)) {
        e.entityId = `${serverGoalId}${e.entityId.slice(localGoalId.length)}`;
      }
    }
  }
}

/**
 * Authoritative user-local day for a cached completion — mirrors the SQLite
 * adapter's `day` column. Prefer localCompletedDate; fall back to a UTC slice
 * only for rows that predate it.
 */
function dayOf(r: HabitCompletion): string {
  return r.localCompletedDate ?? r.completedAt.slice(0, 10);
}

function cloneSession(session: WorkoutSession): WorkoutSession {
  return {
    ...session,
    exercises: session.exercises.map((ex) => ({
      ...ex,
      sets: ex.sets.map((set) => ({ ...set })),
    })),
  };
}
