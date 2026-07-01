import type { Result } from "@/shared/errors";

export type HealthPermissionStatus = {
  steps: "granted" | "denied" | "not_determined";
  calories: "granted" | "denied" | "not_determined";
  bodyWeight: "granted" | "denied" | "not_determined";
  heartRate: "granted" | "denied" | "not_determined";
};

export type HealthWeight = {
  value: number;
  unit: "kg" | "lbs";
  date: string;
};

/**
 * Body-fat sample as a PERCENTAGE (0..100) plus the sample's end date.
 * The date lets callers compare recency against in-app measurement logs
 * (You-screen merge, HealthKit→server push dedup).
 */
export type HealthBodyFat = {
  value: number;
  date: string;
};

/**
 * Daily step bucket used by the Home tab's StepsTodayTile mini-graph.
 * Mirrors the legacy `twoWeeksSteps` shape (`{ date, steps }`).
 */
export type HealthDailySteps = {
  date: string; // ISO date at local start-of-day
  steps: number;
};

export type HealthError = {
  readonly kind: "health";
  readonly code:
    | "unavailable"
    | "permission_denied"
    | "read_failed"
    | "write_failed";
  readonly message: string;
};

/**
 * Port for health data providers (HealthKit / Health Connect).
 *
 * Spec: specs/07-health-integration/design.md § Architecture,
 *       § M1 scope: platform adapter matrix
 */
export interface HealthPort {
  isAvailable(): Promise<boolean>;
  requestPermissions(): Promise<Result<HealthPermissionStatus, HealthError>>;
  getPermissionStatus(): Promise<HealthPermissionStatus>;
  getStepsToday(): Promise<Result<number, HealthError>>;
  /**
   * Per-day step counts for the last N days (inclusive of today),
   * earliest first. Powers the StepsTodayTile mini-graph — matches
   * legacy `queryStepsTwoWeeks` aggregated to daily buckets.
   */
  getStepsLastNDays(
    days: number,
  ): Promise<Result<readonly HealthDailySteps[], HealthError>>;
  getActiveCaloriesToday(): Promise<Result<number, HealthError>>;
  /**
   * Cumulative basal (resting) energy burn so far today, in kcal. The
   * Home tab's "Resting" ring reads this; legacy mobile rendered 0
   * here because the read path was never wired. Implementations that
   * can't surface this (Android in M1, stub) return 0 — same
   * convention as `getActiveCaloriesToday`.
   */
  getBasalCaloriesToday(): Promise<Result<number, HealthError>>;
  /**
   * Cumulative Apple Stand Time so far today, in minutes. Apple
   * surfaces this on the Activity ring on watchOS / iOS. Android
   * has no analogous metric — implementations return 0 there.
   */
  getStandTimeTodayMinutes(): Promise<Result<number, HealthError>>;
  getLatestBodyWeight(): Promise<Result<HealthWeight | null, HealthError>>;
  /**
   * Most recent heart rate sample in bpm, or null when no samples are
   * available. Read-only in M1 — no M1 UI surfaces this directly, but
   * the read path is implemented for M4 Progress.
   *
   * Spec: specs/07-health-integration/design.md § Architecture,
   *       § M1 scope: platform adapter matrix
   */
  getHeartRateLatest(): Promise<Result<number | null, HealthError>>;
  /**
   * Most recent body-fat sample as a PERCENTAGE (0..100) with its sample
   * date, or null when no samples exist. HealthKit stores body fat as a
   * fraction (0.18 = 18%); the adapter converts to a percentage so callers
   * don't juggle the unit.
   */
  getLatestBodyFat(): Promise<Result<HealthBodyFat | null, HealthError>>;
  writeBodyWeight(
    weight: number,
    date: Date,
  ): Promise<Result<void, HealthError>>;
  /**
   * Write a body-fat sample. `percentage` is 0..100 (e.g. 18 for 18%); the
   * adapter converts to HealthKit's 0..1 fraction.
   */
  writeBodyFat(
    percentage: number,
    date: Date,
  ): Promise<Result<void, HealthError>>;
  disconnect(): Promise<void>;
}
