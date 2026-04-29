import Constants from "expo-constants";
import type { DashboardPayload } from "@/domain/models/dashboard";
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
  ReferenceEntry,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import type {
  ApiPort,
  ApiProfile,
  ApiWorkout,
  ApiSession,
  ApiExercise,
  ApiExerciseSet,
  ApiGoal,
  GetWorkoutsParams,
  GetWorkoutsResult,
  CreateSessionInput,
  UpdateSessionInput,
  CreateSetInput,
  CreateGoalInput,
} from "@/domain/ports/api.port";
import type {
  CreateWorkoutInput,
  UpdateWorkoutInput,
  Workout,
  WorkoutQuota,
} from "@/domain/models/workout";
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
  params?: Record<string, string | number | string[] | undefined>;
  /**
   * Per-request client-side timeout in ms. When set, the request is
   * aborted via AbortController if it doesn't settle in time and the
   * adapter returns `{ code: "timeout" }`. Off by default — only paths
   * with a known UX cost of an open-ended hang opt in (see getDashboard).
   */
  timeoutMs?: number;
};

/**
 * Default client-side timeout for the dashboard fetch. The SST dev stage
 * waits out AWS's full Lambda timeout (~30s) when the proxy target isn't
 * running, so without this the cold-start loader spins for half a minute.
 * Tuned to 10s — aggressive enough to surface real connectivity issues,
 * forgiving enough that a cellular round-trip on the live stage normally
 * settles inside the window.
 */
export const DASHBOARD_REQUEST_TIMEOUT_MS = 10_000;

/**
 * SST API adapter implementing ApiPort.
 *
 * Auth token is injected via `setTokenProvider` — called once during
 * app bootstrap from the auth layer. This keeps the API client decoupled
 * from Supabase.
 */
export class SSTApiAdapter implements ApiPort {
  private tokenProvider: (() => Promise<string | null>) | null = null;

  /**
   * UUID → display-label lookup per reference-list kind. Populated every
   * time `getReferenceList` or `hydrateReferenceLabels` runs, and used by
   * `enrichExerciseLabels` to resolve the UUID arrays the backend returns
   * for `primary_muscles` / `equipment_required` into human labels for
   * the card.
   *
   * Prefers `displayName` when set, falling back to `name` (which is the
   * actual stored label in the current Supabase schema — see
   * `muscle_groups.name` values like "Shoulders", "Quadriceps").
   *
   * Kept inside the adapter (rather than injecting StoragePort) so the
   * adapter has no cross-port dependency. The application layer owns the
   * canonical cache (StoragePort.getCachedReferenceList); this map is a
   * per-process mirror for the single hot-path label resolution.
   *
   * NOTE: pre-M0 a second `referenceLookup` (name → id) also lived here,
   * consumed by an enum→UUID resolver in `buildExerciseQueryParams`. Once
   * the filter state migrated to UUIDs (see design.md § Hierarchical
   * Filter Modal) that resolver became a no-op and was removed.
   */
  private referenceLabelLookup: Map<ReferenceListKind, Map<string, string>> =
    new Map();

  constructor() {
    validateApiUrl(API_URL);
  }

