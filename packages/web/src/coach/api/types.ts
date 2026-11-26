/**
 * Hand-kept mirrors of the core API shapes the web coach workspace reads
 * (PER-124). The source of truth is the backend; each type names its handler.
 * Deliberately not `eden.ts`: `treaty<CoreApi>` is at the TS2589 ceiling.
 */

// ─── Profile (GET /profile — profiles/get/profilesGetHandler.ts) ────────────

export type ProfileRole =
  | "user"
  | "personal_trainer"
  | "physiotherapist"
  | "admin";

export interface CoachProfile {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: ProfileRole;
}

/** Same set as `TRAINER_ROLES` in coaching/clientProfileRepository.ts. */
export const COACH_ROLES: ReadonlySet<ProfileRole> = new Set([
  "personal_trainer",
  "physiotherapist",
  "admin",
]);

// ─── Roster (GET /trainers/me/clients — trainersClientsListHandler.ts) ──────

export interface RosterClient {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  status: "active" | "pending";
  programLabel: string | null;
  lastSeenAt: string | null;
  relationshipId?: string | null;
  initiatedBy?: "trainer" | "client" | null;
}

export type InviteStatus = "active" | "used" | "expired";

export interface InvitedClientSummary {
  profileId: string;
  displayName: string;
  goal: string | null;
  inviteExpiresAt: string | null;
  inviteStatus: InviteStatus | "not_sent";
  readyCount: number;
}

export interface Roster {
  data: RosterClient[];
  invited: InvitedClientSummary[];
}

// ─── Client profiles (coaching/clientProfilesHandler.ts) ────────────────────

export const SETUP_SECTIONS = [
  "starter_form",
  "repeating_form",
  "programme",
  "nutrition_target",
  "meal_plan",
  "resource",
  "welcome_message",
] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];

export interface SetupItem {
  id?: string;
  refId: string | null;
  config: Record<string, unknown>;
  sortOrder: number;
  materialisedAt?: string | null;
}

export interface Invite {
  code: string;
  link: string;
  expiresAt: string;
  status: InviteStatus;
}

export interface ClientProfile {
  id: string;
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  goal: string | null;
  privateNotes: string | null;
  status: "invited" | "active" | "cancelled" | "ended" | string;
  clientId: string | null;
  relationshipId: string | null;
  acceptedAt: string | null;
  cancelledAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClientProfileDetail extends ClientProfile {
  setup: Partial<Record<SetupSection, SetupItem[]>>;
  invite: Invite | null;
}

export interface NewProfileInput {
  displayName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  goal?: string | null;
  privateNotes?: string | null;
}

export interface AcceptPreview {
  sections: { section: SetupSection; label: string; count: number }[];
  welcomeMessage?: string;
  programmes: { name: string; workouts: number }[];
  plans: { name: string }[];
  forms: { title: string }[];
}

export interface IssuedInvite {
  code: string;
  link: string;
  expiresAt: string;
}

// ─── Forms (coaching/forms/formsHandlers.ts) ────────────────────────────────

export type QuestionType =
  | "short_text"
  | "long_text"
  | "number"
  | "scale"
  | "single_choice"
  | "multiple_choice"
  | "photo"
  | "yes_no"
  | string;

/** "Filled for them" sources (questions.ts `PREFILL_SOURCES`, PER-129). */
export type PrefillSource =
  | "sessions_done"
  | "meal_plan_followed"
  | "steps"
  | "weight"
  | "progress_photos";

export interface FormQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  help?: string;
  detailsIfYes?: boolean;
  prefill?: PrefillSource;
}

export interface CoachForm {
  id: string;
  title: string;
  description: string | null;
  archivedAt: string | null;
  /** Set on a system template (`GET /trainers/me/forms?include=templates`). */
  templateKey?: string | null;
  /** Optimistic-concurrency revision (PATCH `expectedRevision`). */
  revision?: number;
  updatedAt?: string;
  version: {
    id: string;
    version: number;
    questions: FormQuestion[];
    createdAt?: string;
  } | null;
}

