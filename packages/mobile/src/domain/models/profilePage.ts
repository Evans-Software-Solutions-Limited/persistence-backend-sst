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

export type ProfilePagePreferredUnits = "metric" | "imperial";

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
  heightCm: number | null;
  weightKg: number | null;
  preferredUnits: ProfilePagePreferredUnits;
  isProfilePublic: boolean;
  /** ISO timestamp — drives the "member since" copy. */
  createdAt: string;
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
