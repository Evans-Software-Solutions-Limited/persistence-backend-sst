import type { DashboardPayload } from "@/domain/models/dashboard";
import type {
  CreateExerciseInput,
  Exercise,
  ExerciseFilters,
} from "@/domain/models/exercise";
import type {
  Notification,
  NotificationsPage,
} from "@/domain/models/notification";
import type { NotificationPreferences } from "@/domain/models/notification-preferences";
import type { ProfilePageData } from "@/domain/models/profilePage";
import type {
  ReferenceEntry,
  ReferenceListKind,
} from "@/domain/models/reference-list";
import type {
  BillingCycle,
  CancelSubscriptionResult,
  CreateSubscriptionResult,
  MySubscription,
  SubscriptionTier,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import type {
  CreateWorkoutInput as CreateWorkoutDomainInput,
  UpdateWorkoutInput as UpdateWorkoutDomainInput,
  Workout,
  WorkoutListType,
  WorkoutQuota,
} from "@/domain/models/workout";
import type { Result, ApiError } from "@/shared/errors";
import type { PaginatedResult, PaginationParams } from "@/shared/types";
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
import type { CoachOverview } from "@/domain/models/coachOverview";
import type { TrainerClient } from "@/domain/models/trainerClient";
import type {
  ClientRelationshipStatus,
  ClientTrainerRelationship,
  RelationshipResponseAction,
  RelationshipResponseResult,
} from "@/domain/models/clientRelationship";
import type {
  InviteClientRequest,
  InviteClientResult,
  InviteErrorCode,
  TrainerInvitation,
} from "@/domain/models/trainerInvitation";
import type {
  CreateFoodInput,
  CreateMealInput,
  CreateRecipeInput,
  EditEntryInput,
  Food,
  FuelToday,
  ImportedRecipe,
  LogEntryInput,
  Meal,
  NutritionEntry,
  NutritionTarget,
  Recipe,
  SetTargetsInput,
  WaterToday,
} from "@/domain/models/nutrition";

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

  /**
   * M6: fetch the Profile-tab aggregation payload in a single round trip.
   *
   * Single-envelope response (`{ data: ProfilePageData }`) — adapter
   * unwraps once. No reference-list UUID translation required.
   *
   * Spec: specs/milestones/M6-profile/BACKEND_BRIEF.md
   */
  getProfilePage(): Promise<Result<ProfilePageData, ApiError>>;

  /**
   * M6 PR-3: upload a new avatar via multipart POST. The mobile flow
   * resizes the source image client-side (expo-image-manipulator) to
   * 512×512 JPEG before calling this — server validates content-type
   * (image/jpeg|png|webp) and 5MB cap but does not re-encode. Returns
   * the canonical public S3 URL on success.
   */
  uploadAvatar(
    input: UploadAvatarInput,
  ): Promise<Result<{ avatarUrl: string }, ApiError>>;

  /**
   * M6 PR-3: remove the user's avatar — deletes the S3 object and
   * nulls `profiles.avatar_url`. Idempotent: succeeds whether the
   * object exists in S3 or not.
   */
  deleteAvatar(): Promise<Result<{ avatarUrl: null }, ApiError>>;

  /**
   * App Store Guideline 5.1.1(v): permanently delete the caller's account.
   * The backend cascade-purges all of the user's owned data and deletes the
   * Supabase auth user so the credential can no longer sign in. Idempotent.
   * See specs/08-profile-settings § Revised 2026-06-28 (STORY-011).
   */
  deleteAccount(): Promise<Result<void, ApiError>>;

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

  // -- Subscriptions (M7 / M10) --
  /**
   * M10: fetch the active subscription-tier catalog. Public read — no
   * auth required (the auth-flow Selection screen renders pre-sign-in).
   *
   * Returns rows in `price_monthly ASC` order, filtered `is_active = true`.
   * Adapter parses the wire's decimal-string prices to numbers.
   *
   * Wraps `GET /subscription-tiers`. Spec: design.md § Backend endpoints.
   */
  getSubscriptionTiers(): Promise<Result<SubscriptionTier[], ApiError>>;

  /**
   * M10: fetch the current user's subscription joined with tier metadata
   * + profile role + trial-eligibility flags.
   *
   * When the user has no `user_subscriptions` row, the backend synthesises
   * a `free`-tier shape so the mobile UI never has to handle a null sub
   * specially (AC 5.4).
   *
   * Wraps `GET /subscriptions/me`. Auth required. Spec: design.md §
   * Backend endpoints.
   */
  getMySubscription(): Promise<Result<MySubscription, ApiError>>;

  /**
   * Create a Stripe subscription. Folds five flows on the backend (new
   * sub / reinstate / upgrade / downgrade / cycle-change / 3DS), but the
   * mobile contract is a single call — the backend's dispatch precedence
   * decides which path to take based on the authenticated user's most-
   * recent `user_subscriptions` row.
   *
   * M10 extends the M7 contract:
   * - `paymentMethodId` is OPTIONAL on the input. When absent, the
   *   backend requires an existing active subscription (change-of-tier
   *   reuses the customer's default payment method on file). 422 otherwise.
   * - Response carries discriminator fields (`changeType`, `scheduled`,
   *   `effectiveAt`, `isTrial`) so the UI picks the right success-alert
   *   wording without inspecting domain state.
   *
   * Returns the local `subscriptionId` (UUID) + Stripe sub id, plus
   * `requiresAction` as a discriminator. When `requiresAction` is true,
   * mobile presents the `clientSecret` to Stripe's SDK to complete the
   * 3DS challenge; the eventual webhook commits payment_status server-
   * side. When false, `paymentStatus` already reflects the final state.
   *
   * Wraps `POST /subscriptions`. Spec: design.md § POST /subscriptions —
   * extended.
   */
  createSubscription(
    input: CreateSubscriptionInput,
  ): Promise<Result<CreateSubscriptionResult, ApiError>>;

  /**
   * Cancel a subscription either at the end of the billing period
   * (default) or immediately. `subscriptionId` is the local
   * `user_subscriptions.id` UUID, NOT the Stripe `sub_…` id. Backend
   * scopes by both id AND userId — a wrong / missing id returns 404
   * without leaking which.
   *
   * Wraps `POST /subscriptions/:id/cancel`. Unchanged from M7 / PR #70.
   */
  cancelSubscription(
    subscriptionId: string,
    input?: CancelSubscriptionInput,
  ): Promise<Result<CancelSubscriptionResult, ApiError>>;

  // -- Notifications (09) --
  /**
   * List the caller's notifications, newest-first, with keyset (cursor)
   * pagination. Returns the page rows mapped to the domain
   * `Notification` shape, the opaque `nextCursor` for the next (older)
   * page (null when exhausted), and the server-authoritative total
   * `unreadCount` (all unread rows, not just this page).
   *
   * Contract: `GET /notifications?cursor=&limit=&unreadOnly=` (PR #81,
   * realigned offset→cursor in this PR). The adapter maps the wire
   * `AppNotification` (`message` / `isRead` / `data.deepLink`) onto the
   * domain `Notification` (`body` / `readAt` / `deepLink`).
   *
   * Spec: specs/09-notifications-social/design.md § list endpoint.
   */
  getNotifications(
    params?: GetNotificationsParams,
  ): Promise<Result<NotificationsPage, ApiError>>;

  /**
   * Mark a single notification read. Wraps `PATCH /notifications/:id`
   * with body `{ isRead: true }`. Backend uses `COALESCE(read_at, NOW())`
   * so a sync-queue replay preserves the original read moment. Returns
   * the updated row (domain-mapped). 404 → not found / not owned.
   */
  markNotificationRead(id: string): Promise<Result<Notification, ApiError>>;

  /**
   * Mark every unread notification read. Wraps `PATCH /notifications/all`.
   * Returns the count of rows newly flipped (`{ updated }`). Idempotent.
   */
  markAllNotificationsRead(): Promise<Result<{ updated: number }, ApiError>>;

  /**
   * Read the caller's per-type opt-in map. Wraps
   * `GET /notifications/preferences`. The backend applies defaults for
   * missing keys and drops stale keys; the adapter normalises to the
   * known-type-keyed `NotificationPreferences`.
   */
  getNotificationPreferences(): Promise<
    Result<NotificationPreferences, ApiError>
  >;

  /**
   * Merge a partial per-type opt-in map. Wraps
   * `POST /notifications/preferences` — atomic JSONB merge server-side.
   * Returns the FULL merged map (echoed via `RETURNING`, reconciled
   * against defaults) so the client can treat the response as
   * authoritative without a follow-up GET. Sending a key outside the
   * 9-value enum is a 400 — callers must only send known types.
   */
  updateNotificationPreferences(
    partial: NotificationPreferences,
  ): Promise<Result<NotificationPreferences, ApiError>>;

  /**
   * Register this device's push token. Wraps `POST /devices/register`
   * with body `{ deviceToken, platform, deviceInfo? }` (the adapter maps
   * the domain `token` → wire `deviceToken`). Idempotent upsert by
   * `(user_id, device_token)`.
   */
  registerDevice(
    input: RegisterDeviceInput,
  ): Promise<Result<RegisterDeviceResult, ApiError>>;

  // -- Goals --
  getGoals(params?: PaginationParams): Promise<Result<ApiGoal[], ApiError>>;
  getGoal(id: string): Promise<Result<ApiGoal, ApiError>>;
  createGoal(data: CreateGoalInput): Promise<Result<ApiGoal, ApiError>>;
  updateGoal(
    id: string,
    data: Partial<CreateGoalInput>,
  ): Promise<Result<ApiGoal, ApiError>>;
  deleteGoal(id: string): Promise<Result<void, ApiError>>;

  // -- Progress / Home (M4 — 06-progress-goals) --
  /** Aggregate cold-start payload (GET /users/me/home). */
  getHome(): Promise<Result<HomePayload, ApiError>>;
  getTodayRings(): Promise<Result<Rings, ApiError>>;
  /** `window` is an `Nd` string (default 7d). */
  getWeeklyVolume(window?: string): Promise<Result<WeeklyVolume, ApiError>>;
  /** `window` ∈ month|quarter|year|lifetime (default month). */
  getVolumeStats(window?: string): Promise<Result<VolumeStats, ApiError>>;
  getRecentPRs(limit?: number): Promise<Result<PersonalRecord[], ApiError>>;
  getBodyTrend(window?: string): Promise<Result<BodyTrendPoint[], ApiError>>;
  getAchievements(): Promise<Result<Achievement[], ApiError>>;
  /** Active streak rows for the You/Progress StreakHero. */
  getStreaks(): Promise<Result<Streak[], ApiError>>;
  getHabitCompletions(params?: {
    goalId?: string;
    window?: string;
  }): Promise<Result<HabitCompletion[], ApiError>>;
  /** Fetch the user's habit config (all 5 categories, enabled or defaults). */
  getHabitConfigs(): Promise<Result<HabitConfigEntry[], ApiError>>;
  /** Toggle a habit ON for a day (idempotent POST). */
  createHabitCompletion(
    input: CreateHabitCompletionInput,
  ): Promise<Result<HabitCompletion, ApiError>>;
  /** Toggle a habit OFF for a day (idempotent DELETE). */
  deleteHabitCompletion(
    input: DeleteHabitCompletionInput,
  ): Promise<Result<{ deleted: boolean }, ApiError>>;
  useFreezeToken(streakId: string): Promise<Result<Streak, ApiError>>;
  getMeasurements(
    params?: PaginationParams,
  ): Promise<Result<ApiMeasurement[], ApiError>>;
  logMeasurement(
    input: LogMeasurementInput,
  ): Promise<Result<ApiMeasurement, ApiError>>;

  /**
   * Coach logs a measurement (typically weight) on behalf of a client
   * (`POST /clients/:clientId/measurements`). Server-guarded by an active
   * trainer↔client relationship; stamps `loggedByUserId`. The client's app
   * later writes coach-logged weights into HealthKit (`useHealthWeightSync`).
   */
  logClientWeight(
    clientId: string,
    input: LogMeasurementInput,
  ): Promise<Result<ApiMeasurement, ApiError>>;

  // -- Trainers / Coach You (10-trainer-features) --
  /**
   * Fetch the Coach You aggregate (`GET /trainers/me/overview`). Single
   * `{ data: CoachOverview }` envelope — the adapter unwraps once. Trainer-
   * role-gated server-side (403 for non-trainers). camelCase wire shape ==
   * domain shape, so no field mapping is needed.
   */
  getCoachOverview(): Promise<Result<CoachOverview, ApiError>>;

  /**
   * Fetch the trainer's client roster (`GET /trainers/me/clients`). Single
   * `{ data: TrainerClient[] }` envelope — the adapter unwraps once. Trainer-
   * role-gated server-side (403 for non-trainers). Rows arrive pre-sorted by
   * adherence ascending (null last) and the full roster (active + pending);
   * the Clients screen filters by status client-side. camelCase wire shape ==
   * domain shape, so no field mapping is needed.
   */
  getTrainerClients(): Promise<Result<TrainerClient[], ApiError>>;

  /**
   * List the trainer's pending invitations (`GET /trainers/me/invitations`).
   * `{ data: TrainerInvitation[] }` envelope.
   */
  getInvitations(): Promise<Result<TrainerInvitation[], ApiError>>;

  /**
   * Invite a client by email (`POST /trainers/me/invitations`). On success
   * returns the `InviteClientResult` (action discriminates relationship vs
   * email-invitation). On a domain failure the backend returns
   * `{ code, message }` with code ∈ self_invite (400) | no_slots (403) |
   * exists (409); the adapter surfaces that code on `InviteApiError.inviteCode`
   * so the sheet can map it to the legacy copy without string-matching.
   */
  inviteClient(
    req: InviteClientRequest,
  ): Promise<Result<InviteClientResult, InviteApiError>>;

  /**
   * Cancel a pending invitation (`DELETE /trainers/me/invitations/:id`),
   * ownership-scoped. 404 when not found / not pending / not owned.
   */
  cancelInvitation(id: string): Promise<Result<{ success: true }, ApiError>>;

  // -- Nutrition / Fuel (M9 — 13-nutrition-tracking) --
  //
  // Single `{ data }` envelopes (camelCase wire == domain shape, passthrough —
  // the backend parses numeric→number at its repository boundary). Tier-B AI
  // port methods (recognizePhoto/estimateText/extractRecipePhoto) are NOT in M9.

  /**
   * Fuel-screen aggregate (`GET /nutrition/today?date=`). One round-trip:
   * targets + consumed sum + remainingKcal + entriesBySlot. `date` is the
   * user-local YYYY-MM-DD the screen is showing.
   */
  getFuelToday(date: string): Promise<Result<FuelToday, ApiError>>;

  /** A day's entries (`GET /nutrition/entries?date=`), newest first. */
  getNutritionEntries(
    date: string,
  ): Promise<Result<NutritionEntry[], ApiError>>;

  /**
   * The caller's daily target (`GET /nutrition/targets`). `null` when never
   * set — the screen shows the "set your targets" empty state.
   */
  getNutritionTarget(): Promise<Result<NutritionTarget | null, ApiError>>;

  /** Water cups + goal for a day (`GET /nutrition/water/today?date=`). */
  getWaterToday(date: string): Promise<Result<WaterToday, ApiError>>;

  /** The caller's saved recipes (`GET /recipes`); list omits ingredients. */
  getRecipes(): Promise<Result<Recipe[], ApiError>>;

  /** A single recipe with its ingredients (`GET /recipes/:id`). */
  getRecipe(id: string): Promise<Result<Recipe, ApiError>>;

  /** The caller's saved meal presets (`GET /meals`); list omits items. */
  getMeals(): Promise<Result<Meal[], ApiError>>;

  /** Food search across the library + the caller's customs (`GET /foods?query=`). */
  searchFoods(query: string): Promise<Result<Food[], ApiError>>;

  /**
   * Resolve a barcode to a Food (`POST /nutrition/barcode/resolve`). Cache-
   * first server-side then live Open Food Facts. `err.code === "not_found"`
   * (404 `barcode_not_found`) → the user adds the food manually;
   * `err.status === 503` (`food_db_unavailable`) → OFF was rate-limited/down.
   * Online-only — the hook handles the offline cache-fallback path.
   */
  resolveBarcode(code: string): Promise<Result<Food, ApiError>>;

  /**
   * Log an entry (`POST /nutrition/entries`). When `foodId`/`recipeId`/`mealId`
   * is set the server re-derives the authoritative macros from the referenced
   * row × servings, so the client-supplied macros are advisory (optimistic UI).
   */
  logEntry(input: LogEntryInput): Promise<Result<NutritionEntry, ApiError>>;

  /** Edit an owned entry (`PUT /nutrition/entries/:id`); 404 when not owned. */
  editEntry(
    id: string,
    input: EditEntryInput,
  ): Promise<Result<NutritionEntry, ApiError>>;

  /** Delete an owned entry (`DELETE /nutrition/entries/:id`); 404 when not owned. */
  deleteEntry(id: string): Promise<Result<void, ApiError>>;

  /** Upsert the caller's daily target (`PUT /nutrition/targets`). Self-write. */
  setTargets(
    input: SetTargetsInput,
  ): Promise<Result<NutritionTarget, ApiError>>;

  /**
   * Set the day's water cups (`PATCH /nutrition/water/today`) as an ABSOLUTE
   * value (last-write-wins; the offline queue replays it idempotently — never
   * a delta, per BACKEND_BRIEF § 4).
   */
  setWater(date: string, cups: number): Promise<Result<WaterToday, ApiError>>;

  /** Create a custom food (`POST /foods`) — the manual-add path off a barcode miss. */
  createFood(input: CreateFoodInput): Promise<Result<Food, ApiError>>;

  /**
   * Create a recipe (`POST /recipes`). The server materialises macro totals
   * from the ingredients' linked foods (deterministic, no AI).
   */
  createRecipe(input: CreateRecipeInput): Promise<Result<Recipe, ApiError>>;

  /**
   * Scrape a Schema.org recipe from a URL (`POST /recipes/import`) into a
   * manual-create pre-fill. Online-only (external fetch). `err.status === 422`
   * (`no_recipe_microdata`) → the page had no machine-readable recipe.
   */
  importRecipeUrl(url: string): Promise<Result<ImportedRecipe, ApiError>>;

  /** Save a meal preset (`POST /meals`); server materialises totals from items. */
  createMeal(input: CreateMealInput): Promise<Result<Meal, ApiError>>;

  // -- Client side of the coach↔client handshake (10-trainer-features) --
  /**
   * List the CURRENT user's trainer relationships as a client
   * (`GET /clients/me/relationships?status=`). Powers the Requests screen
   * (`status=pending`) and the You-page "Your trainer" section
   * (`status=active`). Omitting `status` returns pending + active. Single
   * `{ data: ClientTrainerRelationship[] }` envelope; AI self-relationship is
   * excluded server-side. camelCase wire shape == domain shape.
   */
  getClientRelationships(
    status?: ClientRelationshipStatus,
  ): Promise<Result<ClientTrainerRelationship[], ApiError>>;

  /**
   * Accept or decline a pending coach request
   * (`POST /clients/me/relationships/:relationshipId/respond`). Accept flips
   * the relationship to `active` (the backend trigger then notifies the
   * trainer); decline terminates it. 404 when no pending row matches (not
   * owned / already actioned).
   */
  respondToRelationship(
    relationshipId: string,
    action: RelationshipResponseAction,
  ): Promise<Result<RelationshipResponseResult, ApiError>>;
}