  setTokenProvider(provider: () => Promise<string | null>): void {
    this.tokenProvider = provider;
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | string[] | undefined>,
  ): string {
    const url = new URL(path, API_URL);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          // Repeated-key array format for multi-value filters (matches
          // legacy client + M0 backend contract).
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
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
    const { method = "GET", body, params, timeoutMs } = options;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.tokenProvider) {
      const token = await this.tokenProvider();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    // Per-request abort wiring. Only allocated when a caller opts into
    // a timeout — fetch otherwise behaves exactly as before, so non-
    // dashboard endpoints are unaffected by this change. The timer is
    // always cleared in `finally`, even if the request rejects.
    const controller = timeoutMs != null ? new AbortController() : null;
    const timeoutHandle =
      controller != null
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
      const response = await fetch(this.buildUrl(path, params), {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
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
      // AbortError is fetch's signal that the controller fired. Surface
      // it as a distinct `timeout` code so the UI can render a focused
      // "couldn't load — check your connection" state, separate from
      // genuine network errors (DNS, TLS, etc.) which keep `network`.
      const isAbort =
        controller != null &&
        ((err instanceof Error && err.name === "AbortError") ||
          controller.signal.aborted);
      if (isAbort) {
        return fail({
          kind: "api",
          code: "timeout",
          message: `Request timed out after ${timeoutMs}ms`,
        });
      }
      return fail({
        kind: "api",
        code: "network",
        message: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      if (timeoutHandle != null) clearTimeout(timeoutHandle);
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

  // -- Workouts (M2) --
  async getWorkouts(
    params?: GetWorkoutsParams,
  ): Promise<Result<GetWorkoutsResult, ApiError>> {
    const queryParams: Record<string, string | number | undefined> = {};
    if (params?.type) queryParams.type = params.type;
    if (params?.limit !== undefined) queryParams.limit = params.limit;
    if (params?.offset !== undefined) queryParams.offset = params.offset;

    // Backend list endpoint is double-envelope `{ data, meta }`. We
    // request the raw envelope (skipping `requestEnvelope`'s single-
    // unwrap) so the meta block is preserved.
    const result = await this.request<{
      data: ApiWorkout[];
      meta: {
        pagination: { limit: number; offset: number; total: number };
        quota?: WorkoutQuota;
      };
    }>("/workouts", { params: queryParams });
    if (!result.ok) return result;
    return ok({
      workouts: result.value.data,
      total: result.value.meta.pagination.total,
      quota: result.value.meta.quota ?? null,
    });
  }

  async getWorkout(id: string): Promise<Result<Workout, ApiError>> {
    return this.requestEnvelope<Workout>(`/workouts/${id}`);
  }

  async createWorkout(
    data: CreateWorkoutInput,
  ): Promise<Result<Workout, ApiError>> {
    return this.requestEnvelope<Workout>("/workouts", {
      method: "POST",
      body: data,
    });
  }

  async updateWorkout(
    id: string,
    data: UpdateWorkoutInput,
  ): Promise<Result<Workout, ApiError>> {
    return this.requestEnvelope<Workout>(`/workouts/${id}`, {
      method: "PATCH",
      body: data,
    });
  }

  async deleteWorkout(id: string): Promise<Result<void, ApiError>> {
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
    offset?: number,
    limit?: number,
  ): Promise<Result<PaginatedResult<Exercise>, ApiError>> {
    const params = this.buildExerciseQueryParams(filters, offset, limit);
    const result = await this.requestEnvelope<ApiExercisesPage>("/exercises", {
      params,
    });
    if (!result.ok) return result;
    const data = result.value.data
      .map(mapApiExerciseToDomain)
      .map((ex) => this.enrichExerciseLabels(ex));
    const meta = result.value.meta;
    // Prefer the backend's meta block (M0+) for pagination. Fall back to
    // the legacy cursor/hasMore shape if the server hasn't migrated yet.
    const effectiveOffset = meta?.offset ?? offset ?? 0;
    const hasMore =
      meta != null
        ? effectiveOffset + data.length < meta.total
        : (result.value.hasMore ?? false);
    return ok({
      data,
      cursor: result.value.cursor ?? null,
      hasMore,
    });
  }

  async getReferenceList(
    kind: ReferenceListKind,
  ): Promise<Result<ReferenceEntry[], ApiError>> {
    const path = referenceListPath(kind);
    if (kind === "categories") {
      // M0 shim: backend still returns { data: string[] }. Map to
      // ReferenceEntry shape client-side so consumers see a uniform
      // contract across all three kinds. Synthesise `id` from `name`
      // so filter params remain stable across renders.
      const result = await this.requestEnvelope<string[]>(path);
      if (!result.ok) return result;
      const entries: ReferenceEntry[] = result.value.map((name) => ({
        id: name,
        name,
        displayName: null,
      }));
      this.populateReferenceLookup(kind, entries);
      return ok(entries);
    }
    const result = await this.requestEnvelope<RawReferenceEntry[]>(path);
    if (!result.ok) return result;
    const entries = result.value.map(mapRawReferenceEntry);
    this.populateReferenceLookup(kind, entries);
    return ok(entries);
  }

  private populateReferenceLookup(
    kind: ReferenceListKind,
    entries: ReferenceEntry[],
  ): void {
    const idToLabel = new Map<string, string>();
    for (const entry of entries) {
      // Prefer displayName for rendering; fall back to name. This lets
      // future schema migrations populate display_name without any UI
      // change — the lookup keeps returning the right label.
      idToLabel.set(entry.id, entry.displayName ?? entry.name);
    }
    this.referenceLabelLookup.set(kind, idToLabel);
  }

  /**
   * Resolve an array of UUIDs to their display labels via the reference-
   * list cache. Used by `enrichExerciseLabels` to stamp card chips with
   * human labels.
   *
   * Contract: the returned array is **parallel-indexed** with `uuids`.
   * Unresolved ids map to an empty string rather than being silently
   * dropped — otherwise a partial lookup would misalign labels against
   * the caller's id array (ids=[A,B,C], only A+C resolve → labels=
   * ["LabelA","LabelC"] would incorrectly pair "LabelC" with id B at
   * index 1). The card renderer filters empty labels *after* pairing,
   * so the correct id↔label mapping survives.
   *
   * When the kind's lookup hasn't been hydrated yet (no fetch or cache
   * read has run for this `ReferenceListKind`), returns an empty array
   * instead of a length-matched array of empty strings. The renderer
   * treats empty-array as "labels not ready" and falls back to the
   * legacy enum→label map rather than rendering zero chips.
   */
  private resolveUuidsToLabels(
    kind: ReferenceListKind,
    uuids: readonly string[],
  ): string[] {
    const map = this.referenceLabelLookup.get(kind);
    if (!map) return [];
    return uuids.map((uuid) => map.get(uuid) ?? "");
  }

  /**
   * Seed the in-memory lookups from a previously-cached set of entries
   * (typically read from StoragePort at mount, before any network fetch).
   * Replaces existing entries for the kind. Safe to call repeatedly; a
   * later `getReferenceList` response will overwrite with fresher data.
   */
  hydrateReferenceLabels(
    kind: ReferenceListKind,
    entries: readonly ReferenceEntry[],
  ): void {
    this.populateReferenceLookup(kind, [...entries]);
  }

  /**
   * Stamp `primaryMuscleGroupLabels` / `secondaryMuscleGroupLabels` /
   * `equipmentLabels` onto an Exercise using the in-memory reference-
   * list lookup. Exposed as an instance method (not a free function) so
   * downstream flows that read cached Exercises from storage (bypassing
   * the API) can still re-enrich them when the cache pre-dates the
   * reference-list load. Safe no-op if the reference lists haven't been
   * fetched yet — card falls back to the UUID placeholder chip.
   */
  enrichExerciseLabels(exercise: Exercise): Exercise {
    const primary = this.resolveUuidsToLabels(
      "muscle_groups",
      exercise.primaryMuscleGroups as unknown as string[],
    );
    const secondary = this.resolveUuidsToLabels(
      "muscle_groups",
      exercise.secondaryMuscleGroups as unknown as string[],
    );
    const equipment = this.resolveUuidsToLabels(
      "equipment",
      exercise.equipment as unknown as string[],
    );
    return {
      ...exercise,
      primaryMuscleGroupLabels: primary,
      secondaryMuscleGroupLabels: secondary,
      equipmentLabels: equipment,
    };
  }

  /**
   * Build `GET /exercises` query params in the legacy wire format.
   * Repeated-key arrays (passed as arrays; each key emits multiple
   * `?key=value` pairs when serialised by the URL builder).
   *
   * `muscleGroups` / `equipment` values are expected to already be UUIDs
   * (see `ExerciseFilters` docstrings). The legacy enum→UUID translation
   * step was dropped in M0 once the filter modal started sourcing items
   * directly from the reference-list cache — the translation never
   * worked reliably anyway because the enum was case-sensitive against
   * title-case DB rows.
   *
   * Spec: design.md § Backend Endpoints > GET /exercises
   *       · requirements.md AC 7.13
   */
  private buildExerciseQueryParams(
    filters?: ExerciseFilters,
    offset?: number,
    limit?: number,
  ): Record<string, string | number | string[] | undefined> | undefined {
    if (!filters && offset == null && limit == null) return undefined;
    const params: Record<string, string | number | string[] | undefined> = {};
    if (offset != null) params.offset = offset;
    if (limit != null) params.limit = limit;
    if (filters?.search) params.q = filters.search;
    if (filters?.category) params.category = [filters.category];
    if (filters?.difficulties && filters.difficulties.length > 0) {
      params.difficulty_level = [...filters.difficulties];
    }
    if (filters?.createdBy) params.created_by = [filters.createdBy];
    if (filters?.muscleGroups && filters.muscleGroups.length > 0) {
      params.targeted_muscles_any = [...filters.muscleGroups];
    }
    if (filters?.equipment && filters.equipment.length > 0) {
      params.equipment_any = [...filters.equipment];
    }
    return params;
  }

  async getExercise(id: string): Promise<Result<Exercise, ApiError>> {
    const result = await this.requestEnvelope<ApiExercise>(`/exercises/${id}`);
    if (!result.ok) return result;
    return ok(this.enrichExerciseLabels(mapApiExerciseToDomain(result.value)));
  }

  async createExercise(
    data: CreateExerciseInput,
  ): Promise<Result<Exercise, ApiError>> {
    const result = await this.requestEnvelope<ApiExercise>("/exercises", {
      method: "POST",
      body: mapCreateExerciseInputToApi(data),
    });
    if (!result.ok) return result;
    return ok(this.enrichExerciseLabels(mapApiExerciseToDomain(result.value)));
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
    return ok(this.enrichExerciseLabels(mapApiExerciseToDomain(result.value)));
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

  // -- Dashboard --

  /**
   * Fetch the Home-tab aggregation payload (M1).
   *
   * Single-envelope response — the handler returns
   * `{ data: DashboardPayload }` and `requestEnvelope<T>` unwraps the
   * one layer. No reference-list UUID translation required (no
   * reference-list-typed fields on the payload).
   *
   * Spec: specs/06-progress-goals/design.md § Dashboard backend contract
   *       · requirements.md STORY-005 AC 5.8, STORY-007 AC 7.1
   */
  async getDashboard(): Promise<Result<DashboardPayload, ApiError>> {
    return this.requestEnvelope<DashboardPayload>("/dashboard", {
      timeoutMs: DASHBOARD_REQUEST_TIMEOUT_MS,
    });
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
  /** M0+ pagination envelope from the backend. */
  meta?: { total: number; offset: number; limit: number };
  /** Legacy cursor pagination shape — kept for back-compat transition. */
  cursor?: string | null;
  hasMore?: boolean;
};

/** Raw reference-list row shape from the backend (snake_case). */
type RawReferenceEntry = {
  id: string;
  name: string;
  display_name: string | null;
};

function mapRawReferenceEntry(raw: RawReferenceEntry): ReferenceEntry {
  return {
    id: raw.id,
    name: raw.name,
    displayName: raw.display_name,
  };
}

function referenceListPath(kind: ReferenceListKind): string {
  switch (kind) {
    case "muscle_groups":
      return "/exercises/muscle-groups";
    case "equipment":
      return "/exercises/equipment";
    case "categories":
      return "/exercises/categories";
  }
}

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

/**
 * Map a domain `CreateExerciseInput` (camelCase, enum strings) into the
 * backend's POST /exercises body (snake_case).
 *
 * Muscle / equipment enum arrays are NOT resolved to UUIDs here — the
 * create flow today uses the domain's enum shape; M5's real creator
 * will wire UUID resolution. For M0's __DEV__ hook the backend accepts
 * the payload as long as the UUID arrays are empty / omitted.
 *
 * Spec: design.md § Sync-Queue Wire Format · requirements.md AC 7.15
 */
export function mapCreateExerciseInputToApi(
  input: Partial<CreateExerciseInput>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.instructions !== undefined)
    payload.instructions = input.instructions;
  if (input.category !== undefined) payload.category = input.category;
  if (input.difficulty !== undefined)
    payload.difficulty_level = input.difficulty;
  if (input.videoUrl !== undefined) payload.video_url = input.videoUrl;
  if (input.thumbnailUrl !== undefined)
    payload.thumbnail_url = input.thumbnailUrl;
  // Muscle / equipment enum arrays reach the backend unchanged when the
  // creator's UUID resolver isn't wired up yet (__DEV__ form typically
  // sends empty arrays). M5's creator will resolve and send UUID arrays.
  if (input.primaryMuscleGroups !== undefined)
    payload.primary_muscles = input.primaryMuscleGroups;
  if (input.secondaryMuscleGroups !== undefined)
    payload.secondary_muscles = input.secondaryMuscleGroups;
  if (input.equipment !== undefined)
    payload.equipment_required = input.equipment;
  return payload;
}
