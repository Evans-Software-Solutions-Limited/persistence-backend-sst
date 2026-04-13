import Constants from "expo-constants";
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

type ApiSuccessResponse<T> = { data: T };
type ApiErrorResponse = { error: string };
type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

function isErrorResponse<T>(body: ApiResponse<T>): body is ApiErrorResponse {
  return "error" in body;
}

const API_URL =
  Constants.expoConfig?.extra?.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? "";

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
  async getExercises(params?: PaginationParams) {
    return this.requestEnvelope<ApiExercise[]>("/exercises", { params });
  }

  async getExercise(id: string) {
    return this.requestEnvelope<ApiExercise>(`/exercises/${id}`);
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