/**
 * `ApiError` extended with the structured invite-domain `code` the backend
 * returns on the invite error body. `inviteCode` is undefined for transport /
 * auth errors that don't carry a domain code.
 */
export type InviteApiError = ApiError & {
  inviteCode?: InviteErrorCode;
};

// -- API data shapes (mirror backend response types) --

export type CreateHabitCompletionInput = {
  goalId: string;
  /** ISO date/datetime of the toggled day; defaults to now server-side. */
  date?: string;
  value?: number;
};

export type DeleteHabitCompletionInput = {
  goalId: string;
  date?: string;
};

/** A single habit category from GET /users/me/habits/config. */
export type HabitConfigEntry = {
  category: string;
  enabled: boolean;
  goalId: string | null;
  assignedByCoach: boolean;
  locked: boolean;
  targetValue: number;
  unit: string;
  period: string;
  completionRule: string;
  daysPerWeek: number | null;
  tolerancePct: number | null;
  pending: {
    targetValue?: number;
    daysPerWeek?: number;
    enabled?: boolean;
  } | null;
};

/** Wire shape for body_measurements (decimal columns arrive as strings). */
export type ApiMeasurement = {
  id: string;
  userId: string;
  /** NULL = self-logged; set to the trainer's id when a coach logged it. */
  loggedByUserId: string | null;
  weightKg: string | null;
  bodyFatPercentage: string | null;
  chestCm: string | null;
  waistCm: string | null;
  hipsCm: string | null;
  leftArmCm: string | null;
  rightArmCm: string | null;
  leftThighCm: string | null;
  rightThighCm: string | null;
  notes: string | null;
  measuredAt: string | null;
};

