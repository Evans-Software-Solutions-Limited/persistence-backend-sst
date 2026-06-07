import type { DashboardPayload } from "@/domain/models/dashboard";
import type {
  CreateExerciseInput,
  Exercise,
  ExerciseFilters,
} from "@/domain/models/exercise";
import type { ProfilePageData } from "@/domain/models/profilePage";
import type {
  ReferenceEntry,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import { filterExercises } from "@/domain/services/exercise.service";
import type {
  ApiPort,
  ApiProfile,
  ApiSession,
  ApiSessionExercise,
  ApiExerciseSet,
  ApiPersonalRecord,
  ApiGoal,
  GetWorkoutsParams,
  GetWorkoutsResult,
  GetPersonalRecordsParams,
  CreateSessionInput,
  CreateSessionExerciseInput,
  RecordSessionInput,
  RecordedApiSession,
  UpdateSessionInput,
  UpdateSetInput,
  CreateSetInput,
  CreateGoalInput,
  UploadAvatarInput,
  CreateSubscriptionInput,
  CancelSubscriptionInput,
  ApiMeasurement,
  LogMeasurementInput,
  CreateHabitCompletionInput,
  DeleteHabitCompletionInput,
} from "@/domain/ports/api.port";
import type { PersonalRecord } from "@/domain/models/record";
import type { Achievement } from "@/domain/models/achievement";
import type { HabitCompletion } from "@/domain/models/habit-completion";
import type { Streak } from "@/domain/models/streak";
import type {
  HomePayload,
  Rings,
  WeeklyVolume,
  VolumeStats,
  BodyTrendPoint,
} from "@/domain/models/progress";
import type {
  CancelSubscriptionResult,
  CreateSubscriptionResult,
  MySubscription,
  SubscriptionTier,
} from "@/domain/models/subscription";
import type {
  CreateWorkoutInput,
  UpdateWorkoutInput,
  Workout,
  WorkoutQuota,
} from "@/domain/models/workout";
import { ok, fail, type Result, type ApiError } from "@/shared/errors";
import type { PaginatedResult, PaginationParams } from "@/shared/types";

/**
 * In-memory API adapter for testing.
 * Stores data in arrays, returns it directly.
 */
export class InMemoryApiAdapter implements ApiPort {
  public profiles: ApiProfile[] = [];
  public workouts: Workout[] = [];
  public workoutQuota: WorkoutQuota | null = null;
  public sessions: ApiSession[] = [];
  public exercises: Exercise[] = [];
  public sets: ApiExerciseSet[] = [];
  public personalRecords: ApiPersonalRecord[] = [];
  public goals: ApiGoal[] = [];
  public referenceLists: Partial<Record<ReferenceListKind, ReferenceEntry[]>> =
    {};
  public dashboard: DashboardPayload | null = null;
  public profilePage: ProfilePageData | null = null;
  public shouldFail = false;
  public failError: ApiError = {
    kind: "api",
    code: "server",
    message: "Test error",
  };

  private mayFail<T>(value: T): Result<T, ApiError> {
    if (this.shouldFail) return fail(this.failError);
    return ok(value);
  }

  async healthCheck() {
    return this.mayFail({ status: "ok" });
  }

  async getProfile() {
    const profile = this.profiles[0];
    if (!profile)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "No profile",
      });
    return this.mayFail(profile);
  }

  async updateProfile(data: Partial<ApiProfile>) {
    const result = this.mayFail(undefined);
    if (!result.ok) return fail<ApiError>(result.error);
    if (this.profiles[0]) {
      this.profiles[0] = { ...this.profiles[0], ...data };
    }
    return this.getProfile();
  }

  async getWorkouts(
    params?: GetWorkoutsParams,
  ): Promise<Result<GetWorkoutsResult, ApiError>> {
    const type = params?.type ?? "mine";
    const filtered = this.workouts.filter((w) => {
      if (type === "mine") return w.createdBy === "test-user";
      if (type === "default")
        return w.visibility === "public" && w.createdBy !== "test-user";
      return true; // assigned: in-memory fake doesn't track assignments
    });
    return this.mayFail<GetWorkoutsResult>({
      workouts: filtered,
      total: filtered.length,
      quota: type === "mine" ? this.workoutQuota : null,
    });
  }

  async getWorkout(id: string): Promise<Result<Workout, ApiError>> {
    const w = this.workouts.find((w) => w.id === id);
    if (!w)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Workout not found",
      });
    return this.mayFail(w);
  }

  async createWorkout(
    data: CreateWorkoutInput,
  ): Promise<Result<Workout, ApiError>> {
    const id = `workout-${this.workouts.length + 1}`;
    const now = new Date().toISOString();
    const workout: Workout = {
      id,
      name: data.name,
      description: data.description ?? null,
      createdBy: "test-user",
      visibility: data.visibility ?? "private",
      estimatedDurationMinutes: data.estimatedDurationMinutes ?? 30,
      exercises: data.exercises.map((ex, idx) => ({
        id: `we-${id}-${idx}`,
        exerciseId: ex.exerciseId,
        sortOrder: ex.sortOrder,
        supersetGroup: ex.supersetGroup ?? null,
        targetSets: ex.targetSets ?? null,
        targetRepsMin: ex.targetRepsMin ?? 1,
        targetRepsMax: ex.targetRepsMax ?? 1,
        targetDurationSeconds: ex.targetDurationSeconds ?? null,
        restSeconds: ex.restSeconds ?? 90,
        notes: ex.notes ?? null,
        exercise: null,
      })),
      createdAt: now,
      updatedAt: now,
    };
    this.workouts.push(workout);
    return this.mayFail(workout);
  }

  async updateWorkout(
    id: string,
    data: UpdateWorkoutInput,
  ): Promise<Result<Workout, ApiError>> {
    const idx = this.workouts.findIndex((w) => w.id === id);
    if (idx === -1)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Not found",
      });
    const result = this.mayFail(undefined);
    if (!result.ok) return fail<ApiError>(result.error);
    const existing = this.workouts[idx];
    const updated: Workout = {
      ...existing,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.visibility !== undefined && { visibility: data.visibility }),
      ...(data.estimatedDurationMinutes !== undefined && {
        estimatedDurationMinutes: data.estimatedDurationMinutes,
      }),
      ...(data.exercises !== undefined && {
        exercises: data.exercises.map((ex, exIdx) => ({
          id: `we-${id}-${exIdx}`,
          exerciseId: ex.exerciseId,
          sortOrder: ex.sortOrder,
          supersetGroup: ex.supersetGroup ?? null,
          targetSets: ex.targetSets ?? null,
          targetRepsMin: ex.targetRepsMin ?? 1,
          targetRepsMax: ex.targetRepsMax ?? 1,
          targetDurationSeconds: ex.targetDurationSeconds ?? null,
          restSeconds: ex.restSeconds ?? 90,
          notes: ex.notes ?? null,
          exercise: null,
        })),
      }),
      updatedAt: new Date().toISOString(),
    };
    this.workouts[idx] = updated;
    return ok(updated);
  }

  async deleteWorkout(id: string): Promise<Result<void, ApiError>> {
    this.workouts = this.workouts.filter((w) => w.id !== id);
    return this.mayFail(undefined);
  }

  async getSessions(_params?: PaginationParams) {
    return this.mayFail(this.sessions);
  }

  async getSession(id: string) {
    const s = this.sessions.find((s) => s.id === id);
    if (!s)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Not found",
      });
    return this.mayFail(s);
  }

  async createSession(data: CreateSessionInput) {
    const session: ApiSession = {
      id: `session-${this.sessions.length + 1}`,
      userId: "test-user",
      workoutId: data.workoutId ?? null,
      name: data.name ?? null,
      status: data.status ?? "in_progress",
      startedAt: new Date().toISOString(),
      completedAt: null,
      totalDurationSeconds: null,
      userNotes: data.userNotes ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.push(session);
    return this.mayFail(session);
  }

  async updateSession(id: string, data: UpdateSessionInput) {
    const idx = this.sessions.findIndex((s) => s.id === id);
    if (idx === -1)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Not found",
      });
    const result = this.mayFail(undefined);
    if (!result.ok) return fail<ApiError>(result.error);
    this.sessions[idx] = {
      ...this.sessions[idx],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    return ok(this.sessions[idx]);
  }

  async deleteSession(id: string) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    return this.mayFail(undefined);
  }

  async getActiveSession() {
    const active = this.sessions.find((s) => s.status === "in_progress");
    return this.mayFail(active ?? null);
  }

  async recordSession(payload: RecordSessionInput) {
    const sessionId = `local-recorded-session-${this.sessions.length + 1}`;
    const session: RecordedApiSession = {
      id: sessionId,
      userId: "test-user",
      workoutId: payload.workoutId ?? null,
      name: payload.name ?? null,
      status: payload.status,
      startedAt: payload.startedAt,
      completedAt: payload.completedAt ?? null,
      totalDurationSeconds: payload.totalDurationSeconds ?? null,
      userNotes: payload.userNotes ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      exercises: payload.exercises.map((ex, exIdx) => ({
        id: `local-recorded-ex-${sessionId}-${exIdx}`,
        sessionId,
        exerciseId: ex.exerciseId,
        sortOrder: ex.sortOrder,
        supersetGroup: ex.supersetGroup ?? null,
        isSubstituted: ex.isSubstituted ?? false,
        originalExerciseId: ex.originalExerciseId ?? null,
        notes: ex.notes ?? null,
        createdAt: new Date().toISOString(),
        sets: ex.sets.map((set, setIdx) => ({
          id: `local-recorded-set-${sessionId}-${exIdx}-${setIdx}`,
          sessionExerciseId: `local-recorded-ex-${sessionId}-${exIdx}`,
          setNumber: set.setNumber,
          reps: set.reps ?? null,
          weightKg:
            set.weightKg !== undefined && set.weightKg !== null
              ? Number(set.weightKg)
              : null,
          durationSeconds: set.durationSeconds ?? null,
          distanceMeters:
            set.distanceMeters !== undefined && set.distanceMeters !== null
              ? Number(set.distanceMeters)
              : null,
          rpe: set.rpe ?? null,
          isPersonalRecord: false,
          isCompleted: set.isCompleted ?? false,
          completedAt: set.completedAt ?? null,
        })),
      })),
    };
    // Also store the flat session record so getSession / getSessions
    // can find it by id afterwards.
    this.sessions.push({
      id: session.id,
      userId: session.userId,
      workoutId: session.workoutId,
      name: session.name,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      totalDurationSeconds: session.totalDurationSeconds,
      userNotes: session.userNotes,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
    return this.mayFail(session);
  }

  async createSessionExercise(
    sessionId: string,
    data: CreateSessionExerciseInput,
  ) {
    const created: ApiSessionExercise = {
      id: `local-session-exercise-${Date.now()}`,
      sessionId,
      exerciseId: data.exerciseId,
      sortOrder: data.sortOrder ?? 1,
      supersetGroup: data.supersetGroup ?? null,
      isSubstituted: data.isSubstituted ?? false,
      originalExerciseId: data.originalExerciseId ?? null,
      notes: data.notes ?? null,
      createdAt: new Date().toISOString(),
    };
    return this.mayFail(created);
  }

  /**
   * Filter the seeded `personalRecords` array by the same params the
   * SST adapter forwards to `GET /personal-records` (`exerciseId`,
   * `recordType`, plus `limit` / `offset` for the trim window).
   *
   * Tests can seed via `api.personalRecords.push(...)` to drive the
   * quick-fill / Summary-screen flows that the SST adapter would
   * otherwise hit over HTTP. Default-empty when nothing's seeded
   * keeps the existing zero-config tests passing.
   */
  async getPersonalRecords(params?: GetPersonalRecordsParams) {
    let records = this.personalRecords;
    if (params?.exerciseId) {
      records = records.filter((r) => r.exerciseId === params.exerciseId);
    }
    if (params?.recordType) {
      records = records.filter((r) => r.recordType === params.recordType);
    }
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? records.length;
    return this.mayFail(records.slice(offset, offset + limit));
  }

  /**
   * No-op in tests — the in-memory adapter doesn't resolve UUIDs because
   * its `exercises` array holds domain-shape rows with labels already
   * provided by test fixtures. Kept to satisfy the ApiPort interface.
   */
  hydrateReferenceLabels(
    _kind: ReferenceListKind,
    _entries: readonly ReferenceEntry[],
  ): void {
    // intentionally empty — see docstring
  }

  /**
   * Identity in tests. The SST adapter's enrichment reads from its own
   * in-memory reverse-lookup; the in-memory adapter stores Exercise rows
   * that already carry the shape test code asserts on.
   */
  enrichExerciseLabels(exercise: Exercise): Exercise {
    return exercise;
  }

  async getExercises(
    filters?: ExerciseFilters,
    _offset?: number,
    _limit?: number,
  ): Promise<Result<PaginatedResult<Exercise>, ApiError>> {
    const filtered = filters
      ? filterExercises(this.exercises, filters)
      : this.exercises;
    const page: PaginatedResult<Exercise> = {
      data: filtered,
      cursor: null,
      hasMore: false,
    };
    return this.mayFail(page);
  }

  async searchExercises(
    q: string,
    filters?: ExerciseFilters,
    _offset?: number,
    _limit?: number,
  ): Promise<Result<PaginatedResult<Exercise>, ApiError>> {
    // Use the same domain-service filter to keep test fixtures simple —
    // the in-memory adapter doesn't model FTS ranking, so it falls back
    // to filterExercises with the search term + all other axes. Real
    // ranking is exercised by the SSTApiAdapter against the live backend.
    const filtered = filterExercises(this.exercises, {
      ...(filters ?? {}),
      search: q,
    });
    const page: PaginatedResult<Exercise> = {
      data: filtered,
      cursor: null,
      hasMore: false,
    };
    return this.mayFail(page);
  }

  async getReferenceList(
    kind: ReferenceListKind,
  ): Promise<Result<ReferenceEntry[], ApiError>> {
    return this.mayFail(this.referenceLists[kind] ?? []);
  }

  async getDashboard(): Promise<Result<DashboardPayload, ApiError>> {
    if (this.dashboard === null) {
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "No dashboard fixture configured",
      });
    }
    return this.mayFail(this.dashboard);
  }

  async getProfilePage(): Promise<Result<ProfilePageData, ApiError>> {
    if (this.profilePage === null) {
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "No profile-page fixture configured",
      });
    }
    return this.mayFail(this.profilePage);
  }

  public uploadAvatarCalls: UploadAvatarInput[] = [];
  public nextAvatarUrl = "https://test-avatars/test-user/avatar.jpg";

  async uploadAvatar(
    input: UploadAvatarInput,
  ): Promise<Result<{ avatarUrl: string }, ApiError>> {
    this.uploadAvatarCalls.push(input);
    const result = this.mayFail({ avatarUrl: this.nextAvatarUrl });
    if (!result.ok) return result;
    if (this.profiles[0]) {
      this.profiles[0] = { ...this.profiles[0], avatarUrl: this.nextAvatarUrl };
    }
    if (this.profilePage) {
      this.profilePage = {
        ...this.profilePage,
        profile: {
          ...this.profilePage.profile,
          avatarUrl: this.nextAvatarUrl,
        },
      };
    }
    return result;
  }

  public deleteAvatarCalls = 0;

  async deleteAvatar(): Promise<Result<{ avatarUrl: null }, ApiError>> {
    this.deleteAvatarCalls += 1;
    const result = this.mayFail({ avatarUrl: null as null });
    if (!result.ok) return result;
    if (this.profiles[0]) {
      this.profiles[0] = { ...this.profiles[0], avatarUrl: null };
    }
    if (this.profilePage) {
      this.profilePage = {
        ...this.profilePage,
        profile: { ...this.profilePage.profile, avatarUrl: null },
      };
    }
    return result;
  }

  async getExercise(id: string) {
    const e = this.exercises.find((e) => e.id === id);
    if (!e)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Not found",
      });
    return this.mayFail(e);
  }

  async createExercise(data: CreateExerciseInput) {
    const exercise: Exercise = {
      id: `exercise-${this.exercises.length + 1}`,
      name: data.name,
      description: data.description ?? null,
      instructions: data.instructions ?? null,
      category: data.category,
      difficulty: data.difficulty,
      primaryMuscleGroups: data.primaryMuscleGroups,
      secondaryMuscleGroups: data.secondaryMuscleGroups ?? [],
      equipment: data.equipment,
      videoUrl: null,
      thumbnailUrl: null,
      isCustom: true,
      createdBy: "test-user",
    };
    const result = this.mayFail(exercise);
    if (!result.ok) return fail<ApiError>(result.error);
    this.exercises.push(exercise);
    return ok(exercise);
  }

  async updateExercise(id: string, data: Partial<CreateExerciseInput>) {
    const idx = this.exercises.findIndex((e) => e.id === id);
    if (idx === -1)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Not found",
      });
    const result = this.mayFail(undefined);
    if (!result.ok) return fail<ApiError>(result.error);
    const existing = this.exercises[idx];
    const updated: Exercise = {
      ...existing,
      name: data.name ?? existing.name,
      description: data.description ?? existing.description,
      instructions: data.instructions ?? existing.instructions,
      category: data.category ?? existing.category,
      difficulty: data.difficulty ?? existing.difficulty,
      primaryMuscleGroups:
        data.primaryMuscleGroups ?? existing.primaryMuscleGroups,
      secondaryMuscleGroups:
        data.secondaryMuscleGroups ?? existing.secondaryMuscleGroups,
      equipment: data.equipment ?? existing.equipment,
    };
    this.exercises[idx] = updated;
    return ok(updated);
  }

  async deleteExercise(id: string) {
    this.exercises = this.exercises.filter((e) => e.id !== id);
    return this.mayFail(undefined);
  }

  async createSet(
    _sessionId: string,
    _exerciseId: string,
    data: CreateSetInput,
  ) {
    const set: ApiExerciseSet = {
      id: `set-${this.sets.length + 1}`,
      sessionExerciseId: _exerciseId,
      setNumber: data.setNumber,
      reps: data.reps ?? null,
      weightKg: data.weightKg ?? null,
      durationSeconds: data.durationSeconds ?? null,
      distanceMeters: data.distanceMeters ?? null,
      rpe: data.rpe ?? null,
      isPersonalRecord: false,
      isCompleted: data.isCompleted ?? false,
      completedAt: data.completedAt ?? null,
    };
    this.sets.push(set);
    return this.mayFail(set);
  }

  async updateSet(
    _sessionId: string,
    _exerciseId: string,
    setId: string,
    data: UpdateSetInput,
  ) {
    const idx = this.sets.findIndex((s) => s.id === setId);
    if (idx === -1)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Not found",
      });
    const result = this.mayFail(undefined);
    if (!result.ok) return fail<ApiError>(result.error);
    this.sets[idx] = { ...this.sets[idx], ...data };
    return ok(this.sets[idx]);
  }

  async deleteSet(_sessionId: string, _exerciseId: string, setId: string) {
    this.sets = this.sets.filter((s) => s.id !== setId);
    return this.mayFail(undefined);
  }

  async getGoals(_params?: PaginationParams) {
    return this.mayFail(this.goals);
  }

  async getGoal(id: string) {
    const g = this.goals.find((g) => g.id === id);
    if (!g)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Not found",
      });
    return this.mayFail(g);
  }

  async createGoal(data: CreateGoalInput) {
    const goal: ApiGoal = {
      id: `goal-${this.goals.length + 1}`,
      userId: "test-user",
      goalTypeId: data.goalTypeId,
      priority: data.priority ?? null,
      targetDate: data.targetDate ?? null,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.goals.push(goal);
    return this.mayFail(goal);
  }

  async updateGoal(id: string, data: Partial<CreateGoalInput>) {
    const idx = this.goals.findIndex((g) => g.id === id);
    if (idx === -1)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Not found",
      });
    const result = this.mayFail(undefined);
    if (!result.ok) return fail<ApiError>(result.error);
    this.goals[idx] = {
      ...this.goals[idx],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    return ok(this.goals[idx]);
  }

  async deleteGoal(id: string) {
    this.goals = this.goals.filter((g) => g.id !== id);
    return this.mayFail(undefined);
  }

  // -- Subscriptions (M7 / M10) --
  //
  // The in-memory model records what mobile-side code asked for + replays
  // a stub response. The webhook + DB-trigger semantics that make the
  // backend code interesting are out of scope here; tests that need to
  // exercise those should use a real DB integration setup.

  /** Catalog used by `getSubscriptionTiers`. */
  public subscriptionTiers: SubscriptionTier[] = [];

  /** Per-user current subscription used by `getMySubscription`. */
  public mySubscription: MySubscription | null = null;

  async getSubscriptionTiers() {
    return this.mayFail<SubscriptionTier[]>([...this.subscriptionTiers]);
  }

  async getMySubscription() {
    if (!this.mySubscription) {
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "No subscription",
      });
    }
    return this.mayFail<MySubscription>(this.mySubscription);
  }

  /**
   * Last `createSubscription` input captured, so containers + presenters
   * can be asserted against the exact payload they sent. `null` until
   * the first call.
   */
  public lastCreateSubscriptionInput: CreateSubscriptionInput | null = null;
  /** Counter — convenient for "called exactly once" assertions. */
  public createSubscriptionCalls = 0;

  /**
   * Next response to return from `createSubscription`. Defaults to a
   * minimal happy-path payload; tests can swap to a `requiresAction`
   * shape via `setNextCreateSubscriptionResponse({ requiresAction: true,
   * clientSecret: "pi_…" })`.
   */
  public nextCreateSubscriptionResponse: CreateSubscriptionResult = {
    success: true,
    requiresAction: false,
    subscriptionId: "us_test_1",
    stripeSubscriptionId: "sub_test_1",
    trialEndsAt: null,
    nextBillingDate: null,
    paymentStatus: "active",
    changeType: "new",
    scheduled: false,
    effectiveAt: null,
    isTrial: false,
  };

  setNextCreateSubscriptionResponse(
    next: Partial<CreateSubscriptionResult>,
  ): void {
    this.nextCreateSubscriptionResponse = {
      ...this.nextCreateSubscriptionResponse,
      ...next,
    };
  }

  async createSubscription(input: CreateSubscriptionInput) {
    this.createSubscriptionCalls += 1;
    this.lastCreateSubscriptionInput = input;
    return this.mayFail<CreateSubscriptionResult>(
      this.nextCreateSubscriptionResponse,
    );
  }

  /** Captures the (subscriptionId, input) pair for the last cancel call. */
  public lastCancelSubscription: {
    subscriptionId: string;
    input: CancelSubscriptionInput;
  } | null = null;
  public cancelSubscriptionCalls = 0;
  public nextCancelSubscriptionResponse: CancelSubscriptionResult = {
    success: true,
    cancelledAt: "2026-05-21T00:00:00.000Z",
    subscriptionEndsAt: "2026-06-01T00:00:00.000Z",
    message: "Subscription will be cancelled at the end of the billing period",
  };

  async cancelSubscription(
    subscriptionId: string,
    input: CancelSubscriptionInput = {},
  ) {
    this.cancelSubscriptionCalls += 1;
    this.lastCancelSubscription = { subscriptionId, input };
    return this.mayFail<CancelSubscriptionResult>(
      this.nextCancelSubscriptionResponse,
    );
  }

  // -- Progress / Home (M4 — 06-progress-goals) --
  public habitCompletions: HabitCompletion[] = [];
  public measurements: ApiMeasurement[] = [];
  public recentPRs: PersonalRecord[] = [];
  public achievements: Achievement[] = [];
  public bodyTrend: BodyTrendPoint[] = [];
  public nextRings: Rings = {
    move: { current: 0, target: 10000, pct: 0, unit: "steps" },
    train: { current: 0, target: 20000, pct: 0, unit: "kg" },
    fuel: "gated",
    todayPct: 0,
  };
  public nextWeeklyVolume: WeeklyVolume = {
    days: [],
    totalKg: 0,
    deltaPct: null,
    workouts: { completed: 0, target: 5 },
  };
  public nextVolumeStats: VolumeStats = {
    window: "month",
    workouts: 0,
    totalKg: 0,
    totalTonnes: 0,
    adherencePct: null,
    byMuscle: [],
  };

  async getHome() {
    return this.mayFail<HomePayload>({
      rings: this.nextRings,
      micro: { streak: 0, water: null, strain: null, sleep: null },
      weeklyVolume: this.nextWeeklyVolume,
      recentPRs: this.recentPRs,
      habits: [],
      todayWorkout: [],
    });
  }
  async getTodayRings() {
    return this.mayFail<Rings>(this.nextRings);
  }
  async getWeeklyVolume(_window?: string) {
    return this.mayFail<WeeklyVolume>(this.nextWeeklyVolume);
  }
  async getVolumeStats(_window?: string) {
    return this.mayFail<VolumeStats>(this.nextVolumeStats);
  }
  async getRecentPRs(limit?: number) {
    return this.mayFail<PersonalRecord[]>(
      limit != null ? this.recentPRs.slice(0, limit) : this.recentPRs,
    );
  }
  async getBodyTrend(_window?: string) {
    return this.mayFail<BodyTrendPoint[]>(this.bodyTrend);
  }
  async getAchievements() {
    return this.mayFail<Achievement[]>(this.achievements);
  }
  async getHabitCompletions(params?: { goalId?: string; window?: string }) {
    const rows = params?.goalId
      ? this.habitCompletions.filter((h) => h.goalId === params.goalId)
      : this.habitCompletions;
    return this.mayFail<HabitCompletion[]>(rows);
  }
  async createHabitCompletion(input: CreateHabitCompletionInput) {
    const row: HabitCompletion = {
      id: `habit-${this.habitCompletions.length + 1}`,
      userId: "test-user",
      goalId: input.goalId,
      completedAt: input.date ?? new Date().toISOString(),
      value: input.value ?? null,
    };
    this.habitCompletions.push(row);
    return this.mayFail<HabitCompletion>(row);
  }
  async deleteHabitCompletion(input: DeleteHabitCompletionInput) {
    const before = this.habitCompletions.length;
    this.habitCompletions = this.habitCompletions.filter(
      (h) => h.goalId !== input.goalId,
    );
    return this.mayFail<{ deleted: boolean }>({
      deleted: this.habitCompletions.length < before,
    });
  }
  async useFreezeToken(streakId: string) {
    return this.mayFail<Streak>({
      id: streakId,
      userId: "test-user",
      streakType: "workout_streak",
      sourceGoalId: null,
      period: "weekly",
      currentCount: 1,
      longestCount: 1,
      lastPeriodEnd: "2026-06-07",
      freezeTokens: 0,
      status: "active",
    });
  }
  async getMeasurements(_params?: PaginationParams) {
    return this.mayFail<ApiMeasurement[]>(this.measurements);
  }
  async logMeasurement(input: LogMeasurementInput) {
    const row: ApiMeasurement = {
      id: `measurement-${this.measurements.length + 1}`,
      userId: "test-user",
      weightKg: input.weightKg != null ? String(input.weightKg) : null,
      bodyFatPercentage:
        input.bodyFatPercentage != null ? String(input.bodyFatPercentage) : null,
      chestCm: null,
      waistCm: null,
      hipsCm: null,
      leftArmCm: null,
      rightArmCm: null,
      leftThighCm: null,
      rightThighCm: null,
      notes: input.notes ?? null,
      measuredAt: new Date().toISOString(),
    };
    this.measurements.push(row);
    return this.mayFail<ApiMeasurement>(row);
  }
}
