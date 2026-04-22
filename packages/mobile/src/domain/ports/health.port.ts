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