/** POST /measurements body — all optional; the weigh-in sheet sends weight/fat/notes. */
export type LogMeasurementInput = {
  weightKg?: number;
  bodyFatPercentage?: number;
  chestCm?: number;
  waistCm?: number;
  hipsCm?: number;
  leftArmCm?: number;
  rightArmCm?: number;
  leftThighCm?: number;
  rightThighCm?: number;
  notes?: string;
  /**
   * ISO timestamp of when the reading was actually taken. Omitted for
   * interactive weigh-ins (the server stamps NOW); set by the HealthKit→server
   * push so a reading imported days later still lands on the right trend day.
   */
  measuredAt?: string;
};

export type ApiProfile = {
  id: string;
  email: string;
  fullName: string | null;
  role: "user" | "personal_trainer" | "physiotherapist" | "admin";
  fitnessLevel: "beginner" | "intermediate" | "advanced" | "elite" | null;
  /** ISO date string (`YYYY-MM-DD`) or null. Backend accepts this on PATCH
   *  (M0); surfaced on the wire type when Edit Profile started writing it
   *  (08-profile-settings STORY-010). Age is derived client-side, never stored. */
  dateOfBirth?: string | null;
  /** M9: biological-sex input for the Fuel Targets TDEE calculator. Backend
   *  accepts this on PATCH (validated to the three literals + null-to-clear);
   *  null = never set. */
  gender?: "male" | "female" | "other" | null;
  /** M9: height in cm, another TDEE calculator input. Backend has accepted
   *  this on PATCH since M0 (`profiles.height_cm`); added to the wire type
   *  when Edit Profile started writing it. null = never set. */
  heightCm?: number | null;
  /** Independent per-field display-unit preferences — users routinely mix
   *  units (e.g. kg for weight, ft/in for height), so a single combined
   *  metric/imperial toggle can't express the common case. Backend accepts
   *  both on PATCH (`profiles.weight_unit`/`profiles.height_unit`,
   *  migration 20260701120000_split_preferred_units.sql). */
  weightUnit?: "kg" | "lb";
  heightUnit?: "cm" | "ftin";
  avatarUrl: string | null;
  /** M6 PR-4: visibility flag. Backend has accepted this on PATCH from M0;
   *  added to the wire type when Edit Profile started writing it. */
  isProfilePublic?: boolean;
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

/**
 * M7 / M10: request body for `POST /subscriptions`. `useTrial` is
 * required-explicit (no silent default) — caller decides whether to
 * opt into a trial. Backend rejects an attempt to subscribe to "free"
 * with 400.
 *
 * M10: `paymentMethodId` is OPTIONAL. When omitted the backend
 * requires an existing active subscription (change-of-tier path reuses
 * the customer's default payment method on file); 422 otherwise.
 *
 * Note: this is the mobile-side domain shape. The adapter translates
 * to snake_case wire keys (`tier_name`, `billing_cycle`,
 * `payment_method_id`, `use_trial`) before sending.
 */
export type CreateSubscriptionInput = {
  tierName: SubscriptionTierName;
  billingCycle: BillingCycle;
  paymentMethodId?: string;
  useTrial: boolean;
  platform?: "ios" | "android";
  /**
   * Optional client idempotency token (spec 17 / Phase A). One token per
   * Subscribe attempt; the backend uses it as the base for every outbound
   * Stripe call so a transport retry of the same submission can't create a
   * duplicate subscription / charge. Omitting it is safe — the backend falls
   * back to a deterministic server-side key.
   */
  idempotencyKey?: string;
};

/**
 * M7 / M10: optional body for `POST /subscriptions/:id/cancel`. When
 * `cancelImmediately` is `true` the backend cancels via Stripe with
 * proration; otherwise (default) the sub is cancelled at the end of
 * the current billing period and the row stays accessible until then.
 */
export type CancelSubscriptionInput = {
  cancelImmediately?: boolean;
  /**
   * Optional client idempotency token (spec 17 / Phase A). One token per
   * Cancel confirmation; lets a retried cancel dedupe at the gateway.
   * Omitting it is safe — the backend falls back to a deterministic key.
   */
  idempotencyKey?: string;
};

/**
 * M6 PR-3: multipart avatar upload input. `uri` is the local file:// URI
 * returned by expo-image-picker (after resize via expo-image-manipulator).
 * React Native's FormData accepts the `{ uri, name, type }` shape natively
 * — the SST adapter passes it through to `fetch` without re-reading bytes
 * into JS.
 */
export type UploadAvatarInput = {
  uri: string;
  mimeType: string;
  name?: string;
};

// -- Notifications (09) --

/**
 * Wire shape for a notification row, mirroring the backend
 * `AppNotification` projection (notificationRepository.ts). The adapter
 * maps this onto the domain `Notification`:
 *   - `message`        → `body` (`?? ""`)
 *   - `data.deepLink`  → `deepLink` (when a string; else null)
 *   - `isRead`+`readAt`→ `readAt` (null = unread)
 * `type` stays a raw string so an unknown/future enum value flows
 * through to the forward-compatible renderer rather than throwing.
 */
export type ApiNotification = {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string | null;
  data: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
};

/**
 * Wire shape for `GET /notifications` (realigned to keyset pagination in
 * this PR). `rows` is the page, `nextCursor` the opaque next-page token
 * (null when exhausted), `unreadCount` the server-authoritative total.
 */
export type ApiNotificationListResponse = {
  rows: ApiNotification[];
  nextCursor: string | null;
  unreadCount: number;
};

/** Query params for `getNotifications`. */
export type GetNotificationsParams = {
  /** Opaque keyset cursor from a prior page's `nextCursor`. */
  cursor?: string;
  /** Page size; backend clamps to [1, 100] (default 50). */
  limit?: number;
  /** When true, only unread rows are returned. */
  unreadOnly?: boolean;
};

/**
 * Domain input for `registerDevice`. `token` is the Expo device push
 * token; the adapter maps it to the wire `deviceToken` field. `platform`
 * matches the backend union (`web` is accepted server-side though mobile
 * only ever sends ios/android).
 */
export type RegisterDeviceInput = {
  token: string;
  platform: "ios" | "android" | "web";
  deviceInfo?: {
    deviceName?: string;
    osVersion?: string;
    appVersion?: string;
    modelName?: string;
  };
};

export type RegisterDeviceResult = {
  id: string;
  registered: true;
};
