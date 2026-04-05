import Constants from "expo-constants";
import type {
  ApiResponse,
  CreateSessionInput,
  Exercise,
  ExerciseSet,
  Goal,
  HealthCheckResponse,
  PaginationParams,
  Profile,
  UpdateSessionInput,
  Workout,
  WorkoutSession,
} from "./types";

const API_URL =
  Constants.expoConfig?.extra?.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? "";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | undefined>;
};

/**
 * Core HTTP client for the SST API.
 *
 * Auth token is injected via `setTokenProvider` — called once during
 * app bootstrap from the auth layer. This keeps the API client decoupled
 * from Supabase.
 */
let tokenProvider: (() => Promise<string | null>) | null = null;

export function setTokenProvider(provider: () => Promise<string | null>) {
  tokenProvider = provider;
}

function buildUrl(
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

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, params } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (tokenProvider) {
    const token = await tokenProvider();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const response = await fetch(buildUrl(path, params), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message =
      (errorBody as { error?: string })?.error ?? response.statusText;
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// -- Typed endpoint methods --

export const api = {
  health: {
    check: () => request<HealthCheckResponse>("/health"),
  },

  profile: {
    get: () => request<ApiResponse<Profile>>("/profile"),
    update: (data: Partial<Profile>) =>
      request<ApiResponse<Profile>>("/profile", {
        method: "PATCH",
        body: data,
      }),
  },

  workouts: {
    list: (params?: PaginationParams) =>
      request<ApiResponse<Workout[]>>("/workouts", { params }),
    get: (id: string) => request<ApiResponse<Workout>>(`/workouts/${id}`),
    create: (data: Partial<Workout>) =>
      request<ApiResponse<Workout>>("/workouts", {
        method: "POST",
        body: data,
      }),
    update: (id: string, data: Partial<Workout>) =>
      request<ApiResponse<Workout>>(`/workouts/${id}`, {
        method: "PATCH",
        body: data,
      }),
    delete: (id: string) =>
      request<void>(`/workouts/${id}`, { method: "DELETE" }),
  },

  sessions: {
    list: (params?: PaginationParams) =>
      request<ApiResponse<WorkoutSession[]>>("/sessions", { params }),
    get: (id: string) =>
      request<ApiResponse<WorkoutSession>>(`/sessions/${id}`),
    create: (data: CreateSessionInput) =>
      request<ApiResponse<WorkoutSession>>("/sessions", {
        method: "POST",
        body: data,
      }),
    update: (id: string, data: UpdateSessionInput) =>
      request<ApiResponse<WorkoutSession>>(`/sessions/${id}`, {
        method: "PATCH",
        body: data,
      }),
    delete: (id: string) =>
      request<void>(`/sessions/${id}`, { method: "DELETE" }),
  },

  exercises: {
    list: (params?: PaginationParams) =>
      request<ApiResponse<Exercise[]>>("/exercises", { params }),
    get: (id: string) => request<ApiResponse<Exercise>>(`/exercises/${id}`),
  },

  sets: {
    create: (
      sessionId: string,
      exerciseId: string,
      data: Partial<ExerciseSet>,
    ) =>
      request<ApiResponse<ExerciseSet>>(
        `/sessions/${sessionId}/exercises/${exerciseId}/sets`,
        { method: "POST", body: data },
      ),
    update: (
      sessionId: string,
      exerciseId: string,
      setId: string,
      data: Partial<ExerciseSet>,
    ) =>
      request<ApiResponse<ExerciseSet>>(
        `/sessions/${sessionId}/exercises/${exerciseId}/sets/${setId}`,
        { method: "PATCH", body: data },
      ),
    delete: (sessionId: string, exerciseId: string, setId: string) =>
      request<void>(
        `/sessions/${sessionId}/exercises/${exerciseId}/sets/${setId}`,
        { method: "DELETE" },
      ),
  },

  goals: {
    list: (params?: PaginationParams) =>
      request<ApiResponse<Goal[]>>("/goals", { params }),
    get: (id: string) => request<ApiResponse<Goal>>(`/goals/${id}`),
    create: (data: Partial<Goal>) =>
      request<ApiResponse<Goal>>("/goals", { method: "POST", body: data }),
    update: (id: string, data: Partial<Goal>) =>
      request<ApiResponse<Goal>>(`/goals/${id}`, {
        method: "PATCH",
        body: data,
      }),
    delete: (id: string) => request<void>(`/goals/${id}`, { method: "DELETE" }),
  },
} as const;
