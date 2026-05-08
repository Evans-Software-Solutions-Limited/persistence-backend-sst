import type {
  CachedDashboard,
  DashboardPayload,
} from "@/domain/models/dashboard";
import type { Exercise, ExerciseFilters } from "@/domain/models/exercise";
import type { PersonalRecord } from "@/domain/models/record";
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
import { filterExercises } from "@/domain/services/exercise.service";
import type {
  StoragePort,
  SyncQueueEntry,
  SyncStats,
  EnqueueMutationInput,
  RecentSetEntry,
  RestTimerState,
} from "@/domain/ports/storage.port";
import type { SyncStatus } from "@/domain/ports/sync.types";

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
  private workoutsListCache: Map<string, CachedWorkoutsList> = new Map();
  private workoutDetailCache: Map<string, CachedWorkoutDetail> = new Map();
  private activeSessions: Map<string, WorkoutSession> = new Map();
  private personalRecords: Map<string, PersonalRecord[]> = new Map();
  private recentSets: Map<string, RecentSetEntry[]> = new Map();
  private restTimers: Map<string, RestTimerState> = new Map();
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
    });
  }

  getPendingMutations(): SyncQueueEntry[] {
    return this.queue.filter(
      (e) =>
        (e.status === "pending" || e.status === "failed") &&
        e.retryCount < e.maxRetries,
    );
  }

  markMutationInFlight(id: number): void {
    this.updateStatus(id, "in_flight");
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

  getSyncStats(): SyncStats {
    const stats = { pending: 0, failed: 0, inFlight: 0 };
    for (const entry of this.queue) {
      if (entry.status === "pending") stats.pending++;
      else if (entry.status === "failed") stats.failed++;
      else if (entry.status === "in_flight") stats.inFlight++;
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
    const all = Array.from(this.exerciseCache.values()).map((v) => v.exercise);
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
    return this.exerciseCache.get(id)?.exercise ?? null;
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

  removeCachedWorkout(userId: string, workoutId: string): void {
    this.workoutDetailCache.delete(this.workoutDetailKey(userId, workoutId));
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
  }

  clearActiveSession(userId: string): void {
    this.activeSessions.delete(userId);
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

  clearAll(): void {
    this.queue = [];
    this.metadata.clear();
    this.exerciseCache.clear();
    this.referenceLists.clear();
    this.dashboardCache.clear();
    this.workoutsListCache.clear();
    this.workoutDetailCache.clear();
    this.activeSessions.clear();
    this.personalRecords.clear();
    this.recentSets.clear();
    this.restTimers.clear();
    this.nextId = 1;
  }

  private updateStatus(id: number, status: SyncStatus): void {
    const entry = this.queue.find((e) => e.id === id);
    if (entry) entry.status = status;
  }
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
