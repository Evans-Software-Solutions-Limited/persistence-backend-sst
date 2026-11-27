/**
 * PER-125 (APP-A2): the coach's invited clients, their set-up and the C3.9
 * client settings, as the iPhone reads them. Mirrors the core API
 * (`coaching/clientProfilesHandler.ts`, `coaching/clientSettings.ts`,
 * `coaching/declaration.ts`; design A D3).
 */

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

export function isSetupSection(value: unknown): value is SetupSection {
  return (
    typeof value === "string" &&
    (SETUP_SECTIONS as readonly string[]).includes(value)
  );
}

/** One set-up item as the API stores it. */
export type SetupItem = {
  id?: string;
  refId: string | null;
  config: Record<string, unknown>;
  sortOrder: number;
  materialisedAt?: string | null;
};

export type InviteStatus = "active" | "used" | "expired";

export type Invite = {
  code: string;
  link: string;
  expiresAt: string;
  status: InviteStatus;
};

export type ClientProfileStatus = "invited" | "active" | "cancelled" | "ended";

export type ClientProfile = {
  id: string;
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  goal: string | null;
  privateNotes: string | null;
  status: ClientProfileStatus | string;
  clientId: string | null;
  relationshipId: string | null;
  acceptedAt: string | null;
  cancelledAt: string | null;
  /** Offline conflict check: sent back as `expectedRevision`. */
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** `GET /trainers/me/client-profiles/:id`: the profile, set-up and code. */
export type ClientProfileDetail = ClientProfile & {
  setup: Partial<Record<SetupSection, SetupItem[]>>;
  invite: Invite | null;
};

/**
 * What the phone caches per profile (`cached_coach_client_profiles`): the
 * detail, plus when the queue last took the server's copy over this phone's
 * edit (a 409), so the screens can say "Updated on another device".
 */
export type CachedClientProfile = ClientProfileDetail & {
  conflictAt?: string | null;
};

export type ProfileFields = {
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  goal: string | null;
  privateNotes: string | null;
};

/** `GET /trainers/me/client-profiles?status=invited`. */
export type ClientProfileList = {
  data: ClientProfile[];
  deletedIds: string[];
  asOf: string;
};

/** `GET …/:id/preview`: what the client sees when they accept (D4). */
export type AcceptPreview = {
  sections: { section: SetupSection; label: string; count: number }[];
  welcomeMessage?: string;
  programmes: { name: string; workouts: number }[];
  plans: { name: string }[];
  forms: { title: string }[];
};

/** `POST …/:id/invite` (online only). */
export type IssuedInvite = {
  code: string;
  link: string;
  expiresAt: string;
};

/** Why an invite action was refused, in the screen's terms. */
export type InviteRefusal =
  | "offline"
  | "declaration_required"
  | "no_seats"
  | "not_editable"
  | "not_found"
  | "failed";

export type CoachDeclarationStatus = {
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
};

// ── C3.9 settings ────────────────────────────────────────────────────────────

export const FEATURE_KEYS = [
  "messages",
  "checkIns",
  "photos",
  "habits",
  "nutrition",
  "resources",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type AlertMode = "default" | "mute" | "everything";

export type ClientSettings = {
  relationshipId: string;
  clientId: string;
  trackTraining: boolean;
  trackCalories: boolean;
  sessionsPerWeek: number | null;
  features: Record<FeatureKey, boolean>;
  alertMode: AlertMode;
  revision: number;
  updatedAt: string | null;
};

export type CachedClientSettings = ClientSettings & {
  conflictAt?: string | null;
};

export type SettingsPatch = {
  trackTraining?: boolean;
  trackCalories?: boolean;
  sessionsPerWeek?: number | null;
  features?: Partial<Record<FeatureKey, boolean>>;
  alertMode?: AlertMode;
};

// ── The coach's library, as the set-up pickers read it ─────────────────────

/** `GET /trainers/me/meal-plans` (one row of `plans`). */
export type SetupMealPlan = {
  id: string;
  name: string;
  totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  meals: { id: string; name: string }[];
};

/** `GET /trainers/me/resources` (one row of `resources`). */
export type SetupResource = {
  id: string;
  kind: "file" | "link" | string;
  title: string;
  mime: string | null;
  bytes: number | null;
  archivedAt: string | null;
};
