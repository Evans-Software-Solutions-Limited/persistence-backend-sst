import type { DashboardPayload } from "@/domain/models/dashboard";
import type {
  CreateExerciseInput,
  Exercise,
  ExerciseFilters,
} from "@/domain/models/exercise";
import type {
  ReferenceEntry,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import type {
  CreateWorkoutInput as CreateWorkoutDomainInput,
  UpdateWorkoutInput as UpdateWorkoutDomainInput,
  Workout,
  WorkoutListType,
  WorkoutQuota,
} from "@/domain/models/workout";
import type { Result, ApiError } from "@/shared/errors";
import type { PaginatedResult, PaginationParams } from "@/shared/types";

/**
 * Port for remote SST API operations.
 * Implementations: SSTApiAdapter (prod), InMemoryApiAdapter (test).
 *
 * Methods are added per-feature milestone. This initial definition
 * covers the foundation endpoints.
 */
export interface ApiPort {
  /** Health check */
  healthCheck(): Promise<Result<{ status: string }, ApiError>>;

  // -- Profile --
  getProfile(): Promise<Result<ApiProfile, ApiError>>;
  updateProfile(
    data: Partial<ApiProfile>,
  ): Promise<Result<ApiProfile, ApiError>>;

  // -- Workouts (M2) --
  /**
   * Fetch a workouts list slice for one of the three section types
   * (mine / assigned / default). The double-envelope response carries
   * pagination metadata and (for `type=mine` only) a `quota` block.
   *
   * Spec: specs/04-workout-management/design.md § API Contract > GET /workouts
   */
  getWorkouts(
    params?: GetWorkoutsParams,
  ): Promise<Result<GetWorkoutsResult, ApiError>>;
  getWorkout(id: string): Promise<Result<Workout, ApiError>>;
  createWorkout(
    data: CreateWorkoutDomainInput,
  ): Promise<Result<Workout, ApiError>>;
  updateWorkout(
    id: string,
    data: UpdateWorkoutDomainInput,
  ): Promise<Result<Workout, ApiError>>;
  deleteWorkout(id: string): Promise<Result<void, ApiError>>;

  // -- Sessions --
  getSessions(
    params?: PaginationParams,
  ): Promise<Result<ApiSession[], ApiError>>;
  getSession(id: string): Promise<Result<ApiSession, ApiError>>;
  createSession(
    data: CreateSessionInput,
  ): Promise<Result<ApiSession, ApiError>>;
  updateSession(
    id: string,
    data: UpdateSessionInput,
  ): Promise<Result<ApiSession, ApiError>>;
  deleteSession(id: string): Promise<Result<void, ApiError>>;

  /**
   * M3: app-launch resume detection. Returns the user's most recent
   * `in_progress` session (if any) — used to populate the
   * `<ResumePrompt>` overlay on app launch ("Continue Push Day?").
   * Returns `null` (Result.ok) when the user has no active session;
   * Result.err only on transport / auth failures.
   *
   * Wraps `GET /sessions?status=in_progress&limit=1`.
   */
  getActiveSession(): Promise<Result<ApiSession | null, ApiError>>;

  /**
   * M3: bulk-record a completed (or cancelled) session in one
   * atomic server-side transaction. The active-session flush path —
   * mobile keeps the active session in local state, then on Finish
   * builds the full `RecordSessionInput` payload and POSTs once via
   * this method.
   *
   * Backend writes session row + every exercise + every set + runs
   * PR detection in one Postgres transaction. Returns the canonical
   * session with server-assigned UUIDs so the mobile sync worker can
   * swap its `local-…` ids for the real ones.
   *
   * Mirrors the legacy `persistence-mobile` repo's `recordWorkout`
   * mutation. Wraps `POST /sessions/record`.
   *
   * NOT idempotent on retry: calling this twice for the same mobile-
   * side session writes two DB sessions. The sync worker is
   * responsible for not retrying past success — typically by
   * checking the queue entry's `committedAt` / response cache before
   * re-firing.
   *
   * Spec: specs/milestones/M3-active-session/BACKEND_BRIEF.md § 7.
   */
  recordSession(
    payload: RecordSessionInput,
  ): Promise<Result<RecordedApiSession, ApiError>>;

  /**
   * M3: create a session_exercise row. Used by the sync queue when
   * flushing a completed session — once the parent session is created
   * server-side, each child exercise is POSTed via this method,
   * carrying the M3 substitution fields (`supersetGroup`,
   * `isSubstituted`, `originalExerciseId`).
   *
   * Mobile DELETE on session_exercise is unused in M3 (substitution
   * flow creates a new row rather than deleting the old one — the old
   * row stays with `isSubstituted: true` to preserve its sets).
   */
  createSessionExercise(
    sessionId: string,
    data: CreateSessionExerciseInput,
  ): Promise<Result<ApiSessionExercise, ApiError>>;

  /**
   * M3: list the user's PRs, optionally filtered by exercise and / or
   * record type. Mobile uses this for (a) quick-fill suggestions
   * during set logging, (b) populating the local cache that the
   * Summary screen's predictive PR detection reads, (c) M4's PR
   * carousel.
   */
  getPersonalRecords(
    params?: GetPersonalRecordsParams,
  ): Promise<Result<ApiPersonalRecord[], ApiError>>;

  /**
   * Seed the adapter's in-memory id→label + name→id reference-list
   * lookups from a previously-cached set of entries (typically loaded
   * from StoragePort at app start). Normally the adapter populates
   * these maps lazily inside `getReferenceList`; this lets a caller
   * prime them without hitting the network so that `getExercises`
   * responses can be enriched with muscle / equipment labels even on
   * cold cache + second-launch paths where no reference-list fetch
   * fires. Safe to call repeatedly; replaces the existing entries.
   */
  hydrateReferenceLabels(
    kind: ReferenceListKind,
    entries: readonly ReferenceEntry[],
  ): void;

  /**
   * Apply the adapter's cached reference-list lookups to an Exercise,
   * stamping `primaryMuscleGroupLabels` / `secondaryMuscleGroupLabels` /
   * `equipmentLabels`. Pure — does not touch storage or network. Safe
   * no-op if the lookups aren't hydrated yet (labels come back empty).
   */
  enrichExerciseLabels(exercise: Exercise): Exercise;

  // -- Exercises --
  getExercises(
    filters?: ExerciseFilters,
    offset?: number,
    limit?: number,
  ): Promise<Result<PaginatedResult<Exercise>, ApiError>>;
  /**
   * Full-text + trigram search via the backend `/exercises/search`
   * endpoint. Returns ranked results ordered by combined `ts_rank` +
   * `word_similarity` score, scoped to the caller's visible exercise
   * set (system + own customs + connected-PT customs; system-only when
   * unauthenticated).
   *
   * `q` must be at least 2 chars after trim — the backend returns 400
   * otherwise. Callers should guard before calling.
   *
   * `filters` (category / equipment / muscles / difficulty / createdBy)
   * AND-combine with the FTS predicate server-side, so ranking happens
   * within the filtered set. Without this, a search-plus-category-filter
   * combo silently drops matches ranked at position 101+. The `search`
   * field on `filters` is ignored — the explicit `q` argument is
   * authoritative.
   *
   * Returns labels-enriched Exercise entries (same shape as
   * `getExercises`). The adapter applies `enrichExerciseLabels` so
   * containers can render chips without re-stamping.
   *
   * Spec: specs/03-exercise-library/POSTGRES_FTS_INVESTIGATION.md.
   */
  searchExercises(
    q: string,
    filters?: ExerciseFilters,
    offset?: number,
    limit?: number,
  ): Promise<Result<PaginatedResult<Exercise>, ApiError>>;
  getExercise(id: string): Promise<Result<Exercise, ApiError>>;
  createExercise(
    data: CreateExerciseInput,
  ): Promise<Result<Exercise, ApiError>>;
  updateExercise(
    id: string,
    data: Partial<CreateExerciseInput>,
  ): Promise<Result<Exercise, ApiError>>;
  deleteExercise(id: string): Promise<Result<void, ApiError>>;

  /**
   * Fetch a reference-list catalog (muscle groups / equipment / categories)
   * from the backend. Returns `ReferenceEntry[]` — the ApiPort does NOT
   * hold onto the list; the StoragePort caches it separately.
   *
   * Spec: design.md § Reference-List Cache > Port extensions · AC 7.10
   */
  getReferenceList(
    kind: ReferenceListKind,
  ): Promise<Result<ReferenceEntry[], ApiError>>;

  // -- Sets --
  createSet(
    sessionId: string,
    exerciseId: string,
    data: CreateSetInput,
  ): Promise<Result<ApiExerciseSet, ApiError>>;
  updateSet(
    sessionId: string,
    exerciseId: string,
    setId: string,
    data: UpdateSetInput,
  ): Promise<Result<ApiExerciseSet, ApiError>>;
  deleteSet(
    sessionId: string,
    exerciseId: string,
    setId: string,
  ): Promise<Result<void, ApiError>>;

  /**
   * Fetch the Home-tab dashboard aggregation payload (M1).
   *
   * Single-envelope response (`{ data: DashboardPayload }`) — adapter
   * unwraps once. No UUID-typed fields on the payload, so no
   * reference-list enrichment is required.
   *
   * Spec: specs/06-progress-goals/design.md § Dashboard backend contract (M1)
   *       specs/06-progress-goals/requirements.md STORY-005 AC 5.8, STORY-007 AC 7.1
   */
  getDashboard(): Promise<Result<DashboardPayload, ApiError>>;

  // -- Goals --
  getGoals(params?: PaginationParams): Promise<Result<ApiGoal[], ApiError>>;
  getGoal(id: string): Promise<Result<ApiGoal, ApiError>>;
  createGoal(data: CreateGoalInput): Promise<Result<ApiGoal, ApiError>>;
  updateGoal(
    id: string,
    data: Partial<CreateGoalInput>,
  ): Promise<Result<ApiGoal, ApiError>>;
  deleteGoal(id: string): Promise<Result<void, ApiError>>;
}

// -- API data shapes (mirror backend response types) --

export type ApiProfile = {
  id: string;
  email: string;
  fullName: string | null;
  role: "user" | "personal_trainer" | "physiotherapist" | "admin";
  fitnessLevel: "beginner" | "intermediate" | "advanced" | "elite" | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Wire shape for a workout. The M2 backend emits camelCase via Drizzle,
 * so `ApiWorkout` and the domain `Workout` model are structurally
 * identical — the adapter passes payloads through without mapping.
 */
export type ApiWorkout = Workout;

/** M2: query params for the GET /workouts list endpoint. */
export type GetWorkoutsParams = {
  type?: WorkoutListType;
  limit?: number;
  offset?: number;
};

/**
 * M2: list response. Mirrors the backend's double-envelope `{ data, meta }`
 * after the adapter unwraps once. `quota` is only present when the
 * request was for `type='mine'`; absent for `assigned` / `default`.
 */
export type GetWorkoutsResult = {
  workouts: Workout[];
  total: number;
  quota: WorkoutQuota | null;
};

export type ApiSession = {
  id: string;
  userId: string;
  workoutId: string | null;
  name: string | null;
  status: "in_progress" | "completed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  totalDurationSeconds: number | null;
  userNotes: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Nested session-exercise list. M3 backend's `GET /sessions/:id`
   * returns the parent session row joined with its `session_exercises`
   * children (see `microservices/core/src/application/repositories/
   * sessionRepository.ts:38` `getById`). Optional on the type because
   * list responses (`GET /sessions`) emit the flat row only — only
   * single-session reads include the nested array.
   */
  exercises?: ApiSessionExercise[];
};

/**
 * M3 wire shape for a session_exercise row. Mirrors the columns
 * selected by `SessionRepository.getById` (sessionRepository.ts:56)
 * — including the M3-additive columns `superset_group`,
 * `is_substituted`, `original_exercise_id`.
 */
export type ApiSessionExercise = {
  id: string;
  sessionId: string;
  exerciseId: string;
  sortOrder: number;
  supersetGroup: number | null;
  isSubstituted: boolean;
  originalExerciseId: string | null;
  notes: string | null;
  createdAt: string;
};

/**
 * M3 wire shape for a personal_records row. The `recordType` enum is
 * the canonical Postgres `record_type` enum (`packages/db/src/schema.
 * ts:60`). M3's server-side detection writes `1rm` only; M4 may
 * extend.
 */
export type ApiPersonalRecord = {
  id: string;
  userId: string;
  exerciseId: string;
  recordType: PersonalRecordType;
  /** Wire format is decimal string (e.g. `"120.50"`). Parse on read. */
  value: string;
  setId: string | null;
  achievedAt: string;
};

export type PersonalRecordType =
  | "1rm"
  | "3rm"
  | "5rm"
  | "10rm"
  | "max_reps"
  | "max_weight"
  | "best_time"
  | "longest_distance";

export type ApiExercise = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  category: string;
  difficultyLevel: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipmentRequired: string[];
  /** Added M0. Backend emits these on GET /exercises and GET /exercises/:id. */
  videoUrl: string | null;
  thumbnailUrl: string | null;
  /**
   * Present on some backend responses (pre-M0) but no longer set by
   * the M0 backend — it derives isCustom client-side from `createdBy
   * !== null`. Kept optional on the wire type so adapters stay
   * tolerant of either shape during the transition.
   */
  isCustom?: boolean;
  createdBy: string | null;
};

export type ApiExerciseSet = {
  id: string;
  sessionExerciseId: string;
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: number | null;
  isPersonalRecord: boolean;
  /** M3: client marks set complete + server stamps timestamp. */
  isCompleted: boolean;
  completedAt: string | null;
};

export type ApiGoal = {
  id: string;
  userId: string;
  goalTypeId: string;
  priority: number | null;
  targetDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// -- Input types --
// `CreateWorkoutInput` and `UpdateWorkoutInput` are imported from
// `@/domain/models/workout` (re-exported as `CreateWorkoutDomainInput` /
// `UpdateWorkoutDomainInput`) so the form layer and the API layer share
// one canonical definition.

export type CreateSessionInput = {
  workoutId?: string;
  name?: string;
  status?: "in_progress" | "completed" | "cancelled";
  userNotes?: string;
};

export type UpdateSessionInput = {
  status?: "in_progress" | "completed" | "cancelled";
  userNotes?: string;
  sessionRating?: number;
  overallRpe?: number;
};

export type CreateSetInput = {
  setNumber: number;
  reps?: number;
  weightKg?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  rpe?: number;
  /**
   * M3: clients flip these when a user marks a set done. If
   * `isCompleted: true` is sent without `completedAt`, the server
   * stamps `completedAt = now()` so the two columns stay consistent.
   */
  isCompleted?: boolean;
  completedAt?: string | null;
};

/**
 * M3: PATCH body for `updateSet`. Same field set as `CreateSetInput`
 * with everything optional EXCEPT `setNumber` — set position within
 * an exercise is fixed at creation time. Drag-and-drop set
 * reordering is M11 polish per BRIEF.md, and the backend handler
 * silently ignores `setNumber` on PATCH anyway, so including it on
 * this type would be a typed contract that doesn't match runtime
 * behaviour.
 */
export type UpdateSetInput = {
  reps?: number;
  weightKg?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  rpe?: number;
  isCompleted?: boolean;
  completedAt?: string | null;
};

/**
 * M3: POST body for creating a session_exercise. Includes the new
 * substitution fields (`isSubstituted`, `originalExerciseId`) so a
 * mobile sync flush can replay a substituted exercise as a fresh
 * row pointing back at the original.
 */
export type CreateSessionExerciseInput = {
  exerciseId: string;
  sortOrder?: number;
  notes?: string;
  supersetGroup?: number | null;
  isSubstituted?: boolean;
  originalExerciseId?: string | null;
};

/**
 * M3: GET /personal-records query params. All optional. Mobile uses
 * `exerciseId` to populate quick-fill suggestions while logging sets;
 * M4's PR carousel will issue the unfiltered version.
 */
export type GetPersonalRecordsParams = {
  exerciseId?: string;
  recordType?: PersonalRecordType;
  limit?: number;
  offset?: number;
};

/**
 * M3: payload shape for the bulk-record session flush. Mobile builds
 * this once on Finish from local state, server writes everything in
 * one transaction (root + all exercises + all sets + PR detection).
 *
 * Mirrors `RecordSessionInput` on the backend exactly — keep the two
 * in sync.
 */
export type RecordSessionInput = {
  workoutId?: string | null;
  name?: string | null;
  startedAt: string;
  completedAt?: string | null;
  status: "completed" | "cancelled";
  totalDurationSeconds?: number | null;
  userNotes?: string | null;
  sessionRating?: number | null;
  overallRpe?: number | null;
  difficultyRanking?: number | null;
  exercises: {
    exerciseId: string;
    sortOrder: number;
    supersetGroup?: number | null;
    isSubstituted?: boolean;
    originalExerciseId?: string | null;
    notes?: string | null;
    sets: {
      setNumber: number;
      reps?: number | null;
      weightKg?: string | number | null;
      durationSeconds?: number | null;
      distanceMeters?: string | number | null;
      rpe?: number | null;
      restAfterSeconds?: number | null;
      isCompleted?: boolean;
      completedAt?: string | null;
    }[];
  }[];
};

/**
 * M3: response shape from `POST /sessions/record`. Same as `ApiSession`
 * with the nested `exercises` always populated, and each exercise
 * carrying its own nested `sets[]`. Mobile uses the server-assigned
 * UUIDs to swap its local- prefixed ids in the SQLite mirror.
 */
export type RecordedApiSession = ApiSession & {
  exercises: (ApiSessionExercise & {
    sets: ApiExerciseSet[];
  })[];
};

export type CreateGoalInput = {
  goalTypeId: string;
  priority?: number;
  targetDate?: string;
};
