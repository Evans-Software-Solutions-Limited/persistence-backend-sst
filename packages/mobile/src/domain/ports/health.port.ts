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
  /**
   * True when this adapter returns deterministic fake values rather
   * than reading the real OS health store. Surfaces in the UI as a
   * `MOCK` chip on the affected tiles so simulator reviewers can tell
   * fixture data apart from a live read at a glance.
   *
   * Per-spec mock behaviour itself is not changing — only the
   * disclosure. Real adapters (HealthKit on device, Health Connect
   * once it ships) MUST return false; the no-op `StubHealthAdapter`
   * also returns false because its tile state is the explicit
   * "not available" copy, not a fixture value.
   *
   * Spec: specs/07-health-integration/design.md § M1 scope: platform
   *       adapter matrix > Why simulator-mock is M1-critical
   */
  readonly isMock: boolean;
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
  writeBodyWeight(
    weight: number,
    date: Date,
  ): Promise<Result<void, HealthError>>;
  disconnect(): Promise<void>;
}
