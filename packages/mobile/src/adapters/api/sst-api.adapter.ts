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
import type { ProfilePageData } from "@/domain/models/profilePage";
import type {
  ReferenceEntry,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import type {
  ApiPort,
  ApiProfile,
  ApiWorkout,
  ApiSession,
  ApiSessionExercise,
  ApiExercise,
  ApiExerciseSet,
  ApiGoal,
  ApiPersonalRecord,
  CreateSessionExerciseInput,
  GetPersonalRecordsParams,
  GetWorkoutsParams,
  GetWorkoutsResult,
  CreateSessionInput,
  UpdateSessionInput,
  CreateSetInput,
  UpdateSetInput,
  CreateGoalInput,
  RecordSessionInput,
  RecordedApiSession,
  UploadAvatarInput,
  CreateSubscriptionInput,
  CancelSubscriptionInput,
} from "@/domain/ports/api.port";
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
import {
  ok,
  fail,
  type Result,
  type ApiError,
  type ApiErrorEntitlementPayload,
} from "@/shared/errors";
import type { PaginatedResult, PaginationParams } from "@/shared/types";

type ApiSuccessResponse<T> = { data: T };
type ApiErrorResponse = { error: string };
type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

function isErrorResponse<T>(body: ApiResponse<T>): body is ApiErrorResponse {
  return "error" in body;
}

const API_URL =
  Constants.expoConfig?.extra?.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? "";

/**
 * Resolve the SST API base URL the same way the adapter does.
 * Exported so non-adapter callers (e.g. the sync queue worker, which
 * uses raw `fetch` rather than the adapter's request helpers) can
 * read the configured host without re-implementing the lookup.
 */
export function getApiBaseUrl(): string {
  return API_URL;
}

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
        return fail(
          mapHttpErrorToApiError(
            response.status,
            response.statusText,
            errorBody,
          ),
        );
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

  /**
   * M6: Profile-tab aggregation. Backend returns a single envelope
   * `{ data: ProfilePageData }`; `requestEnvelope<T>` unwraps the
   * one layer.
   *
   * Spec: specs/milestones/M6-profile/BACKEND_BRIEF.md
   */
  async getProfilePage() {
    return this.requestEnvelope<ProfilePageData>("/profile/page");
  }

  /**
   * M6 PR-3: multipart avatar upload. Bypasses the JSON `request` helper
   * because the body is FormData, not JSON, and `fetch` needs to set the
   * `Content-Type: multipart/form-data; boundary=…` header itself —
   * setting it manually clobbers the boundary the runtime injects.
   *
   * React Native's FormData accepts a `{ uri, name, type }` shape as the
   * second arg even though TS types it as `Blob | string`; the native
   * bridge streams the file from disk without reading bytes into JS.
   */
  async uploadAvatar(input: UploadAvatarInput) {
    const formData = new FormData();
    formData.append("file", {
      uri: input.uri,
      name: input.name ?? "avatar.jpg",
      type: input.mimeType,
    } as unknown as Blob);

    const headers: Record<string, string> = {};
    if (this.tokenProvider) {
      const token = await this.tokenProvider();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(this.buildUrl("/profile/avatar"), {
        method: "POST",
        headers,
        body: formData,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        return fail<ApiError>(
          mapHttpErrorToApiError(
            response.status,
            response.statusText,
            errorBody,
          ),
        );
      }

      const body = (await response.json()) as ApiResponse<{
        avatarUrl: string;
      }>;
      if (isErrorResponse(body)) {
        return fail<ApiError>({
          kind: "api",
          code: "server",
          message: body.error,
        });
      }
      return ok(body.data);
    } catch (err) {
      return fail<ApiError>({
        kind: "api",
        code: "network",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  async deleteAvatar() {
    return this.requestEnvelope<{ avatarUrl: null }>("/profile/avatar", {
      method: "DELETE",
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

  async recordSession(payload: RecordSessionInput) {
    return this.requestEnvelope<RecordedApiSession>("/sessions/record", {
      method: "POST",
      body: payload,
    });
  }

  async getActiveSession(): Promise<Result<ApiSession | null, ApiError>> {
    // Wraps GET /sessions?status=in_progress&limit=1. M3 surfaces a
    // resumable session via `ActiveSessionBanner` (driven by the
    // local SQLite mirror); this endpoint exists for cross-device
    // resume scenarios (M9+) and is currently unused on the client.
    // Returns ok(null) when the user has no active session — distinct
    // from a transport failure, which still returns Result.err.
    const result = await this.requestEnvelope<ApiSession[]>("/sessions", {
      params: { status: "in_progress", limit: 1 },
    });
    if (!result.ok) return result;
    return ok(result.value[0] ?? null);
  }

  async createSessionExercise(
    sessionId: string,
    data: CreateSessionExerciseInput,
  ) {
    return this.requestEnvelope<ApiSessionExercise>(
      `/sessions/${sessionId}/exercises`,
      { method: "POST", body: data },
    );
  }

  async getPersonalRecords(params?: GetPersonalRecordsParams) {
    return this.requestEnvelope<ApiPersonalRecord[]>("/personal-records", {
      params,
    });
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

  async searchExercises(
    q: string,
    filters?: ExerciseFilters,
    offset?: number,
    limit?: number,
  ): Promise<Result<PaginatedResult<Exercise>, ApiError>> {
    // Reuse the list endpoint's param builder so search inherits the same
    // wire shape for category / equipment / muscles / difficulty /
    // created_by — the search endpoint accepts the same names. The
    // builder's `search` → `q` mapping is overwritten below because the
    // explicit `q` argument is authoritative for search.
    const baseParams =
      this.buildExerciseQueryParams(filters, offset, limit) ?? {};
    const params: Record<string, string | number | string[] | undefined> = {
      ...baseParams,
      q,
    };
    const result = await this.requestEnvelope<ApiExercisesPage>(
      "/exercises/search",
      { params },
    );
    if (!result.ok) return result;
    const data = result.value.data
      .map(mapApiExerciseToDomain)
      .map((ex) => this.enrichExerciseLabels(ex));
    const meta = result.value.meta;
    const effectiveOffset = meta?.offset ?? offset ?? 0;
    const hasMore =
      meta != null ? effectiveOffset + data.length < meta.total : false;
    return ok({
      data,
      cursor: null,
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
    data: UpdateSetInput,
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

  // -- Subscriptions (M7 / M10) --
  //
  // Write endpoints (POST /subscriptions, POST /subscriptions/:id/cancel)
  // return their data flat — no `{ data }` envelope — so they use
  // `request<T>`. The new M10 read endpoints (`GET /subscription-tiers`,
  // `GET /subscriptions/me`) use the single-envelope shape per design.md
  // and go via `requestEnvelope<T>`.
  //
  // The adapter handles the camelCase domain ↔ snake_case wire mapping
  // at this boundary so containers + presenters never touch snake_case.

  async getSubscriptionTiers() {
    return this.requestEnvelope<WireSubscriptionTier[]>("/subscription-tiers", {
      // No auth — public catalog. The base `request<T>` only attaches
      // the Authorization header when the token provider has a token,
      // so an unauthenticated app launch's catalog fetch still works.
    }).then((result) =>
      result.ok
        ? ok(result.value.map(mapSubscriptionTier))
        : (result as Result<SubscriptionTier[], ApiError>),
    );
  }

  async getMySubscription() {
    return this.requestEnvelope<MySubscription>("/subscriptions/me");
  }

  async createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<Result<CreateSubscriptionResult, ApiError>> {
    const body: Record<string, unknown> = {
      tier_name: input.tierName,
      billing_cycle: input.billingCycle,
      use_trial: input.useTrial,
    };
    if (input.paymentMethodId !== undefined) {
      body.payment_method_id = input.paymentMethodId;
    }
    if (input.platform !== undefined) {
      body.platform = input.platform;
    }
    const result = await this.request<WireCreateSubscriptionResponse>(
      "/subscriptions",
      {
        method: "POST",
        body,
      },
    );
    if (!result.ok) return result;
    return ok(mapCreateSubscriptionResponse(result.value));
  }

  async cancelSubscription(
    subscriptionId: string,
    input: CancelSubscriptionInput = {},
  ): Promise<Result<CancelSubscriptionResult, ApiError>> {
    // Always send a JSON body — backend's Elysia validator expects an
    // object (`cancel_immediately` is optional, defaults to false). An
    // empty object is safe and explicit.
    const body: Record<string, unknown> = {};
    if (input.cancelImmediately !== undefined) {
      body.cancel_immediately = input.cancelImmediately;
    }
    const result = await this.request<WireCancelSubscriptionResponse>(
      `/subscriptions/${subscriptionId}/cancel`,
      {
        method: "POST",
        body,
      },
    );
    if (!result.ok) return result;
    return ok({
      success: true,
      cancelledAt: result.value.cancelled_at,
      subscriptionEndsAt: result.value.subscription_ends_at,
      message: result.value.message,
    });
  }
}

// -- HTTP error → ApiError mapping --

/**
 * Wire shape of the backend's structured entitlement-denied body. The
 * 402-response handler in `microservices/core` emits these field names
 * verbatim — the adapter parses them here at the boundary and converts
 * to camelCase before stamping the `entitlement` payload on `ApiError`.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Entitlement enforcement (M10.5) > 402 response shape
 *
 * Field origin:
 *   {
 *     "code": "ENTITLEMENT_DENIED",
 *     "error": "Subscription does not include this feature",
 *     "feature": "create_workout",
 *     "current_tier": "basic",
 *     "upgrade_to": "premium",
 *     "upgrade_price_monthly": 14.99
 *   }
 */
type WireEntitlementDeniedBody = {
  code?: unknown;
  error?: unknown;
  feature?: unknown;
  current_tier?: unknown;
  upgrade_to?: unknown;
  upgrade_price_monthly?: unknown;
};

/**
 * Parse a 402 response body into the camelCase entitlement payload, or
 * return `null` if the body is malformed (missing `code`,
 * `code !== "ENTITLEMENT_DENIED"`, or the four required wire fields
 * aren't shaped as expected). The adapter falls back to a vanilla
 * `server`-code `ApiError` on null — never silently drops the status.
 *
 * Strict on `feature` / `current_tier` (must be strings; absence drops
 * to a plain server error). Lenient on `upgrade_to` (may be null when
 * the user is already at the top tier) and `upgrade_price_monthly`
 * (likewise null).
 */
function parseEntitlementDeniedBody(
  body: unknown,
): ApiErrorEntitlementPayload | null {
  if (body === null || typeof body !== "object") return null;
  const raw = body as WireEntitlementDeniedBody;
  if (raw.code !== "ENTITLEMENT_DENIED") return null;
  if (typeof raw.feature !== "string") return null;
  if (typeof raw.current_tier !== "string") return null;

  const upgradeTo =
    raw.upgrade_to === null || typeof raw.upgrade_to === "string"
      ? (raw.upgrade_to as string | null)
      : undefined;
  if (upgradeTo === undefined) return null;

  const upgradePriceMonthly =
    raw.upgrade_price_monthly === null ||
    typeof raw.upgrade_price_monthly === "number"
      ? (raw.upgrade_price_monthly as number | null)
      : undefined;
  if (upgradePriceMonthly === undefined) return null;

  return {
    feature: raw.feature,
    currentTier: raw.current_tier,
    upgradeTo,
    upgradePriceMonthly,
  };
}

/**
 * Translate an HTTP non-2xx response into a domain `ApiError`. Lives
 * outside the class so `uploadAvatar` (which has its own fetch loop
 * for multipart FormData) can share the same mapping with the JSON
 * `request<T>` path — keeps the 401 / 404 / 402 / generic-server
 * branches in a single place.
 *
 * 402 + `code: "ENTITLEMENT_DENIED"` body → `ApiError` with code
 * `entitlement_denied` and the `entitlement` payload populated.
 * 402 with a malformed body falls back to a vanilla `server` error
 * (the response status is still preserved on `status` so containers
 * can render a useful fallback).
 *
 * Spec: specs/11-payments-subscriptions/design.md § Mobile feature-gate model
 * Satisfies: requirements.md AC 10.4
 */
export function mapHttpErrorToApiError(
  status: number,
  statusText: string,
  body: unknown,
): ApiError {
  const message =
    (body as { error?: string } | null)?.error ??
    statusText ??
    "Request failed";

  if (status === 402) {
    const entitlement = parseEntitlementDeniedBody(body);
    if (entitlement !== null) {
      return {
        kind: "api",
        code: "entitlement_denied",
        message,
        status,
        entitlement,
      };
    }
    // 402 with a malformed / missing body: don't swallow the status —
    // surface as a generic server error so the container can still
    // render a fallback. Don't claim it's an entitlement error.
    return {
      kind: "api",
      code: "server",
      message,
      status,
    };
  }

  return {
    kind: "api",
    code:
      status === 401 ? "unauthorized" : status === 404 ? "not_found" : "server",
    message,
    status,
  };
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

/**
 * Sentinel owner id for the stock/system exercise catalogue. The backend's
 * Supabase rows tag system exercises with `created_by = SYSTEM_USER_ID`
 * (an all-zeros UUID) — NOT `NULL` — so a naive `createdBy !== null` check
 * marks the ENTIRE stock catalogue as custom (System filter empties, Mine
 * shows everything). Mirror the backend constant
 * (`microservices/core/src/application/repositories/exerciseRepository.ts`
 * `SYSTEM_USER_ID`) here so the client can recognise + normalise it.
 */
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

function mapApiExerciseToDomain(api: ApiExercise): Exercise {
  // A row is system-authored when it has no owner OR carries the system
  // sentinel. Normalise both to a null `createdBy` so ownership checks
  // (`createdBy === userId`) and the Mine/System quick-filters treat the
  // stock catalogue as un-owned.
  const isSystemAuthored =
    api.createdBy == null || api.createdBy === SYSTEM_USER_ID;
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
    // Prefer an explicit wire flag if the backend ever sends one; otherwise
    // derive: custom iff a real (non-system) owner authored it.
    isCustom: api.isCustom ?? !isSystemAuthored,
    createdBy: isSystemAuthored ? null : api.createdBy,
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

// -- Subscription wire-format mapping --
//
// The backend's `subscription_tiers` rows surface decimal-string prices
// (Postgres numeric / decimal columns) over the wire; the adapter parses
// them to numbers at this boundary so the rest of the mobile app
// (containers / presenters / domain services) only ever sees `number`.

/**
 * Raw row shape returned by `GET /subscription-tiers`. Carries decimal-
 * string prices and JSONB features as the backend emits them.
 */
type WireSubscriptionTier = {
  tierName: SubscriptionTier["tierName"];
  displayName: string;
  description: string | null;
  /** Wire format is decimal string ("9.99"); parsed at this boundary. */
  priceMonthly: string | number;
  priceYearly: string | number | null;
  currency: string;
  features: Record<string, unknown>;
  workoutLimit: number | null;
  aiAccess: boolean;
  aiWorkoutLimit: number;
  gymBuddyAccess: boolean;
  trainerClientLimit: number | null;
  isTrainerTier: boolean;
  analyticsAccess: boolean;
  exportAccess: boolean;
  stripePriceIdMonthly: string | null;
  stripePriceIdYearly: string | null;
};

function parseDecimal(value: string | number): number {
  return typeof value === "number" ? value : Number.parseFloat(value);
}

export function mapSubscriptionTier(
  raw: WireSubscriptionTier,
): SubscriptionTier {
  return {
    tierName: raw.tierName,
    displayName: raw.displayName,
    description: raw.description,
    priceMonthly: parseDecimal(raw.priceMonthly),
    priceYearly:
      raw.priceYearly === null ? null : parseDecimal(raw.priceYearly),
    currency: raw.currency,
    features: raw.features,
    workoutLimit: raw.workoutLimit,
    aiAccess: raw.aiAccess,
    aiWorkoutLimit: raw.aiWorkoutLimit,
    gymBuddyAccess: raw.gymBuddyAccess,
    trainerClientLimit: raw.trainerClientLimit,
    isTrainerTier: raw.isTrainerTier,
    analyticsAccess: raw.analyticsAccess,
    exportAccess: raw.exportAccess,
    stripePriceIdMonthly: raw.stripePriceIdMonthly,
    stripePriceIdYearly: raw.stripePriceIdYearly,
  };
}

/**
 * Wire shape returned by `POST /subscriptions`. snake_case fields as
 * the backend emits them. Includes the M10 discriminators added to
 * the response surface.
 */
type WireCreateSubscriptionResponse = {
  success: true;
  requires_action: boolean;
  subscription_id: string;
  stripe_subscription_id: string;
  trial_ends_at: string | null;
  next_billing_date: string | null;
  payment_status: string;
  client_secret?: string;
  reinstated?: boolean;
  // M10 additions
  change_type: "new" | "upgrade" | "downgrade" | "reinstate" | "cycle_change";
  scheduled: boolean;
  effective_at: string | null;
  is_trial: boolean;
};

export function mapCreateSubscriptionResponse(
  raw: WireCreateSubscriptionResponse,
): CreateSubscriptionResult {
  const result: CreateSubscriptionResult = {
    success: true,
    requiresAction: raw.requires_action,
    subscriptionId: raw.subscription_id,
    stripeSubscriptionId: raw.stripe_subscription_id,
    trialEndsAt: raw.trial_ends_at,
    nextBillingDate: raw.next_billing_date,
    // The wire type widens payment_status to `string` because the
    // backend's enum is the source of truth; cast at the boundary so
    // the domain shape stays strict.
    paymentStatus:
      raw.payment_status as CreateSubscriptionResult["paymentStatus"],
    changeType: raw.change_type,
    scheduled: raw.scheduled,
    effectiveAt: raw.effective_at,
    isTrial: raw.is_trial,
  };
  if (raw.client_secret !== undefined) result.clientSecret = raw.client_secret;
  if (raw.reinstated !== undefined) result.reinstated = raw.reinstated;
  return result;
}

/**
 * Wire shape returned by `POST /subscriptions/:id/cancel`. Unchanged
 * from PR #70 — M10 doesn't touch this endpoint.
 */
type WireCancelSubscriptionResponse = {
  success: true;
  cancelled_at: string;
  subscription_ends_at: string;
  message: string;
};
