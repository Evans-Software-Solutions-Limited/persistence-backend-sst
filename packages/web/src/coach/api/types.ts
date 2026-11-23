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

export interface FormQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  required: boolean;
}

export interface CoachForm {
  id: string;
  title: string;
  description: string | null;
  archivedAt: string | null;
  version: { id: string; version: number; questions: FormQuestion[] } | null;
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
}

/** A per-client override of a send rule (scheduleRepository.ts `Rule`). */
export interface RuleOverride {
  weekday?: number | null;
  timeLocal?: string | null;
  dueAfterHours?: number | null;
  reminders?: { afterHours: number }[];
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
