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
  params?: Record<string, string | number | string[] | undefined>;
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

  /**
   * Enum → UUID lookup for each reference-list kind. Populated every
   * time `getReferenceList` resolves successfully, so subsequent
   * filter-param builds can translate `"chest"` → `<uuid>`.
   *
   * Kept inside the adapter (rather than injecting StoragePort) so the
   * adapter has no cross-port dependency. The application layer owns
   * the canonical cache (StoragePort.getCachedReferenceList); this map
   * is a per-process mirror for the single hot-path translation.
   */
  private referenceLookup: Map<ReferenceListKind, Map<string, string>> =
    new Map();

  /**
   * UUID → display-label lookup. Built from the same reference-list fetch
   * as `referenceLookup` (inverse map). Used by `mapApiExerciseToDomain`
   * to resolve the UUID arrays the backend returns for `primary_muscles`
   * / `equipment_required` into human labels for the card.
   *
   * Prefers `displayName` when set, falling back to `name` (which is the
   * actual stored label in the current Supabase schema — see
   * `muscle_groups.name` values like "Shoulders", "Quadriceps").
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
    const nameToId = new Map<string, string>();
    const idToLabel = new Map<string, string>();
    for (const entry of entries) {
      nameToId.set(entry.name, entry.id);
      // Prefer displayName for rendering; fall back to name. This lets
      // future schema migrations populate display_name without any UI
      // change — the lookup keeps returning the right label.
      idToLabel.set(entry.id, entry.displayName ?? entry.name);
    }
    this.referenceLookup.set(kind, nameToId);
    this.referenceLabelLookup.set(kind, idToLabel);
  }

  private resolveEnumToUuid(
    kind: ReferenceListKind,
    key: string,
  ): string | null {
    return this.referenceLookup.get(kind)?.get(key) ?? null;
  }

  /**
   * Resolve an array of UUIDs to their display labels via the reference-
   * list cache. Used by `mapApiExerciseToDomain` to enrich exercise rows
   * with labels for card rendering. Unresolved ids fall back to `null`
   * so the caller can distinguish "not in cache yet" from "no entry".
   */
  private resolveUuidsToLabels(
    kind: ReferenceListKind,
    uuids: readonly string[],
  ): string[] {
    const map = this.referenceLabelLookup.get(kind);
    if (!map) return [];
    const labels: string[] = [];
    for (const uuid of uuids) {
      const label = map.get(uuid);
      if (label) labels.push(label);
    }
    return labels;
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

  private resolveEnumsToUuids(
    kind: ReferenceListKind,
    keys: string[],
  ): string[] {
    const resolved: string[] = [];
    for (const key of keys) {
      const uuid = this.resolveEnumToUuid(kind, key);
      if (uuid) {
        resolved.push(uuid);
      } else {
        // Reference-list cache missing this key. Drop the filter rather
        // than shipping an enum string the backend can't use. UI should
        // surface zero results rather than a server error.
        console.warn(
          `[SSTApiAdapter] No UUID mapping for ${kind}="${key}"; filter value skipped. Reference-list cache may be stale.`,
        );
      }
    }
    return resolved;
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
