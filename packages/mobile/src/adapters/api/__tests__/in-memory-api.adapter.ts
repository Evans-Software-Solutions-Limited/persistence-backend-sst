import type {
  ApiPort,
  ApiProfile,
  ApiWorkout,
  ApiSession,
  ApiExercise,
  ApiExerciseSet,
  ApiGoal,
  CreateWorkoutInput,
  CreateSessionInput,
  UpdateSessionInput,
  CreateSetInput,
  CreateGoalInput,
} from "@/domain/ports/api.port";
import { ok, fail, type Result, type ApiError } from "@/shared/errors";
import type { PaginationParams } from "@/shared/types";

/**
 * In-memory API adapter for testing.
 * Stores data in arrays, returns it directly.
 */
export class InMemoryApiAdapter implements ApiPort {
  public profiles: ApiProfile[] = [];
  public workouts: ApiWorkout[] = [];
  public sessions: ApiSession[] = [];
  public exercises: ApiExercise[] = [];
  public sets: ApiExerciseSet[] = [];
  public goals: ApiGoal[] = [];
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
    if (this.profiles[0]) {
      this.profiles[0] = { ...this.profiles[0], ...data };
    }
    return this.getProfile();
  }

  async getWorkouts(_params?: PaginationParams) {
    return this.mayFail(this.workouts);
  }

  async getWorkout(id: string) {
    const w = this.workouts.find((w) => w.id === id);
    if (!w)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Workout not found",
      });
    return this.mayFail(w);
  }

  async createWorkout(data: CreateWorkoutInput) {
    const workout: ApiWorkout = {
      id: `workout-${this.workouts.length + 1}`,
      name: data.name,
      description: data.description ?? null,
      createdBy: "test-user",
      visibility: data.visibility ?? "private",
      estimatedDurationMinutes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.workouts.push(workout);
    return this.mayFail(workout);
  }

  async updateWorkout(id: string, data: Partial<CreateWorkoutInput>) {
    const idx = this.workouts.findIndex((w) => w.id === id);
    if (idx === -1)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Not found",
      });
    this.workouts[idx] = {
      ...this.workouts[idx],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    return this.mayFail(this.workouts[idx]);
  }

  async deleteWorkout(id: string) {
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
    this.sessions[idx] = {
      ...this.sessions[idx],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    return this.mayFail(this.sessions[idx]);
  }

  async deleteSession(id: string) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    return this.mayFail(undefined);
  }

  async getExercises(_params?: PaginationParams) {
    return this.mayFail(this.exercises);
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
    };
    this.sets.push(set);
    return this.mayFail(set);
  }

  async updateSet(
    _sessionId: string,
    _exerciseId: string,
    setId: string,
    data: Partial<CreateSetInput>,
  ) {
    const idx = this.sets.findIndex((s) => s.id === setId);
    if (idx === -1)
      return fail<ApiError>({
        kind: "api",
        code: "not_found",
        message: "Not found",
      });
    this.sets[idx] = { ...this.sets[idx], ...data };
    return this.mayFail(this.sets[idx]);
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
    this.goals[idx] = {
      ...this.goals[idx],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    return this.mayFail(this.goals[idx]);
  }

  async deleteGoal(id: string) {
    this.goals = this.goals.filter((g) => g.id !== id);
    return this.mayFail(undefined);
  }
}
