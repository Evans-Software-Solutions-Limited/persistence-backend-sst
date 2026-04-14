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
 * Stub — expanded in milestone 07.
 */
export interface HealthPort {
  isAvailable(): Promise<boolean>;
  requestPermissions(): Promise<Result<HealthPermissionStatus, HealthError>>;
  getPermissionStatus(): Promise<HealthPermissionStatus>;
  getStepsToday(): Promise<Result<number, HealthError>>;
  getActiveCaloriesToday(): Promise<Result<number, HealthError>>;
  getLatestBodyWeight(): Promise<Result<HealthWeight | null, HealthError>>;
  writeBodyWeight(
    weight: number,
    date: Date,
  ): Promise<Result<void, HealthError>>;
  disconnect(): Promise<void>;
}
