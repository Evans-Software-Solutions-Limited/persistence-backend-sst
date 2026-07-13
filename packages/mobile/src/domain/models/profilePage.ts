/**
 * Profile-page domain model — the M6 Profile-tab aggregation payload.
 *
 * Mirrors `ProfilePageData` from the backend repo
 * (`microservices/core/src/application/repositories/profileRepository.ts`)
 * and the contract pinned in
 * `specs/milestones/M6-profile/BACKEND_BRIEF.md`. Single-envelope wire
 * shape (`GET /profile/page` returns `{ data: ProfilePageData }` — the
 * adapter unwraps once).
 *
 * The cache lifecycle mirrors `cachedDashboard` (one row per user, 5-min
 * stale-after TTL). Trainer-side stats are intentionally absent in v1 —
 * the backend brief reserves `trainerStats` as an optional top-level
 * field for M8 so the v1 contract stays back-compat.
 */

export type ProfilePageRole =
  | "user"
  | "personal_trainer"
  | "physiotherapist"
  | "admin";

export type ProfilePageFitnessLevel =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "elite";

/** Weight-display-unit preference (weigh-in sheet's kg/lb toggle). */
export type ProfilePageWeightUnit = "kg" | "lb";
/** Height-display-unit preference (Edit Profile's cm/ft+in toggle).
 *  Independent of `ProfilePageWeightUnit` — users routinely mix units
 *  (e.g. kg for weight, ft/in for height). */
export type ProfilePageHeightUnit = "cm" | "ftin";

/**
 * Biological-sex input for the Fuel Targets TDEE calculator (M9). `male`/
 * `female` are the Mifflin-St Jeor coefficient sets; `other` (a user who
 * declines the binary) uses the midpoint constant. Null = never set.
 */
export type ProfileGender = "male" | "female" | "other";

export type ProfilePageSubscriptionStatus =
  | "active"
  | "trialing"
  | "cancelled"
  | "past_due";

export type ProfilePageProfile = {
  id: string;
  fullName: string | null;
  email: string | null;
  username: string | null;
  avatarUrl: string | null;
  role: ProfilePageRole;
  fitnessLevel: ProfilePageFitnessLevel | null;
  /**
   * ISO date string (`YYYY-MM-DD`) or null. Surfaced verbatim from the
   * `profiles.date_of_birth` column; the UI derives age via
   * `computeAge()` (08-profile-settings STORY-010 — store DOB, derive
   * age, never persist a computed age).
   */
  dateOfBirth: string | null;
  /** Sex for the Fuel Targets TDEE calc (M9); null when never set. */
  gender: ProfileGender | null;
  heightCm: number | null;
  weightKg: number | null;
  weightUnit: ProfilePageWeightUnit;
  heightUnit: ProfilePageHeightUnit;
  isProfilePublic: boolean;
  /** ISO timestamp — drives the "member since" copy. */
  createdAt: string;
  /**
   * Cluster 2b (account-deletion soft-delete): non-null while the account
   * is in its 30-day post-deletion grace period. Drives the
   * `restore-account` gate in `app/_layout.tsx`'s `AuthGate` — a
   * signed-in user whose profile carries a non-null `deletedAt` is routed
   * to `/(app)/restore-account` instead of the normal tabs. Optional (not
   * every backend response predates this field) — treat `undefined` the
   * same as `null`.
   */
  deletedAt?: string | null;
  /**
   * ISO timestamp — the account is permanently purged on this date if not
   * restored. Only meaningful when `deletedAt` is non-null. Optional, same
   * back-compat rationale as `deletedAt`.
   */
  purgeAfter?: string | null;
};

export type ProfilePageSubscription = {
  /** Raw tier name from the DB (e.g. "free", "premium_annual"). */
  tierName: string | null;
  /** Human-readable label (e.g. "Premium Annual"). */
  tierDisplayName: string | null;
  status: ProfilePageSubscriptionStatus | null;
  isFreeTier: boolean;
  isTrainerTier: boolean;
  /** ISO timestamp — null when no tier or unset. */
  expiresAt: string | null;
  /** ISO timestamp — non-null when the user cancelled before expiry. */
  cancelledAt: string | null;
  workoutLimit: number | null;
  isUnlimited: boolean;
};

export type ProfilePageAchievement = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  unlockedAt: string;
};

export type ProfilePageTrainerRef = {
  /** `pt_client_relationships.id` — the relationship row, not the trainer. */
  id: string;
  trainer: {
    id: string;
    fullName: string | null;
    avatarUrl: string | null;
  };
};

/**
 * The single aggregation payload powering the Profile tab. Every
 * top-level key is populated on every response — empty collections are
 * `[]`, absent objects are `null`. No partial responses.
 */
export type ProfilePageData = {
  profile: ProfilePageProfile;
  subscription: ProfilePageSubscription;
  stats: {
    workoutsCompleted: number;
  };
  recentAchievements: ProfilePageAchievement[];
  activeTrainers: ProfilePageTrainerRef[];
  pendingTrainerRequests: ProfilePageTrainerRef[];
};

/**
 * Locally-cached profile-page row. Mirrors the `cached_profile_page`
 * SQLite table: `(user_id, payload JSON, synced_at ISO)`.
 */
export type CachedProfilePage = {
  userId: string;
  payload: ProfilePageData;
  /** ISO timestamp when the payload was last refreshed from the backend. */
  syncedAt: string;
};

/**
 * 5-minute TTL — matches `DASHBOARD_STALE_AFTER_MS`. The Profile tab is
 * lighter-traffic than Home, but the user's subscription / trainer
 * relationships can change at any moment (e.g. a trainer accepts a
 * pending request) and a stale view is hostile.
 */
export const PROFILE_PAGE_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Pure staleness check, mirroring `isDashboardStale`.
 */
export function isProfilePageStale(
  cached: CachedProfilePage | null,
  now: number = Date.now(),
  staleAfterMs: number = PROFILE_PAGE_STALE_AFTER_MS,
): boolean {
  if (!cached) return true;
  const syncedAt = Date.parse(cached.syncedAt);
  if (Number.isNaN(syncedAt)) return true;
  return now - syncedAt >= staleAfterMs;
}