export interface FormSchedule {
  id: string;
  formId: string;
  trigger: "on_join" | "once" | "weekly" | "daily" | "on_end" | string;
  audience: "all_clients" | "selected" | string;
  weekday: number | null;
  timeLocal: string | null;
  dueAfterHours: number | null;
  reminders: { afterHours: number }[];
  status: string;
  revision?: number;
  clients?: {
    clientId: string;
    relationshipId: string;
    status: string;
    override: RuleOverride | null;
  }[];
  createdAt?: string;
}

/** A per-client override of a send rule (scheduleRepository.ts `Rule`). */
export interface RuleOverride {
  /** PER-129 (C10j): this client gets it once, weekly or daily instead. */
  trigger?: "once" | "weekly" | "daily" | null;
  weekday?: number | null;
  timeLocal?: string | null;
  dueAfterHours?: number | null;
  reminders?: { afterHours: number }[];
}

export interface NewSchedule {
  formId: string;
  trigger: string;
  audience: "all_clients" | "selected";
  clientIds?: string[];
  weekday?: number | null;
  timeLocal?: string | null;
  dueAfterHours?: number | null;
  reminders?: { afterHours: number }[];
}

export interface SchedulePatch extends Partial<Omit<NewSchedule, "formId">> {
  status?: "active" | "paused" | "stopped";
}

/** `GET /trainers/me/forms/stats` (statsRepository.ts, PER-129). */
export interface FormStatsClient {
  clientId: string;
  name: string | null;
  requestId: string;
  status: "done" | "pending" | "missed";
  late: boolean;
  sentAt: string;
  dueAt: string | null;
  completedAt: string | null;
  remindersSent: number;
  lastReminderAt: string | null;
}

export interface FormStats {
  forms: {
    formId: string;
    reached: number;
    done: number;
    outstanding: number;
    clients: FormStatsClient[];
  }[];
  totals: {
    forms: number;
    repeating: number;
    outstanding: number;
    onTimeRate: number | null;
    onTimeSample: number;
  };
}

export interface ClientFormRule {
  scheduleId: string;
  trigger: string;
  audience: string;
  status: string;
  clientStatus: string | null;
  weekday: number | null;
  timeLocal: string | null;
  dueAfterHours: number | null;
  reminders: { afterHours: number }[];
  override: RuleOverride | null;
}

/** One row of the Check-ins tab's "Sent to …" (C3.3). */
export interface ClientFormEntry {
  form: { id: string; title: string; archivedAt: string | null };
  rule: ClientFormRule | null;
  rules: ClientFormRule[];
  lastDoneAt: string | null;
  lastSentAt: string | null;
  pendingRequestId: string | null;
  state: "done" | "notDoneYet" | "paused";
}

export interface ClientSetupInput {
  status: "active" | "paused" | "excluded";
  override?: RuleOverride | null;
  scheduleId?: string;
}

export interface FormResponse {
  id: string;
  requestId: string;
  formId: string;
  title: string;
  trigger: string;
  periodKey: string;
  sentAt: string;
  submittedAt: string;
  late: boolean;
  answers: Record<string, unknown>;
  reviewedAt: string | null;
  replyText: string | null;
  version: { id: string; version: number; questions: FormQuestion[] };
}

// ─── Meal plans (nutrition/mealPlans/mealPlansHandlers.ts) ──────────────────

