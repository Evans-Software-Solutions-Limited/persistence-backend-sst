import type { DashboardPayload } from "@/domain/models/dashboard";
import type {
  CreateExerciseInput,
  Exercise,
  ExerciseFilters,
} from "@/domain/models/exercise";
import type { ProfilePageData } from "@/domain/models/profilePage";
import type {
  Notification,
  NotificationsPage,
} from "@/domain/models/notification";
import type { NotificationPreferences } from "@/domain/models/notification-preferences";
import type {
  ReferenceEntry,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import { filterExercises } from "@/domain/services/exercise.service";
import {
  computeConsumed,
  computeRemaining,
  groupBySlot,
  scaleFoodMacros,
  scaleRecipeMacros,
} from "@/domain/services/nutrition.service";
import type {
  AiEstimate,
  CreateFoodInput,
  CreateMealInput,
  CreateRecipeInput,
  EditEntryInput,
  EstimateFromPhotoInput,
  EstimateFromTextInput,
  ExtractedRecipe,
  ExtractRecipePhotoInput,
  Food,
  FuelToday,
  ImportedRecipe,
  LogEntryInput,
  Meal,
  NutritionEntry,
  NutritionTarget,
  Recipe,
  ResolveIngredientInput,
  SetTargetsInput,
  WaterToday,
} from "@/domain/models/nutrition";
import type {
  ApiPort,
  GetNotificationsParams,
  RegisterDeviceInput,
  RegisterDeviceResult,
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
  ApiSleep,
  LogSleepInput,
  CreateHabitCompletionInput,
  DeleteHabitCompletionInput,
  HabitConfigEntry,
  ConfigureHabitInput,
  InviteApiError,
  ProgramApiError,
  WorkoutAssignmentRow,
  CoachClientAssignment,
  SwapWorkoutInput,
  GoalApiError,
  GoalType,
  AssignClientGoalInput,
  UpdateClientGoalInput,
  CreateClientNoteInput,
  UpdateClientNoteInput,
  SendClientBriefInput,
  SentClientBrief,
} from "@/domain/ports/api.port";
import type {
  AiSummaryModule,
  ClientDetail,
  ClientDetailNote,
} from "@/domain/models/clientDetail";
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
  ActiveProgramme,
  TodaysTrainingItem,
} from "@/domain/models/progress";
import type {
  AssignProgramInput,
  AssignWorkoutInput,
  CreateProgramInput,
  ProgramAssignmentRow,
  ProgramDetail,
  ProgramSummary,
  UpdateProgramInput,
} from "@/domain/models/program";
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
  WorkoutHistory,
  WorkoutQuota,
} from "@/domain/models/workout";
import type { CoachOverview } from "@/domain/models/coachOverview";
import type { TrainerClient } from "@/domain/models/trainerClient";
import type {
  ClientRelationshipStatus,
  ClientTrainerRelationship,
  RelationshipResponseAction,
  RelationshipResponseResult,
  RespondToClientRequestResult,
} from "@/domain/models/clientRelationship";
import type {
  InviteClientRequest,
  InviteClientResult,
  InviteErrorCode,
  TrainerInvitation,
} from "@/domain/models/trainerInvitation";
import type {
  AcceptInviteCodeApiError,
  AcceptInviteCodeErrorCode,
  AcceptInviteCodeResult,
  TrainerInviteCode,
} from "@/domain/models/trainerInviteCode";
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
  /** Optional per-workout history presets keyed by workoutId (tests set these). */
  public workoutHistory: Map<string, WorkoutHistory> = new Map();
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

  /** 30-day grace period the soft-delete fixture stamps on `purgeAfter`. */
  private static readonly SOFT_DELETE_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

  async deleteAccount(): Promise<
    Result<{ softDeleted: true; purgeAfter: string }, ApiError>
  > {
    const result = this.mayFail(undefined);
    if (!result.ok) return fail<ApiError>(result.error);
    const deletedAt = new Date().toISOString();
    const purgeAfter = new Date(
      Date.now() + InMemoryApiAdapter.SOFT_DELETE_GRACE_MS,
    ).toISOString();
    if (this.profiles[0]) {
      this.profiles[0] = { ...this.profiles[0], deletedAt, purgeAfter };
    }
    if (this.profilePage) {
      this.profilePage = {
        ...this.profilePage,
        profile: { ...this.profilePage.profile, deletedAt, purgeAfter },
      };
    }
    return ok({ softDeleted: true, purgeAfter });
  }

  async restoreAccount(): Promise<Result<{ restored: true }, ApiError>> {
    const result = this.mayFail(undefined);
    if (!result.ok) return fail<ApiError>(result.error);
    const wasSoftDeleted =
      (this.profiles[0]?.deletedAt ?? this.profilePage?.profile.deletedAt) !=
      null;
    if (!wasSoftDeleted) {
      return fail<ApiError>({
        kind: "api",
        code: "server",
        status: 409,
        message: "Account is not scheduled for deletion",
      });
    }
    if (this.profiles[0]) {
      this.profiles[0] = {
        ...this.profiles[0],
        deletedAt: null,
        purgeAfter: null,
      };
    }
    if (this.profilePage) {
      this.profilePage = {
        ...this.profilePage,
        profile: {
          ...this.profilePage.profile,
          deletedAt: null,
          purgeAfter: null,
        },
      };
    }
    return ok({ restored: true });
  }

  async getWorkouts(
    params?: GetWorkoutsParams,
  ): Promise<Result<GetWorkoutsResult, ApiError>> {
    const type = params?.type ?? "mine";
    const filtered = this.workouts.filter((w) => {
      if (type === "mine")
        return (
          w.createdBy === "test-user" &&
          // Trainer de-crowd: opt-in filter to owner-visible only.
          (!params?.ownerLibraryOnly || w.showInOwnerLibrary !== false)
        );
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

  async getWorkoutHistory(
    id: string,
  ): Promise<Result<WorkoutHistory, ApiError>> {
    const preset = this.workoutHistory.get(id);
    return this.mayFail<WorkoutHistory>(
      preset ?? {
        completedCount: 0,
        lastCompletedAt: null,
        avgDurationSeconds: null,
        lastSession: null,
      },
    );
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
      showInOwnerLibrary: data.showInOwnerLibrary ?? true,
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
      ...(data.showInOwnerLibrary !== undefined && {
        showInOwnerLibrary: data.showInOwnerLibrary,
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

  /** Count of `getProfilePage` calls (refresh-path assertions). */
  public getProfilePageCalls = 0;

  async getProfilePage(): Promise<Result<ProfilePageData, ApiError>> {
    this.getProfilePageCalls += 1;
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

  // -- Notifications (09) --
  public notifications: Notification[] = [];
  public notificationsNextCursor: string | null = null;
  public notificationsUnreadCount = 0;
  public notificationPreferences: NotificationPreferences = {};
  public registeredDevices: RegisterDeviceInput[] = [];
  public lastPreferencesUpdate: NotificationPreferences | null = null;
  /** Captures every `getNotifications` params for assertions. */
  public getNotificationsCalls: (GetNotificationsParams | undefined)[] = [];

  async getNotifications(
    params?: GetNotificationsParams,
  ): Promise<Result<NotificationsPage, ApiError>> {
    this.getNotificationsCalls.push(params);
    const rows =
      params?.unreadOnly === true
        ? this.notifications.filter((n) => n.readAt === null)
        : this.notifications;
    return this.mayFail<NotificationsPage>({
      notifications: rows,
      nextCursor: this.notificationsNextCursor,
      unreadCount: this.notificationsUnreadCount,
    });
  }

  async markNotificationRead(
    id: string,
  ): Promise<Result<Notification, ApiError>> {
    const guard = this.mayFail(undefined);
    if (!guard.ok) return fail<ApiError>(guard.error);
    const idx = this.notifications.findIndex((n) => n.id === id);
    if (idx === -1) {
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Notification not found",
      });
    }
    const existing = this.notifications[idx];
    const updated: Notification = {
      ...existing,
      readAt: existing.readAt ?? new Date().toISOString(),
    };
    this.notifications[idx] = updated;
    return ok(updated);
  }

  async markAllNotificationsRead(): Promise<
    Result<{ updated: number }, ApiError>
  > {
    const guard = this.mayFail(undefined);
    if (!guard.ok) return fail<ApiError>(guard.error);
    let updated = 0;
    const now = new Date().toISOString();
    this.notifications = this.notifications.map((n) => {
      if (n.readAt === null) {
        updated += 1;
        return { ...n, readAt: now };
      }
      return n;
    });
    return ok({ updated });
  }

  async getNotificationPreferences(): Promise<
    Result<NotificationPreferences, ApiError>
  > {
    return this.mayFail<NotificationPreferences>({
      ...this.notificationPreferences,
    });
  }

  async updateNotificationPreferences(
    partial: NotificationPreferences,
  ): Promise<Result<NotificationPreferences, ApiError>> {
    const guard = this.mayFail(undefined);
    if (!guard.ok) return fail<ApiError>(guard.error);
    this.lastPreferencesUpdate = partial;
    this.notificationPreferences = {
      ...this.notificationPreferences,
      ...partial,
    };
    return ok({ ...this.notificationPreferences });
  }

  async registerDevice(
    input: RegisterDeviceInput,
  ): Promise<Result<RegisterDeviceResult, ApiError>> {
    const guard = this.mayFail(undefined);
    if (!guard.ok) return fail<ApiError>(guard.error);
    this.registeredDevices.push(input);
    return ok<RegisterDeviceResult>({
      id: `device-${this.registeredDevices.length}`,
      registered: true,
    });
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
  /** 19-programs Phase 9 F2 fixture for `getHome`'s `activeProgramme`. */
  public nextActiveProgramme: ActiveProgramme | null = null;
  /** 19-programs Phase 9 F2 fixture for `getHome`'s `todaysTraining`. */
  public nextTodaysTraining: TodaysTrainingItem[] = [];

  async getHome() {
    return this.mayFail<HomePayload>({
      rings: this.nextRings,
      micro: { streak: 0, water: null, strain: null, sleep: null },
      weeklyVolume: this.nextWeeklyVolume,
      recentPRs: this.recentPRs,
      habits: [],
      todayWorkout: [],
      activeProgramme: this.nextActiveProgramme,
      todaysTraining: this.nextTodaysTraining,
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
  public streaks: Streak[] = [];
  async getStreaks() {
    return this.mayFail<Streak[]>(this.streaks);
  }
  async getHabitCompletions(params?: { goalId?: string; window?: string }) {
    const rows = params?.goalId
      ? this.habitCompletions.filter((h) => h.goalId === params.goalId)
      : this.habitCompletions;
    return this.mayFail<HabitCompletion[]>(rows);
  }
  /** Settable habit-config fixture (self). */
  public habitConfigs: HabitConfigEntry[] = [];
  /** Settable habit-config fixture (per client, coach reads). */
  public clientHabitConfigs: Record<string, HabitConfigEntry[]> = {};
  /** Records the last configure/disable calls so container tests can assert. */
  public configureHabitCalls: {
    clientId?: string;
    category: string;
    input: ConfigureHabitInput;
  }[] = [];
  public disableHabitCalls: { clientId?: string; category: string }[] = [];

  async getHabitConfigs() {
    return this.mayFail<HabitConfigEntry[]>(this.habitConfigs);
  }
  async configureHabit(category: string, input: ConfigureHabitInput) {
    this.configureHabitCalls.push({ category, input });
    const existing = this.habitConfigs.find((c) => c.category === category);
    const echoed: HabitConfigEntry = {
      category,
      enabled: true,
      goalId: existing?.goalId ?? `goal-${category}`,
      assignedByCoach: existing?.assignedByCoach ?? false,
      locked: existing?.locked ?? false,
      targetValue: input.targetValue,
      unit: existing?.unit ?? "",
      period: existing?.period ?? "daily",
      completionRule: existing?.completionRule ?? "value_gte",
      daysPerWeek: input.daysPerWeek ?? existing?.daysPerWeek ?? null,
      tolerancePct: input.tolerancePct ?? existing?.tolerancePct ?? null,
      pending: null,
    };
    return this.mayFail<HabitConfigEntry>(echoed);
  }
  async disableHabit(category: string) {
    this.disableHabitCalls.push({ category });
    return this.mayFail<{ category: string; disabled: true }>({
      category,
      disabled: true,
    });
  }
  async getClientHabitConfigs(clientId: string) {
    return this.mayFail<HabitConfigEntry[]>(
      this.clientHabitConfigs[clientId] ?? [],
    );
  }
  async configureClientHabit(
    clientId: string,
    category: string,
    input: ConfigureHabitInput,
  ) {
    this.configureHabitCalls.push({ clientId, category, input });
    const echoed: HabitConfigEntry = {
      category,
      enabled: true,
      goalId: `goal-${category}`,
      assignedByCoach: true,
      assignedByUserId: "test-user",
      locked: true,
      targetValue: input.targetValue,
      unit: "",
      period: "daily",
      completionRule: "value_gte",
      daysPerWeek: input.daysPerWeek ?? null,
      tolerancePct: input.tolerancePct ?? null,
      pending: null,
    };
    return this.mayFail<HabitConfigEntry>(echoed);
  }
  async disableClientHabit(clientId: string, category: string) {
    this.disableHabitCalls.push({ clientId, category });
    return this.mayFail<{ category: string; disabled: true }>({
      category,
      disabled: true,
    });
  }
  async getClientHabitCompletions(
    _clientId: string,
    params?: { goalId?: string; window?: string },
  ) {
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
  public useFreezeTokenCalls: {
    streakId: string;
    mode: "retroactive" | "skip";
  }[] = [];
  async useFreezeToken(
    streakId: string,
    mode: "retroactive" | "skip" = "retroactive",
  ) {
    this.useFreezeTokenCalls.push({ streakId, mode });
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
      loggedByUserId: null,
      weightKg: input.weightKg != null ? String(input.weightKg) : null,
      bodyFatPercentage:
        input.bodyFatPercentage != null
          ? String(input.bodyFatPercentage)
          : null,
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

  /** Sleep records keyed by `sleepDate` — mirrors the backend's one-manual-
   * row-per-day upsert (20-sleep-quicklog). */
  public sleepRecords: Map<string, ApiSleep> = new Map();
  private sleepSeq = 0;

  async logSleep(input: LogSleepInput): Promise<Result<ApiSleep, ApiError>> {
    this.sleepSeq += 1;
    const record: ApiSleep = {
      id: `sleep-${this.sleepSeq}`,
      userId: "test-user",
      sleepDate: input.sleepDate,
      durationMinutes: input.durationMinutes,
      qualityScore: null,
      deepSleepMinutes: null,
      lightSleepMinutes: null,
      remSleepMinutes: null,
      awakeMinutes: null,
      sleepStart: input.sleepStart ?? null,
      sleepEnd: input.sleepEnd ?? null,
      dataSource: "manual",
      createdAt: new Date().toISOString(),
    };
    this.sleepRecords.set(input.sleepDate, record);
    return this.mayFail<ApiSleep>(record);
  }

  async getSleepToday(
    date: string,
  ): Promise<Result<ApiSleep | null, ApiError>> {
    return this.mayFail<ApiSleep | null>(this.sleepRecords.get(date) ?? null);
  }

  /** Captures logClientWeight calls for assertions. */
  public logClientWeightCalls: {
    clientId: string;
    input: LogMeasurementInput;
  }[] = [];

  async logClientWeight(clientId: string, input: LogMeasurementInput) {
    this.logClientWeightCalls.push({ clientId, input });
    const row: ApiMeasurement = {
      id: `measurement-${this.measurements.length + 1}`,
      userId: clientId,
      loggedByUserId: "trainer-test",
      weightKg: input.weightKg != null ? String(input.weightKg) : null,
      bodyFatPercentage:
        input.bodyFatPercentage != null
          ? String(input.bodyFatPercentage)
          : null,
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
    return this.mayFail<ApiMeasurement>(row);
  }

  /** Fixture for `getClientBodyTrend`, keyed by clientId (default: empty). */
  public clientBodyTrends: Record<string, BodyTrendPoint[]> = {};

  async getClientBodyTrend(clientId: string, _window?: string) {
    return this.mayFail<BodyTrendPoint[]>(
      this.clientBodyTrends[clientId] ?? [],
    );
  }

  /** Fixture for `getClientActiveProgramme`, keyed by clientId (default null). */
  public clientActiveProgrammes: Record<string, ActiveProgramme | null> = {};
  public getClientActiveProgrammeCalls: string[] = [];

  async getClientActiveProgramme(clientId: string) {
    this.getClientActiveProgrammeCalls.push(clientId);
    return this.mayFail<ActiveProgramme | null>(
      this.clientActiveProgrammes[clientId] ?? null,
    );
  }

  // -- Client Detail aggregate (M8 Coach Phase 5) --
  /** Fixture for `getClientDetail`, keyed by clientId. */
  public clientDetails: Record<string, ClientDetail> = {};
  public getClientDetailCalls: string[] = [];
  /** Captures every on-behalf goal assign. */
  public assignClientGoalCalls: {
    clientId: string;
    input: AssignClientGoalInput;
  }[] = [];
  /** Captures every on-behalf goal edit. */
  public updateClientGoalCalls: {
    clientId: string;
    goalId: string;
    input: UpdateClientGoalInput;
  }[] = [];
  /** Captures every on-behalf nutrition-target write. */
  public setClientNutritionTargetCalls: {
    clientId: string;
    input: SetTargetsInput;
  }[] = [];
  /**
   * When set, the next goal write returns this domain error instead of
   * success (drives the `not_assigner` 403 test path). One-shot.
   */
  public nextGoalError: {
    code: NonNullable<GoalApiError["goalCode"]>;
    message: string;
  } | null = null;

  async getClientDetail(
    clientId: string,
  ): Promise<Result<ClientDetail, ApiError>> {
    this.getClientDetailCalls.push(clientId);
    const detail = this.clientDetails[clientId];
    if (detail === undefined) {
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "No client detail fixture configured",
      });
    }
    return this.mayFail<ClientDetail>(detail);
  }

  /** Captures every AI-summary generate/refresh (online-only, no queue). */
  public generateClientAiSummaryCalls: { clientId: string; manual: boolean }[] =
    [];
  /** Fixture the next generate resolves to (default a generated stub). */
  public nextAiSummary: AiSummaryModule = {
    summary: "Generated summary.",
    coversDate: "2026-07-07",
    generatedAt: "2026-07-08T06:00:00.000Z",
    canManualRefresh: true,
  };

  async generateClientAiSummary(
    clientId: string,
    manual: boolean,
  ): Promise<Result<AiSummaryModule, ApiError>> {
    this.generateClientAiSummaryCalls.push({ clientId, manual });
    return this.mayFail<AiSummaryModule>(this.nextAiSummary);
  }

  private failGoal(): Result<ApiGoal, GoalApiError> | null {
    if (this.shouldFail) {
      return fail<GoalApiError>(this.failError as GoalApiError);
    }
    if (this.nextGoalError !== null) {
      const { code, message } = this.nextGoalError;
      this.nextGoalError = null;
      return fail<GoalApiError>({
        kind: "api",
        code: "server",
        message,
        status: code === "not_assigner" ? 403 : 400,
        goalCode: code,
      });
    }
    return null;
  }

  /** Fixture for `getGoalTypes` (default a small catalog). */
  public goalTypes: GoalType[] = [
    {
      id: "gt-strength",
      name: "Build strength",
      description: null,
      category: "Performance",
      iconName: null,
    },
    {
      id: "gt-lose-weight",
      name: "Lose weight",
      description: null,
      category: "Body composition",
      iconName: null,
    },
  ];
  public getGoalTypesCalls = 0;

  async getGoalTypes(): Promise<Result<GoalType[], ApiError>> {
    this.getGoalTypesCalls += 1;
    return this.mayFail<GoalType[]>(this.goalTypes);
  }

  async assignClientGoal(
    clientId: string,
    input: AssignClientGoalInput,
  ): Promise<Result<ApiGoal, GoalApiError>> {
    this.assignClientGoalCalls.push({ clientId, input });
    const failure = this.failGoal();
    if (failure) return failure;
    const goal: ApiGoal = {
      id: `goal-${this.goals.length + 1}`,
      userId: clientId,
      goalTypeId: input.goalTypeId,
      priority: input.priority ?? 1,
      targetDate: input.targetDate ?? null,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.goals.push(goal);
    return ok(goal);
  }

  async updateClientGoal(
    clientId: string,
    goalId: string,
    input: UpdateClientGoalInput,
  ): Promise<Result<ApiGoal, GoalApiError>> {
    this.updateClientGoalCalls.push({ clientId, goalId, input });
    const failure = this.failGoal();
    if (failure) return failure;
    const now = new Date().toISOString();
    const existing = this.goals.find((g) => g.id === goalId);
    const goal: ApiGoal = {
      id: goalId,
      userId: clientId,
      goalTypeId: existing?.goalTypeId ?? "goal-type-1",
      priority: input.priority ?? existing?.priority ?? 1,
      targetDate: input.targetDate ?? existing?.targetDate ?? null,
      isActive: input.isActive ?? existing?.isActive ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    return ok(goal);
  }

  /** Captures + fixtures for coach notes CRUD. */
  public createClientNoteCalls: {
    clientId: string;
    input: CreateClientNoteInput;
  }[] = [];
  public updateClientNoteCalls: {
    clientId: string;
    noteId: string;
    input: UpdateClientNoteInput;
  }[] = [];
  public deleteClientNoteCalls: { clientId: string; noteId: string }[] = [];

  async createClientNote(
    clientId: string,
    input: CreateClientNoteInput,
  ): Promise<Result<ClientDetailNote, ApiError>> {
    this.createClientNoteCalls.push({ clientId, input });
    const note: ClientDetailNote = {
      id: `note-${this.createClientNoteCalls.length}`,
      noteType: input.noteType ?? "general",
      title: input.title ?? "",
      content: input.content,
      createdAt: new Date().toISOString(),
    };
    return this.mayFail<ClientDetailNote>(note);
  }

  async updateClientNote(
    clientId: string,
    noteId: string,
    input: UpdateClientNoteInput,
  ): Promise<Result<ClientDetailNote, ApiError>> {
    this.updateClientNoteCalls.push({ clientId, noteId, input });
    const note: ClientDetailNote = {
      id: noteId,
      noteType: input.noteType ?? "general",
      title: input.title ?? "",
      content: input.content ?? "",
      createdAt: new Date().toISOString(),
    };
    return this.mayFail<ClientDetailNote>(note);
  }

  async deleteClientNote(
    clientId: string,
    noteId: string,
  ): Promise<Result<{ deleted: true }, ApiError>> {
    this.deleteClientNoteCalls.push({ clientId, noteId });
    return this.mayFail<{ deleted: true }>({ deleted: true });
  }

  /** Captures for the coach Send-brief write (M17). */
  public sendClientBriefCalls: {
    clientId: string;
    input: SendClientBriefInput;
  }[] = [];

  async sendClientBrief(
    clientId: string,
    input: SendClientBriefInput,
  ): Promise<Result<SentClientBrief, ApiError>> {
    this.sendClientBriefCalls.push({ clientId, input });
    return this.mayFail<SentClientBrief>({
      id: `brief-${this.sendClientBriefCalls.length}`,
    });
  }

  async setClientNutritionTarget(
    clientId: string,
    input: SetTargetsInput,
  ): Promise<Result<NutritionTarget, ApiError>> {
    this.setClientNutritionTargetCalls.push({ clientId, input });
    if (this.shouldFail) return fail<ApiError>(this.failError);
    const next: NutritionTarget = {
      userId: clientId,
      dailyKcal: input.dailyKcal,
      proteinG: input.proteinG,
      carbsG: input.carbsG,
      fatG: input.fatG,
      waterCups: input.waterCups,
      preset: input.preset ?? "custom",
      setByUserId: "trainer-test",
      setByName: "Coach Test",
      updatedAt: new Date().toISOString(),
    };
    return ok(next);
  }

  // -- Trainers / Coach You (10-trainer-features) --
  public coachOverview: CoachOverview | null = null;
  public invitations: TrainerInvitation[] = [];
  /** Captures every inviteClient request for assertions. */
  public inviteClientCalls: InviteClientRequest[] = [];
  /**
   * Next response from `inviteClient`. Defaults to a happy-path
   * relationship_created; tests swap to invitation_created or set
   * `nextInviteError` to force a domain failure.
   */
  public nextInviteResult: InviteClientResult = {
    success: true,
    action: "relationship_created",
    relationshipId: "rel-1",
    clientId: "client-1",
    clientName: "Test Client",
    message: "Training request sent to Test Client",
  };
  /** When set, `inviteClient` returns this domain error instead of success. */
  public nextInviteError: { code: InviteErrorCode; message: string } | null =
    null;
  public cancelInvitationCalls: string[] = [];
  /** Count of `getCoachOverview` calls (refresh-path assertions). */
  public getCoachOverviewCalls = 0;
  /** Count of `getInvitations` calls (dedup-guard assertions). */
  public getInvitationsCalls = 0;
  /** Roster fixture returned by `getTrainerClients`. Defaults to empty. */
  public trainerClients: TrainerClient[] = [];
  /** Count of `getTrainerClients` calls (refresh-path assertions). */
  public getTrainerClientsCalls = 0;

  async getCoachOverview(): Promise<Result<CoachOverview, ApiError>> {
    this.getCoachOverviewCalls += 1;
    if (this.coachOverview === null) {
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "No coach overview fixture configured",
      });
    }
    return this.mayFail<CoachOverview>(this.coachOverview);
  }

  async getTrainerClients(): Promise<Result<TrainerClient[], ApiError>> {
    this.getTrainerClientsCalls += 1;
    return this.mayFail<TrainerClient[]>([...this.trainerClients]);
  }

  /** Captures `removeClient` calls (spec 25 coach↔client offboarding F1). */
  public removeClientCalls: string[] = [];

  async removeClient(
    clientId: string,
  ): Promise<Result<{ ended: true }, ApiError>> {
    this.removeClientCalls.push(clientId);
    const result = this.mayFail<{ ended: true }>({ ended: true });
    if (result.ok) {
      this.trainerClients = this.trainerClients.filter(
        (c) => c.id !== clientId,
      );
    }
    return result;
  }

  async getInvitations(): Promise<Result<TrainerInvitation[], ApiError>> {
    this.getInvitationsCalls += 1;
    return this.mayFail<TrainerInvitation[]>([...this.invitations]);
  }

  async inviteClient(
    req: InviteClientRequest,
  ): Promise<Result<InviteClientResult, InviteApiError>> {
    this.inviteClientCalls.push(req);
    if (this.shouldFail) {
      return fail<InviteApiError>(this.failError as InviteApiError);
    }
    if (this.nextInviteError !== null) {
      const status =
        this.nextInviteError.code === "self_invite"
          ? 400
          : this.nextInviteError.code === "no_slots"
            ? 403
            : 409;
      return fail<InviteApiError>({
        kind: "api",
        code: "server",
        message: this.nextInviteError.message,
        status,
        inviteCode: this.nextInviteError.code,
      });
    }
    return ok(this.nextInviteResult);
  }

  async cancelInvitation(
    id: string,
  ): Promise<Result<{ success: true }, ApiError>> {
    this.cancelInvitationCalls.push(id);
    const result = this.mayFail<{ success: true }>({ success: true });
    if (result.ok) {
      this.invitations = this.invitations.filter((inv) => inv.id !== id);
    }
    return result;
  }

  // -- Trainer invite-code / QR (Coach Mode Phase 8 — 10-trainer-features) --

  /** Count of `createTrainerInviteCode` calls (no request body to capture). */
  public createInviteCodeCalls = 0;
  /** Next success value returned by `createTrainerInviteCode`. */
  public nextInviteCode: TrainerInviteCode = {
    id: "invite-code-1",
    code: "AB23CD",
    expiresAt: "2099-01-01T00:00:00.000Z",
    isExisting: false,
  };
  /**
   * When set, `createTrainerInviteCode` returns this `ApiError` instead of
   * `nextInviteCode` — consumed once. Set an `entitlement_denied` /
   * `status: 402` error to simulate the client-seat-cap denial, or a plain
   * `server` / `status: 403` error for the non-trainer path.
   */
  public nextCreateInviteCodeError: ApiError | null = null;

  async createTrainerInviteCode(): Promise<
    Result<TrainerInviteCode, ApiError>
  > {
    this.createInviteCodeCalls += 1;
    if (this.shouldFail) {
      return fail<ApiError>(this.failError);
    }
    if (this.nextCreateInviteCodeError !== null) {
      const error = this.nextCreateInviteCodeError;
      this.nextCreateInviteCodeError = null;
      return fail<ApiError>(error);
    }
    return ok(this.nextInviteCode);
  }

  /** Captures every `acceptTrainerInviteCode` request for assertions. */
  public acceptInviteCodeCalls: string[] = [];
  /** Captures the consent/consentVersion args passed to `acceptTrainerInviteCode`. */
  public acceptInviteCodeConsentCalls: {
    consent: boolean;
    consentVersion: string;
  }[] = [];
  /** Next success value returned by `acceptTrainerInviteCode`. */
  public nextAcceptInviteCodeResult: AcceptInviteCodeResult = {
    success: true,
    relationshipId: "rel-1",
    trainerName: "Test Trainer",
    message: "You are now connected with Test Trainer",
  };
  /**
   * When set, `acceptTrainerInviteCode` returns this domain error instead
   * of `nextAcceptInviteCodeResult` — consumed once. Mirrors
   * `nextInviteError`.
   */
  public nextAcceptInviteCodeError: {
    code: AcceptInviteCodeErrorCode;
    message: string;
  } | null = null;

  async acceptTrainerInviteCode(
    code: string,
    consent: boolean,
    consentVersion: string,
  ): Promise<Result<AcceptInviteCodeResult, AcceptInviteCodeApiError>> {
    this.acceptInviteCodeCalls.push(code);
    this.acceptInviteCodeConsentCalls.push({ consent, consentVersion });
    if (this.shouldFail) {
      return fail<AcceptInviteCodeApiError>(
        this.failError as AcceptInviteCodeApiError,
      );
    }
    if (this.nextAcceptInviteCodeError !== null) {
      const { code: errorCode, message } = this.nextAcceptInviteCodeError;
      this.nextAcceptInviteCodeError = null;
      const status =
        errorCode === "invalid_code"
          ? 404
          : errorCode === "self_invite"
            ? 400
            : 409; // exists | code_already_used | coach_client_limit_reached
      return fail<AcceptInviteCodeApiError>({
        kind: "api",
        code: "server",
        message,
        status,
        acceptCode: errorCode,
      });
    }
    return ok(this.nextAcceptInviteCodeResult);
  }

  /**
   * Next success value returned by `respondToClientRelationship`. Callers
   * that need per-call variation (e.g. echoing `relationshipId`/`action`)
   * can override this before invoking.
   */
  public nextRespondToClientResult: RespondToClientRequestResult = {
    success: true,
    relationshipId: "rel-1",
    clientId: "client-1",
    status: "active",
  };
  /**
   * When set, `respondToClientRelationship` returns this `ApiError` instead
   * of `nextRespondToClientResult` — consumed once. Set an
   * `entitlement_denied` / `status: 402` error to simulate the accept-at-cap
   * denial.
   */
  public nextRespondToClientError: ApiError | null = null;
  /** Captures every `respondToClientRelationship` call for assertions. */
  public respondToClientRelationshipCalls: {
    relationshipId: string;
    action: RelationshipResponseAction;
  }[] = [];

  async respondToClientRelationship(
    relationshipId: string,
    action: RelationshipResponseAction,
  ): Promise<Result<RespondToClientRequestResult, ApiError>> {
    this.respondToClientRelationshipCalls.push({ relationshipId, action });
    if (this.shouldFail) {
      return fail<ApiError>(this.failError);
    }
    if (this.nextRespondToClientError !== null) {
      const error = this.nextRespondToClientError;
      this.nextRespondToClientError = null;
      return fail<ApiError>(error);
    }
    return ok({
      ...this.nextRespondToClientResult,
      relationshipId,
      status: action === "accept" ? "active" : "declined",
    });
  }

  // -- Nutrition / Fuel (M9) --

  /** Food library fixture (search + barcode resolve read this). */
  public foods: Food[] = [];
  /** Logged entries fixture; `logEntry`/`editEntry`/`deleteEntry` mutate it. */
  public nutritionEntries: NutritionEntry[] = [];
  public nutritionTarget: NutritionTarget | null = null;
  /** Water cups keyed by YYYY-MM-DD. */
  public water: Record<string, number> = {};
  public recipes: Recipe[] = [];
  public meals: Meal[] = [];
  /** When set, `resolveBarcode` returns this error instead of searching foods. */
  public nextBarcodeError: { status: number; message: string } | null = null;
  /** Pre-fill returned by `importRecipeUrl` (null → 422 no_recipe_microdata). */
  public importedRecipe: ImportedRecipe | null = null;
  public logEntryCalls: LogEntryInput[] = [];
  public setWaterCalls: { date: string; cups: number }[] = [];
  private seq = 0;
  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async getFuelToday(date: string): Promise<Result<FuelToday, ApiError>> {
    const entries = this.nutritionEntries.filter((e) =>
      e.loggedAt.startsWith(date),
    );
    const macro = computeConsumed(entries);
    const waterCups = this.water[date] ?? 0;
    return this.mayFail<FuelToday>({
      date,
      targets: this.nutritionTarget,
      consumed: { ...macro, waterCups },
      remainingKcal: computeRemaining(this.nutritionTarget, macro),
      entriesBySlot: groupBySlot(entries),
    });
  }

  async getNutritionEntries(
    date: string,
  ): Promise<Result<NutritionEntry[], ApiError>> {
    return this.mayFail<NutritionEntry[]>(
      this.nutritionEntries.filter((e) => e.loggedAt.startsWith(date)),
    );
  }

  async getNutritionTarget(): Promise<
    Result<NutritionTarget | null, ApiError>
  > {
    return this.mayFail<NutritionTarget | null>(this.nutritionTarget);
  }

  async getWaterToday(date: string): Promise<Result<WaterToday, ApiError>> {
    return this.mayFail<WaterToday>({
      cups: this.water[date] ?? 0,
      goal: this.nutritionTarget?.waterCups ?? 8,
    });
  }

  async getRecipes(): Promise<Result<Recipe[], ApiError>> {
    // List view omits ingredients (matches the backend payload-size choice).
    return this.mayFail<Recipe[]>(
      this.recipes.map((r) => ({ ...r, ingredients: [] })),
    );
  }

  async getRecipe(id: string): Promise<Result<Recipe, ApiError>> {
    const recipe = this.recipes.find((r) => r.id === id);
    if (!recipe)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "recipe_not_found",
        status: 404,
      });
    return this.mayFail<Recipe>(recipe);
  }

  async getMeals(): Promise<Result<Meal[], ApiError>> {
    return this.mayFail<Meal[]>(this.meals.map((m) => ({ ...m, items: [] })));
  }

  async searchFoods(query: string): Promise<Result<Food[], ApiError>> {
    const q = query.toLowerCase();
    return this.mayFail<Food[]>(
      this.foods.filter((f) => f.name.toLowerCase().includes(q)),
    );
  }

  async resolveBarcode(code: string): Promise<Result<Food, ApiError>> {
    if (this.nextBarcodeError) {
      const { status, message } = this.nextBarcodeError;
      return fail<ApiError>({
        kind: "api",
        code: status === 404 ? "not_found" : "server",
        message,
        status,
      });
    }
    const food = this.foods.find((f) => f.barcode === code);
    if (!food)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "barcode_not_found",
        status: 404,
      });
    return this.mayFail<Food>(food);
  }

  async logEntry(
    input: LogEntryInput,
  ): Promise<Result<NutritionEntry, ApiError>> {
    this.logEntryCalls.push(input);
    if (this.shouldFail) return fail<ApiError>(this.failError);
    // Mirror the server's macro authority: re-derive from the referenced food.
    let macro = {
      kcal: input.kcal ?? 0,
      proteinG: input.proteinG ?? 0,
      carbsG: input.carbsG ?? 0,
      fatG: input.fatG ?? 0,
    };
    if (input.foodId) {
      const food = this.foods.find((f) => f.id === input.foodId);
      if (food) macro = scaleFoodMacros(food, input.servings);
    }
    const entry: NutritionEntry = {
      id: this.id("entry"),
      userId: this.profiles[0]?.id ?? "test-user",
      foodId: input.foodId ?? null,
      recipeId: input.recipeId ?? null,
      mealId: input.mealId ?? null,
      mealSlot: input.mealSlot,
      servings: input.servings,
      ...macro,
      loggedAt: input.loggedAt,
      loggedByUserId: null,
      aiEstimated: false,
      aiConfidence: null,
      customName: null,
    };
    this.nutritionEntries.push(entry);
    return ok(entry);
  }

  async editEntry(
    id: string,
    input: EditEntryInput,
  ): Promise<Result<NutritionEntry, ApiError>> {
    if (this.shouldFail) return fail<ApiError>(this.failError);
    const idx = this.nutritionEntries.findIndex((e) => e.id === id);
    if (idx === -1)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "entry_not_found",
        status: 404,
      });
    const updated = { ...this.nutritionEntries[idx], ...input };
    this.nutritionEntries[idx] = updated;
    return ok(updated);
  }

  async deleteEntry(id: string): Promise<Result<void, ApiError>> {
    if (this.shouldFail) return fail<ApiError>(this.failError);
    const before = this.nutritionEntries.length;
    this.nutritionEntries = this.nutritionEntries.filter((e) => e.id !== id);
    if (this.nutritionEntries.length === before)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "entry_not_found",
        status: 404,
      });
    return ok(undefined);
  }

  async setTargets(
    input: SetTargetsInput,
  ): Promise<Result<NutritionTarget, ApiError>> {
    if (this.shouldFail) return fail<ApiError>(this.failError);
    const next: NutritionTarget = {
      userId: this.profiles[0]?.id ?? "test-user",
      dailyKcal: input.dailyKcal,
      proteinG: input.proteinG,
      carbsG: input.carbsG,
      fatG: input.fatG,
      waterCups: input.waterCups,
      preset: input.preset ?? "custom",
      // Self-write leaves any existing trainer attribution untouched.
      setByUserId: this.nutritionTarget?.setByUserId ?? null,
      setByName: this.nutritionTarget?.setByName ?? null,
      updatedAt: new Date().toISOString(),
    };
    this.nutritionTarget = next;
    return ok(next);
  }

  async setWater(
    date: string,
    cups: number,
  ): Promise<Result<WaterToday, ApiError>> {
    this.setWaterCalls.push({ date, cups });
    if (this.shouldFail) return fail<ApiError>(this.failError);
    const next = Math.max(0, Math.trunc(cups));
    this.water[date] = next;
    return ok({ cups: next, goal: this.nutritionTarget?.waterCups ?? 8 });
  }

  async createFood(input: CreateFoodInput): Promise<Result<Food, ApiError>> {
    if (this.shouldFail) return fail<ApiError>(this.failError);
    const food: Food = {
      id: this.id("food"),
      name: input.name,
      brand: input.brand ?? null,
      barcode: input.barcode ?? null,
      kcal: input.kcal,
      proteinG: input.proteinG,
      carbsG: input.carbsG,
      fatG: input.fatG,
      servingSize: input.servingSize,
      servingUnit: input.servingUnit,
      servingQuantity: null,
      source: "user",
      createdBy: this.profiles[0]?.id ?? "test-user",
    };
    this.foods.push(food);
    return ok(food);
  }

  async createRecipe(
    input: CreateRecipeInput,
  ): Promise<Result<Recipe, ApiError>> {
    if (this.shouldFail) return fail<ApiError>(this.failError);
    // Materialise totals from the ingredients' linked foods × quantity.
    const totals = input.ingredients.reduce(
      (acc, ing) => {
        const food = ing.foodId
          ? this.foods.find((f) => f.id === ing.foodId)
          : undefined;
        if (!food) return acc;
        return {
          kcal: acc.kcal + food.kcal * ing.quantity,
          proteinG: acc.proteinG + food.proteinG * ing.quantity,
          carbsG: acc.carbsG + food.carbsG * ing.quantity,
          fatG: acc.fatG + food.fatG * ing.quantity,
        };
      },
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );
    const recipe: Recipe = {
      id: this.id("recipe"),
      userId: this.profiles[0]?.id ?? "test-user",
      name: input.name,
      photoUrl: input.photoUrl ?? null,
      servings: input.servings,
      instructions: input.instructions ?? null,
      source: "manual",
      sourceUrl: null,
      totalKcal: Math.round(totals.kcal),
      totalProteinG: Math.round(totals.proteinG),
      totalCarbsG: Math.round(totals.carbsG),
      totalFatG: Math.round(totals.fatG),
      ingredients: input.ingredients.map((ing) => ({
        id: this.id("ing"),
        foodId: ing.foodId ?? null,
        customName: ing.customName ?? null,
        quantity: ing.quantity,
        unit: ing.unit,
        sortOrder: ing.sortOrder,
      })),
    };
    this.recipes.push(recipe);
    return ok(recipe);
  }

  async importRecipeUrl(
    url: string,
  ): Promise<Result<ImportedRecipe, ApiError>> {
    if (this.shouldFail) return fail<ApiError>(this.failError);
    if (!this.importedRecipe)
      return fail<ApiError>({
        kind: "api",
        code: "server",
        message: "no_recipe_microdata",
        status: 422,
      });
    return ok({ ...this.importedRecipe, sourceUrl: url });
  }

  async createMeal(input: CreateMealInput): Promise<Result<Meal, ApiError>> {
    if (this.shouldFail) return fail<ApiError>(this.failError);
    // Materialise totals from food items (per-serving × servings) + recipe
    // items (recipe total / recipe servings × servings).
    const totals = input.items.reduce(
      (acc, it) => {
        if (it.foodId) {
          const food = this.foods.find((f) => f.id === it.foodId);
          if (food) {
            const m = scaleFoodMacros(food, it.servings);
            return {
              kcal: acc.kcal + m.kcal,
              proteinG: acc.proteinG + m.proteinG,
              carbsG: acc.carbsG + m.carbsG,
              fatG: acc.fatG + m.fatG,
            };
          }
        }
        if (it.recipeId) {
          const recipe = this.recipes.find((r) => r.id === it.recipeId);
          if (recipe) {
            const m = scaleRecipeMacros(recipe, it.servings);
            return {
              kcal: acc.kcal + m.kcal,
              proteinG: acc.proteinG + m.proteinG,
              carbsG: acc.carbsG + m.carbsG,
              fatG: acc.fatG + m.fatG,
            };
          }
        }
        return acc;
      },
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );
    const meal: Meal = {
      id: this.id("meal"),
      userId: this.profiles[0]?.id ?? "test-user",
      name: input.name,
      photoUrl: input.photoUrl ?? null,
      totalKcal: Math.round(totals.kcal),
      totalProteinG: Math.round(totals.proteinG),
      totalCarbsG: Math.round(totals.carbsG),
      totalFatG: Math.round(totals.fatG),
      items: input.items.map((it) => ({
        id: this.id("item"),
        foodId: it.foodId ?? null,
        recipeId: it.recipeId ?? null,
        servings: it.servings,
        sortOrder: it.sortOrder,
      })),
    };
    this.meals.push(meal);
    return ok(meal);
  }

  // -- M9.5 Tier B: AI photo / free-text food estimation --

  /** Canned estimate `estimateFromPhoto`/`estimateFromText` return by default. */
  public aiEstimate: AiEstimate = {
    foods: [
      {
        name: "Grilled chicken breast",
        quantity: 180,
        unit: "g",
        estimatedGrams: 180,
        kcal: 300,
        proteinG: 56,
        carbsG: 0,
        fatG: 7,
        confidence: 0.94,
      },
    ],
    overallConfidence: 0.94,
    notes: null,
  };
  /** When set, both AI estimate methods return this error instead. */
  public nextAiEstimateError: { status: number; message: string } | null = null;
  public estimateFromPhotoCalls: EstimateFromPhotoInput[] = [];
  public estimateFromTextCalls: EstimateFromTextInput[] = [];

  async estimateFromPhoto(
    input: EstimateFromPhotoInput,
  ): Promise<Result<AiEstimate, ApiError>> {
    this.estimateFromPhotoCalls.push(input);
    if (this.nextAiEstimateError) {
      const { status, message } = this.nextAiEstimateError;
      return fail<ApiError>({ kind: "api", code: "server", message, status });
    }
    return this.mayFail<AiEstimate>(this.aiEstimate);
  }

  async estimateFromText(
    input: EstimateFromTextInput,
  ): Promise<Result<AiEstimate, ApiError>> {
    this.estimateFromTextCalls.push(input);
    if (this.nextAiEstimateError) {
      const { status, message } = this.nextAiEstimateError;
      return fail<ApiError>({ kind: "api", code: "server", message, status });
    }
    return this.mayFail<AiEstimate>(this.aiEstimate);
  }

  // -- Recipes AI (PR3): snap-photo extraction + AI ingredient resolve --

  /** Canned extraction `extractRecipeFromPhoto` returns by default. */
  public extractedRecipe: ExtractedRecipe = {
    title: "Chicken & rice bowl",
    servings: 2,
    timeMinutes: 25,
    ingredients: [
      { name: "Chicken breast", quantity: 300, unit: "g" },
      { name: "Jasmine rice", quantity: 200, unit: "g" },
    ],
    steps: ["Marinate the chicken.", "Cook the rice.", "Assemble."],
    confidence: 0.96,
    notes: null,
  };
  /** When set, both `extractRecipeFromPhoto` and `resolveIngredient` return
   * this error instead. */
  public nextRecipeAiError: { status: number; message: string } | null = null;
  public extractRecipeFromPhotoCalls: ExtractRecipePhotoInput[] = [];
  public resolveIngredientCalls: ResolveIngredientInput[] = [];

  async extractRecipeFromPhoto(
    input: ExtractRecipePhotoInput,
  ): Promise<Result<ExtractedRecipe, ApiError>> {
    this.extractRecipeFromPhotoCalls.push(input);
    if (this.nextRecipeAiError) {
      const { status, message } = this.nextRecipeAiError;
      return fail<ApiError>({ kind: "api", code: "server", message, status });
    }
    return this.mayFail<ExtractedRecipe>(this.extractedRecipe);
  }

  async resolveIngredient(
    input: ResolveIngredientInput,
  ): Promise<Result<Food, ApiError>> {
    this.resolveIngredientCalls.push(input);
    if (this.nextRecipeAiError) {
      const { status, message } = this.nextRecipeAiError;
      return fail<ApiError>({ kind: "api", code: "server", message, status });
    }
    const food: Food = {
      id: this.id("ai-food"),
      name: input.name,
      brand: null,
      barcode: null,
      kcal: 150,
      proteinG: 10,
      carbsG: 15,
      fatG: 5,
      servingSize: 100,
      servingUnit: "g",
      servingQuantity: null,
      source: "ai_recognized",
      createdBy: null,
    };
    this.foods.push(food);
    return this.mayFail<Food>(food);
  }

  /** Client-side relationships fixture (Requests screen + You section). */
  public clientRelationships: ClientTrainerRelationship[] = [];
  /** Captures respondToRelationship calls for assertions. */
  public respondToRelationshipCalls: {
    relationshipId: string;
    action: RelationshipResponseAction;
    consent?: boolean;
    consentVersion?: string;
  }[] = [];

  async getClientRelationships(
    status?: ClientRelationshipStatus,
  ): Promise<Result<ClientTrainerRelationship[], ApiError>> {
    const rows = status
      ? this.clientRelationships.filter((r) => r.status === status)
      : this.clientRelationships;
    return this.mayFail<ClientTrainerRelationship[]>([...rows]);
  }

  async respondToRelationship(
    relationshipId: string,
    action: RelationshipResponseAction,
    consent?: boolean,
    consentVersion?: string,
  ): Promise<Result<RelationshipResponseResult, ApiError>> {
    this.respondToRelationshipCalls.push({
      relationshipId,
      action,
      consent,
      consentVersion,
    });
    const result = this.mayFail<RelationshipResponseResult>({
      relationshipId,
      trainerId: "trainer-test",
      status: action === "accept" ? "active" : "terminated",
    });
    if (result.ok) {
      this.clientRelationships = this.clientRelationships.filter(
        (r) => r.relationshipId !== relationshipId,
      );
    }
    return result;
  }

  /** Captures `leaveCoach` calls (spec 25 coach↔client offboarding F1). */
  public leaveCoachCalls: string[] = [];

  async leaveCoach(
    relationshipId: string,
  ): Promise<Result<{ ended: true }, ApiError>> {
    this.leaveCoachCalls.push(relationshipId);
    const result = this.mayFail<{ ended: true }>({ ended: true });
    if (result.ok) {
      this.clientRelationships = this.clientRelationships.filter(
        (r) => r.relationshipId !== relationshipId,
      );
    }
    return result;
  }

  // -- Programs (19-programs, Phase 9 mobile — coach F1) --

  /** List fixture returned by `listPrograms`. Defaults to empty. */
  public programs: ProgramSummary[] = [];
  /** Detail fixture returned by `getProgram`. Defaults to null (404). */
  public programDetail: ProgramDetail | null = null;
  /** Count of `listPrograms` calls (refresh-path assertions). */
  public listProgramsCalls = 0;
  public getProgramCalls: string[] = [];
  public createProgramCalls: CreateProgramInput[] = [];
  public updateProgramCalls: { id: string; input: UpdateProgramInput }[] = [];
  public deleteProgramCalls: string[] = [];
  public assignProgramCalls: {
    programId: string;
    input: AssignProgramInput;
  }[] = [];
  public unassignProgramCalls: {
    programId: string;
    assignmentId: string;
  }[] = [];
  public assignWorkoutCalls: { clientId: string; input: AssignWorkoutInput }[] =
    [];
  public unassignWorkoutCalls: {
    clientId: string;
    assignmentId: string;
  }[] = [];
  /**
   * When set, the next mutating programs call (create/update/delete/assign/
   * unassign-workout) fails with this domain-coded error instead of
   * succeeding. Mirrors `nextInviteError`. Consumed once per call — tests
   * re-set it between assertions if they need repeated failures.
   */
  public nextProgramError: {
    code:
      | "invalid_workouts"
      | "not_found"
      | "PROGRAM_HAS_LIVE_ASSIGNMENTS"
      | "not_your_client"
      | "already_assigned"
      | "PROGRAM_EMPTY"
      | "invalid_workout"
      | "not_deletable"
      | "not_swappable"
      | "same_workout";
    message: string;
  } | null = null;

  private programErrorStatus(
    code: NonNullable<InMemoryApiAdapter["nextProgramError"]>["code"],
  ): number {
    switch (code) {
      case "invalid_workouts":
      case "invalid_workout":
      case "PROGRAM_EMPTY":
      case "same_workout":
        return 422;
      case "not_found":
        return 404;
      case "not_your_client":
        return 403;
      case "already_assigned":
      case "PROGRAM_HAS_LIVE_ASSIGNMENTS":
      case "not_deletable":
      case "not_swappable":
        return 409;
    }
  }

  private failProgram<T>(): Result<T, ProgramApiError> | null {
    if (this.shouldFail) {
      return fail<ProgramApiError>(this.failError as ProgramApiError);
    }
    if (this.nextProgramError !== null) {
      const { code, message } = this.nextProgramError;
      this.nextProgramError = null;
      return fail<ProgramApiError>({
        kind: "api",
        code: "server",
        message,
        status: this.programErrorStatus(code),
        programCode: code,
      });
    }
    return null;
  }

  async listPrograms(): Promise<Result<ProgramSummary[], ApiError>> {
    this.listProgramsCalls += 1;
    return this.mayFail<ProgramSummary[]>([...this.programs]);
  }

  async getProgram(id: string): Promise<Result<ProgramDetail, ApiError>> {
    this.getProgramCalls.push(id);
    if (this.programDetail === null || this.programDetail.id !== id) {
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Program not found",
        status: 404,
      });
    }
    return this.mayFail<ProgramDetail>(this.programDetail);
  }

  async createProgram(
    input: CreateProgramInput,
  ): Promise<Result<ProgramDetail, ProgramApiError>> {
    this.createProgramCalls.push(input);
    const failure = this.failProgram<ProgramDetail>();
    if (failure) return failure;
    const now = new Date().toISOString();
    const detail: ProgramDetail = {
      id: `program-${this.programs.length + 1}`,
      name: input.name,
      description: input.description ?? null,
      durationWeeks: input.durationWeeks,
      daysPerWeek: input.daysPerWeek,
      workoutCount: input.workoutIds.length,
      activeClientCount: 0,
      createdAt: now,
      updatedAt: now,
      workouts: input.workoutIds.map((workoutId, idx) => ({
        id: `pw-${idx}`,
        workoutId,
        position: idx,
        name: `Workout ${idx + 1}`,
        estimatedDurationMinutes: null,
      })),
      assignments: [],
    };
    this.programs.push(detail);
    this.programDetail = detail;
    return ok(detail);
  }

  async updateProgram(
    id: string,
    input: UpdateProgramInput,
  ): Promise<Result<ProgramDetail, ProgramApiError>> {
    this.updateProgramCalls.push({ id, input });
    const failure = this.failProgram<ProgramDetail>();
    if (failure) return failure;
    if (this.programDetail === null || this.programDetail.id !== id) {
      return fail<ProgramApiError>({
        kind: "api",
        code: "not_found",
        message: "Program not found",
        status: 404,
        programCode: "not_found",
      });
    }
    const updated: ProgramDetail = {
      ...this.programDetail,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && {
        description: input.description,
      }),
      ...(input.durationWeeks !== undefined && {
        durationWeeks: input.durationWeeks,
      }),
      ...(input.daysPerWeek !== undefined && {
        daysPerWeek: input.daysPerWeek,
      }),
      ...(input.workoutIds !== undefined && {
        workoutCount: input.workoutIds.length,
        workouts: input.workoutIds.map((workoutId, idx) => ({
          id: `pw-${idx}`,
          workoutId,
          position: idx,
          name: `Workout ${idx + 1}`,
          estimatedDurationMinutes: null,
        })),
      }),
      updatedAt: new Date().toISOString(),
    };
    this.programDetail = updated;
    this.programs = this.programs.map((p) => (p.id === id ? updated : p));
    return ok(updated);
  }

  async deleteProgram(
    id: string,
  ): Promise<Result<{ deleted: true }, ProgramApiError>> {
    this.deleteProgramCalls.push(id);
    const failure = this.failProgram<{ deleted: true }>();
    if (failure) return failure;
    this.programs = this.programs.filter((p) => p.id !== id);
    if (this.programDetail?.id === id) this.programDetail = null;
    return ok({ deleted: true });
  }

  async assignProgram(
    programId: string,
    input: AssignProgramInput,
  ): Promise<Result<ProgramAssignmentRow, ProgramApiError>> {
    this.assignProgramCalls.push({ programId, input });
    const failure = this.failProgram<ProgramAssignmentRow>();
    if (failure) return failure;
    const now = new Date().toISOString();
    return ok<ProgramAssignmentRow>({
      id: `assignment-${this.assignProgramCalls.length}`,
      programId,
      clientId: input.clientId,
      assignedBy: "trainer-test",
      startDate: input.startDate,
      endDate: null,
      status: "assigned",
      showInPlan: input.showInPlan ?? true,
      showInLibrary: input.showInLibrary ?? true,
      createdAt: now,
      updatedAt: now,
    });
  }

  async unassignProgram(
    programId: string,
    assignmentId: string,
  ): Promise<Result<{ unassigned: true }, ApiError>> {
    this.unassignProgramCalls.push({ programId, assignmentId });
    return this.mayFail<{ unassigned: true }>({ unassigned: true });
  }

  async assignWorkout(
    clientId: string,
    input: AssignWorkoutInput,
  ): Promise<Result<WorkoutAssignmentRow, ProgramApiError>> {
    this.assignWorkoutCalls.push({ clientId, input });
    const failure = this.failProgram<WorkoutAssignmentRow>();
    if (failure) return failure;
    const now = new Date().toISOString();
    return ok<WorkoutAssignmentRow>({
      id: `wa-${this.assignWorkoutCalls.length}`,
      clientId,
      workoutId: input.workoutId,
      assignedBy: "trainer-test",
      dueDate: input.dueDate ?? null,
      showInPlan: input.showInPlan ?? true,
      showInLibrary: input.showInLibrary ?? true,
      trainerNotes: input.trainerNotes ?? null,
      status: "assigned",
      createdAt: now,
      updatedAt: now,
    });
  }

  async unassignWorkout(
    clientId: string,
    assignmentId: string,
  ): Promise<Result<{ deleted: true }, ProgramApiError>> {
    this.unassignWorkoutCalls.push({ clientId, assignmentId });
    const failure = this.failProgram<{ deleted: true }>();
    if (failure) return failure;
    return ok({ deleted: true });
  }

  /** Fixtures + captures for the M18 coach client-assignments surface. */
  public clientWorkoutAssignments: Record<string, CoachClientAssignment[]> = {};
  public swapClientWorkoutAssignmentCalls: {
    clientId: string;
    assignmentId: string;
    input: SwapWorkoutInput;
  }[] = [];

  async getClientWorkoutAssignments(
    clientId: string,
  ): Promise<Result<CoachClientAssignment[], ApiError>> {
    if (this.shouldFail) return fail<ApiError>(this.failError);
    return ok(this.clientWorkoutAssignments[clientId] ?? []);
  }

  async swapClientWorkoutAssignment(
    clientId: string,
    assignmentId: string,
    input: SwapWorkoutInput,
  ): Promise<Result<WorkoutAssignmentRow, ProgramApiError>> {
    this.swapClientWorkoutAssignmentCalls.push({
      clientId,
      assignmentId,
      input,
    });
    const failure = this.failProgram<WorkoutAssignmentRow>();
    if (failure) return failure;
    const now = new Date().toISOString();
    return ok<WorkoutAssignmentRow>({
      id: assignmentId,
      clientId,
      workoutId: input.workoutId,
      assignedBy: "trainer-test",
      dueDate: null,
      showInPlan: true,
      showInLibrary: true,
      trainerNotes: null,
      status: "assigned",
      createdAt: now,
      updatedAt: now,
    });
  }
}
