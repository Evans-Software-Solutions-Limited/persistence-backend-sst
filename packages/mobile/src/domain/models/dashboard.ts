/**
 * Dashboard domain model — the M1 Home-tab aggregation payload.
 *
 * Mirrors `DashboardPayload` from `specs/06-progress-goals/design.md` §
 * Dashboard backend contract. Single-envelope wire shape (GET /dashboard
 * returns `{ data: DashboardPayload }` — the adapter unwraps once).
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard backend contract (M1)
 *       specs/06-progress-goals/requirements.md STORY-007 AC 7.1
 */

import type { RecordType } from "./record";

export type DashboardProfile = {
  id: string;
  fullName: string | null;
  /**
   * First whitespace-delimited token of `fullName` — server-derived so
   * the client doesn't need to parse the name each render. `null` when
   * `fullName` is null.
   */
  firstName: string | null;
  preferredUnits: "metric" | "imperial";
};

export type DashboardSubscription = {
  /** `null` when the user has no active subscription (free tier). */
  tierName: string | null;
  /**
   * Follows the legacy `isFreeTier` rule: no active subscription, tier
   * name `'free'`, or `cancelled` status past the billing period.
   */
  isFreeTier: boolean;
  isTrainerTier: boolean;
  status: "active" | "trialing" | "cancelled" | "past_due" | null;
};

export type DashboardRecentWorkout = {
  id: string;
  name: string | null;
  description: string | null;
  estimatedDurationMinutes: number | null;
  createdBy: string;
  /** True when `assigned_by_type` is set on the source row. */
  isAssigned: boolean;
  assignedByType: "personal_trainer" | "physiotherapist" | null;
};

export type DashboardRecentActivity = {
  workoutSessionId: string;
  workoutId: string | null;
  workoutName: string;
  /** ISO8601 UTC. */
  completedAt: string;
  durationSeconds: number | null;
};

export type DashboardProgress = {
  workoutsThisMonth: number;
  workoutsLastMonth: number;
  /** Consecutive-day streak (algorithm unchanged from pre-M1). */
  streak: number;
  personalRecordsCount: number;
};

export type DashboardPROfTheWeek = {
  exerciseId: string;
  exerciseName: string;
  recordType: RecordType;
  value: number;
  unit: string;
  /** ISO8601 UTC. */
  achievedAt: string;
};

export type DashboardLatestMeasurement = {
  id: string;
  /** Emitted as numeric (not a string) — see AC 7.7. */
  weightKg: number | null;
  /** Emitted as numeric (not a string) — see AC 7.7. */
  bodyFatPercentage: number | null;
  /** ISO8601 UTC. */
  measuredAt: string;
};

/**
 * The single aggregation payload powering the Home tab. Every top-level
 * key is populated on every response — empty collections are `[]`,
 * absent objects are `null`. No partial responses.
 */
export type DashboardPayload = {
  profile: DashboardProfile;
  subscription: DashboardSubscription;
  recentWorkouts: DashboardRecentWorkout[];
  recentActivity: DashboardRecentActivity[];
  progress: DashboardProgress;
  prOfTheWeek: DashboardPROfTheWeek | null;
  latestMeasurement: DashboardLatestMeasurement | null;
};

/**
 * Locally-cached dashboard row. Mirrors the `cached_dashboard` SQLite
 * table: `(user_id, payload JSON, synced_at ISO)`.
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
 *       (M1) > Offline cache
 */
export type CachedDashboard = {
  userId: string;
  payload: DashboardPayload;
  /** ISO timestamp when the payload was last refreshed from the backend. */
  syncedAt: string;
};

/**
 * 5-minute TTL — dashboard data shifts every completed session, so it's
 * tuned tighter than the 24h reference-list cache. Exported from the
 * model so both the query layer and presentation helpers (stale-indicator
 * caption) can read the same constant.
 */
export const DASHBOARD_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Pure staleness check, mirroring `isReferenceListStale`. Used by the
 * query layer and any UI caption that surfaces "last synced N min ago".
 */
export function isDashboardStale(
  cached: CachedDashboard | null,
  now: number = Date.now(),
  staleAfterMs: number = DASHBOARD_STALE_AFTER_MS,
): boolean {
  if (!cached) return true;
  const syncedAt = Date.parse(cached.syncedAt);
  if (Number.isNaN(syncedAt)) return true;
  return now - syncedAt >= staleAfterMs;
}