export interface Macros {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface MealPlan {
  id: string;
  name: string;
  totals: Macros;
  meals: { id: string; name: string }[];
}

// ─── Settings (coaching/clientSettings.ts) ──────────────────────────────────

export const FEATURE_KEYS = [
  "nutrition",
  "checkIns",
  "photos",
  "habits",
  "messages",
  "resources",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type AlertMode = "default" | "mute" | "everything";

export interface ClientSettings {
  relationshipId: string;
  clientId: string;
  trackTraining: boolean;
  trackCalories: boolean;
  sessionsPerWeek: number | null;
  features: Record<FeatureKey, boolean>;
  alertMode: AlertMode;
  revision: number;
  updatedAt: string | null;
}

export interface SettingsPatch {
  trackTraining?: boolean;
  trackCalories?: boolean;
  sessionsPerWeek?: number | null;
  features?: Partial<Record<FeatureKey, boolean>>;
  alertMode?: AlertMode;
}

// ─── Declaration (coaching/declaration.ts) ──────────────────────────────────

export interface DeclarationStatus {
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
}

// ─── Coach meal plans, full (PER-135; nutrition/mealPlans/*) ────────────────

export type LogSlot = "breakfast" | "lunch" | "snack" | "dinner";

/** One item of a plan as the server returns it (macros = the item's, servings applied). */
export interface PlanItem extends Macros {
  id: string;
  kind: "food" | "recipe" | "meal" | "custom";
  foodId: string | null;
  recipeId: string | null;
  mealId: string | null;
  name: string;
  servings: number;
  sortOrder: number;
  food: {
    name: string;
    brand: string | null;
    servingSize: number;
    servingUnit: string;
    perServing: Macros;
  } | null;
  recipe: {
    name: string;
    photoUrl: string | null;
    servings: number;
    perServing: Macros;
  } | null;
  meal: { name: string; photoUrl: string | null; perServing: Macros } | null;
  custom: ({ name: string } & Macros) | null;
}

export interface PlanMeal {
  id: string;
  name: string;
  logSlot: LogSlot;
  sortOrder: number;
  totals: Macros;
  items: PlanItem[];
}

/** `GET /trainers/me/meal-plans` → `plans[]`, and the plan routes' `data`. */
export interface LibraryPlan {
  id: string;
  ownerId: string;
  name: string;
  notes: string | null;
  source: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  totals: Macros;
  meals: PlanMeal[];
}

/** The body of `POST` / `PUT /trainers/me/meal-plans[/:id]`. */
export interface PlanInput {
  name: string;
  notes?: string | null;
  meals: {
    name: string;
    logSlot: LogSlot;
    sortOrder: number;
    items: {
      foodId?: string;
      recipeId?: string;
      mealId?: string;
      custom?: { name: string } & Macros;
      servings: number;
      sortOrder: number;
    }[];
  }[];
}

export type AssignmentStatus = "sent" | "added" | "dismissed" | "removed";

export interface PlanAssignment {
  id: string;
  planId: string;
  note: string | null;
  status: AssignmentStatus;
  seenRevision: number;
  sentAt: string;
  addedAt: string | null;
  updatedAt: string;
}

/** `GET /trainers/me/clients/:clientId/meal-plans` → `assignments[]`. */
export interface ClientPlanAssignment extends PlanAssignment {
  plan: LibraryPlan;
  updatedSinceSeen: boolean;
  /** Distinct days with food logged from this plan. */
  usedDays: number;
  /** Plan meals (entries) logged from this plan in the last 7 days. */
  loggedThisWeek: number;
}

export interface ClientTarget {
  dailyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  setByUserId: string | null;
}

export interface ClientMealPlans {
  assignments: ClientPlanAssignment[];
  target: ClientTarget | null;
  asOf: string;
}

/** `GET /foods?query=` (macros per serving). */
export interface FoodResult {
  id: string;
  name: string;
  brand: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: number;
  servingUnit: string;
}

/** `GET /recipes` (cards, no ingredients). Totals are for the whole recipe. */
export interface CoachRecipe {
  id: string;
  name: string;
  photoUrl: string | null;
  servings: number;
  source: string;
  sourceUrl: string | null;
  totalKcal: number | null;
  totalProteinG: number | null;
  totalCarbsG: number | null;
  totalFatG: number | null;
}

/** `GET /meals` (cards, no items). */
export interface CoachSavedMeal {
  id: string;
  name: string;
  photoUrl: string | null;
  totalKcal: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
}

/** `GET /trainers/me/clients/:clientId/adherence` → `calories` (PER-114). */
export interface CalorieAdherence {
  from: string;
  to: string;
  daysOnTarget: number;
  daysCounted: number;
  daysNotLogged: number;
}

export interface ClientAdherence {
  asOf: string;
  calories?: CalorieAdherence;
}

/** `POST …/recipes/:recipeId/share`. */
export interface RecipeShare {
  recipeId: string;
  sourceRecipeId: string;
  created: boolean;
}
