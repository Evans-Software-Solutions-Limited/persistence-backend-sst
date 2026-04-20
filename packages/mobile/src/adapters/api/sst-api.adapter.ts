import Constants from "expo-constants";
import type {
  CreateExerciseInput,
  EquipmentType,
  Exercise,
  ExerciseCategory,
  ExerciseDifficulty,
  ExerciseFilters,
  MuscleGroup,
} from "@/domain/models/exercise";
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
import type { PaginatedResult, PaginationParams } from "@/shared/types";

type ApiSuccessResponse<T> = { data: T };
type ApiErrorResponse = { error: string };
type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

function isErrorResponse<T>(body: ApiResponse<T>): body is ApiErrorResponse {
  return "error" in body;
}

const API_URL =
  Constants.expoConfig?.extra?.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? "";

function validateApiUrl(url: string): void {
  if (!url) {
    throw new Error(
      "Missing API configuration: set apiUrl in app.config extra or EXPO_PUBLIC_API_URL env var",
    );
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | undefined>;
};

/**
 * SST API adapter implementing ApiPort.
 *
 * Auth token is injected via `setTokenProvider` — called once during
 * app bootstrap from the auth layer. This keeps the API client decoupled
 * from Supabase.
 */
export class SSTApiAdapter implements ApiPort {
  private tokenProvider: (() => Promise<string | null>) | null = null;

  constructor() {
    validateApiUrl(API_URL);
  }

  setTokenProvider(provider: () => Promise<string | null>): void {
    this.tokenProvider = provider;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(path, API_URL);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<Result<T, ApiError>> {
    const { method = "GET", body, params } = options;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.tokenProvider) {
      const token = await this.tokenProvider();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    try {
      const response = await fetch(this.buildUrl(path, params), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message =
          (errorBody as { error?: string })?.error ?? response.statusText;
        return fail({
          kind: "api",
          code:
            response.status === 401
              ? "unauthorized"
              : response.status === 404
                ? "not_found"
                : "server",
          message,
          status: response.status,
        });
      }

      // Handle 204 No Content (typical for DELETE)
      if (
        response.status === 204 ||
        response.headers.get("content-length") === "0"
      ) {
        return ok(undefined as T);
      }

      const json = (await response.json()) as T;
      return ok(json);
    } catch (err) {
      return fail({
        kind: "api",
        code: "network",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  private async requestEnvelope<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<Result<T, ApiError>> {
    const result = await this.request<ApiResponse<T>>(path, options);
    if (!result.ok) return result;
    const body = result.value;
    if (isErrorResponse(body)) {
      return fail({ kind: "api", code: "server", message: body.error });
    }
    return ok(body.data);
  }

  // -- Health --
  async healthCheck() {
    return this.request<{ status: string }>("/health");
  }

  // -- Profile --
  async getProfile() {
    return this.requestEnvelope<ApiProfile>("/profile");
  }

  async updateProfile(data: Partial<ApiProfile>) {
    return this.requestEnvelope<ApiProfile>("/profile", {
      method: "PATCH",
      body: data,
    });
  }

  // -- Workouts --
  async getWorkouts(params?: PaginationParams) {
    return this.requestEnvelope<ApiWorkout[]>("/workouts", { params });
  }

  async getWorkout(id: string) {
    return this.requestEnvelope<ApiWorkout>(`/workouts/${id}`);
  }

  async createWorkout(data: CreateWorkoutInput) {
    return this.requestEnvelope<ApiWorkout>("/workouts", {
      method: "POST",
      body: data,
    });
  }

  async updateWorkout(id: string, data: Partial<CreateWorkoutInput>) {
    return this.requestEnvelope<ApiWorkout>(`/workouts/${id}`, {
      method: "PATCH",
      body: data,
    });
  }

  async deleteWorkout(id: string) {
    return this.request<void>(`/workouts/${id}`, { method: "DELETE" });
  }

  // -- Sessions --
  async getSessions(params?: PaginationParams) {
    return this.requestEnvelope<ApiSession[]>("/sessions", { params });
  }

  async getSession(id: string) {
    return this.requestEnvelope<ApiSession>(`/sessions/${id}`);
  }

  async createSession(data: CreateSessionInput) {
    return this.requestEnvelope<ApiSession>("/sessions", {
      method: "POST",
      body: data,
    });
  }

  async updateSession(id: string, data: UpdateSessionInput) {
    return this.requestEnvelope<ApiSession>(`/sessions/${id}`, {
      method: "PATCH",
      body: data,
    });
  }

  async deleteSession(id: string) {
    return this.request<void>(`/sessions/${id}`, { method: "DELETE" });
  }

  // -- Exercises --
  async getExercises(
    filters?: ExerciseFilters,
    cursor?: string,
  ): Promise<Result<PaginatedResult<Exercise>, ApiError>> {
    const params = buildExerciseQueryParams(filters, cursor);
    const result = await this.requestEnvelope<ApiExercisesPage>("/exercises", {
      params,
    });
    if (!result.ok) return result;
    return ok({
      data: result.value.data.map(mapApiExerciseToDomain),
      cursor: result.value.cursor ?? null,
      hasMore: result.value.hasMore ?? false,
    });
  }

  async getExercise(id: string): Promise<Result<Exercise, ApiError>> {
    const result = await this.requestEnvelope<ApiExercise>(`/exercises/${id}`);
    if (!result.ok) return result;
    return ok(mapApiExerciseToDomain(result.value));
  }

  async createExercise(
    data: CreateExerciseInput,
  ): Promise<Result<Exercise, ApiError>> {
    const result = await this.requestEnvelope<ApiExercise>("/exercises", {
      method: "POST",
      body: mapCreateExerciseInputToApi(data),
    });
    if (!result.ok) return result;
    return ok(mapApiExerciseToDomain(result.value));
  }

  async updateExercise(
    id: string,
    data: Partial<CreateExerciseInput>,
  ): Promise<Result<Exercise, ApiError>> {
    const result = await this.requestEnvelope<ApiExercise>(`/exercises/${id}`, {
      method: "PATCH",
      body: mapCreateExerciseInputToApi(data),
    });
    if (!result.ok) return result;
    return ok(mapApiExerciseToDomain(result.value));
  }

  async deleteExercise(id: string): Promise<Result<void, ApiError>> {
    return this.request<void>(`/exercises/${id}`, { method: "DELETE" });
  }

  // -- Sets --
  async createSet(sessionId: string, exerciseId: string, data: CreateSetInput) {
    return this.requestEnvelope<ApiExerciseSet>(
      `/sessions/${sessionId}/exercises/${exerciseId}/sets`,
      { method: "POST", body: data },
    );
  }

  async updateSet(
    sessionId: string,
    exerciseId: string,
    setId: string,
    data: Partial<CreateSetInput>,
  ) {
    return this.requestEnvelope<ApiExerciseSet>(
      `/sessions/${sessionId}/exercises/${exerciseId}/sets/${setId}`,
      { method: "PATCH", body: data },
    );
  }

  async deleteSet(sessionId: string, exerciseId: string, setId: string) {
    return this.request<void>(
      `/sessions/${sessionId}/exercises/${exerciseId}/sets/${setId}`,
      { method: "DELETE" },
    );
  }

  // -- Goals --
  async getGoals(params?: PaginationParams) {
    return this.requestEnvelope<ApiGoal[]>("/goals", { params });
  }

  async getGoal(id: string) {
    return this.requestEnvelope<ApiGoal>(`/goals/${id}`);
  }

  async createGoal(data: CreateGoalInput) {
    return this.requestEnvelope<ApiGoal>("/goals", {
      method: "POST",
      body: data,
    });
  }

  async updateGoal(id: string, data: Partial<CreateGoalInput>) {
    return this.requestEnvelope<ApiGoal>(`/goals/${id}`, {
      method: "PATCH",
      body: data,
    });
  }

  async deleteGoal(id: string) {
    return this.request<void>(`/goals/${id}`, { method: "DELETE" });
  }
}

// -- Exercise wire-format mapping --

type ApiExercisesPage = {
  data: ApiExercise[];
  cursor?: string | null;
  hasMore?: boolean;
};

function mapApiExerciseToDomain(api: ApiExercise): Exercise {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    instructions: api.instructions,
    category: api.category as ExerciseCategory,
    difficulty: api.difficultyLevel as ExerciseDifficulty,
    primaryMuscleGroups: api.primaryMuscles as MuscleGroup[],
    secondaryMuscleGroups: api.secondaryMuscles as MuscleGroup[],
    equipment: api.equipmentRequired as EquipmentType[],
    videoUrl: api.videoUrl ?? null,
    thumbnailUrl: api.thumbnailUrl ?? null,
    // Derive client-side: V2 backend uses createdBy IS NULL for system
    // exercises and has no is_custom column. Fall back to the wire
    // flag if the backend still sets it (transitional).
    isCustom: api.isCustom ?? api.createdBy !== null,
    createdBy: api.createdBy,
  };
}

function mapCreateExerciseInputToApi(
  input: Partial<CreateExerciseInput>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.instructions !== undefined)
    payload.instructions = input.instructions;
  if (input.category !== undefined) payload.category = input.category;
  if (input.difficulty !== undefined)
    payload.difficultyLevel = input.difficulty;
  if (input.primaryMuscleGroups !== undefined)
    payload.primaryMuscles = input.primaryMuscleGroups;
  if (input.secondaryMuscleGroups !== undefined)
    payload.secondaryMuscles = input.secondaryMuscleGroups;
  if (input.equipment !== undefined)
    payload.equipmentRequired = input.equipment;
  return payload;
}

function buildExerciseQueryParams(
  filters?: ExerciseFilters,
  cursor?: string,
): Record<string, string | number | undefined> | undefined {
  if (!filters && !cursor) return undefined;
  const params: Record<string, string | number | undefined> = {};
  if (cursor) params.cursor = cursor;
  if (filters?.search) params.search = filters.search;
  if (filters?.category) params.category = filters.category;
  if (filters?.difficulties && filters.difficulties.length > 0) {
    params.difficulty = filters.difficulties.join(",");
  }
  if (filters?.createdBy) params.createdBy = filters.createdBy;
  if (filters?.muscleGroups && filters.muscleGroups.length > 0) {
    params.muscleGroups = filters.muscleGroups.join(",");
  }
  if (filters?.equipment && filters.equipment.length > 0) {
    params.equipment = filters.equipment.join(",");
  }
  return params;
}
