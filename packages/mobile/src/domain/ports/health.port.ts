import type { Result } from "@/shared/errors";

export type HealthPermissionStatus = {
  steps: "granted" | "denied" | "not_determined";
  calories: "granted" | "denied" | "not_determined";
  bodyWeight: "granted" | "denied" | "not_determined";
  heartRate: "granted" | "denied" | "not_determined";
  /** 20-sleep-quicklog: HKCategoryTypeIdentifierSleepAnalysis auth status. */
  sleep: "granted" | "denied" | "not_determined";
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

/**
 * Last-night sleep duration read from HealthKit's `SleepAnalysis` category
 * samples (20-sleep-quicklog STORY-003). `start`/`end` span the earliest
 * asleep sample's start to the latest asleep sample's end within the query
 * window — an approximation when sleep is fragmented across multiple
 * samples, matching how `durationMinutes` is derived (sum of asleep sample
 * durations, not `end - start`).
 */
export type HealthSleep = {
  durationMinutes: number;
  start: Date;
  end: Date;
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
  /**
   * Last night's sleep duration from HealthKit's `SleepAnalysis` category
   * samples (20-sleep-quicklog STORY-003 AC 3.1), or `null` when no asleep
   * samples exist in the window. `SleepAnalysis` is a HealthKit CATEGORY
   * sample, unlike the quantity reads above — implementations use the
   * category query API. Powers the Sleep quick-log sheet's prefill.
   */
  getSleepLastNight(): Promise<Result<HealthSleep | null, HealthError>>;
  /**
   * Best-effort mirror of a manual sleep log into HealthKit as one "asleep"
   * category sample spanning `start`..`end` (20-sleep-quicklog STORY-003 AC
   * 3.3). Called AFTER the durable backend write is accepted; a failure here
   * must never fail or block the caller's save.
   */
  writeSleep(start: Date, end: Date): Promise<Result<void, HealthError>>;
  disconnect(): Promise<void>;
}
