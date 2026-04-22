/**
 * iOS-simulator fallback adapter (M1).
 *
 * HealthKit reports `isAvailable: false` on the iOS simulator in
 * practice, so this adapter keeps the dashboard StepsTile populated
 * with deterministic values for smoke-testing and simulator reviews.
 *
 * Deterministic values come straight from
 * `specs/07-health-integration/design.md` § M1 scope (table row "iOS
 * simulator") — DO NOT rotate them; reviewers assert specific numbers.
 *
 * Spec: specs/07-health-integration/design.md § M1 scope: platform
 *       adapter matrix · requirements.md STORY-007 AC 7.2, 7.4
 */

import type {
  HealthError,
  HealthPermissionStatus,
  HealthPort,
  HealthWeight,
} from "@/domain/ports/health.port";
import { ok, type Result } from "@/shared/errors";

const MOCK_PERMISSIONS: HealthPermissionStatus = {
  steps: "granted",
  calories: "granted",
  bodyWeight: "granted",
  heartRate: "granted",
};

/** Matches the parent-spec table. Do not edit without bumping the spec. */
export const SIMULATOR_MOCK_VALUES = {
  stepsToday: 4812,
  activeCaloriesToday: 312,
  latestBodyWeightKg: 74.5,
  heartRateLatestBpm: 62,
} as const;

export class SimulatorMockHealthAdapter implements HealthPort {
  async isAvailable() {
    return true;
  }

  async requestPermissions(): Promise<
    Result<HealthPermissionStatus, HealthError>
  > {
    return ok(MOCK_PERMISSIONS);
  }

  async getPermissionStatus(): Promise<HealthPermissionStatus> {
    return MOCK_PERMISSIONS;
  }

  async getStepsToday(): Promise<Result<number, HealthError>> {
    return ok(SIMULATOR_MOCK_VALUES.stepsToday);
  }

  async getActiveCaloriesToday(): Promise<Result<number, HealthError>> {
    return ok(SIMULATOR_MOCK_VALUES.activeCaloriesToday);
  }

  async getLatestBodyWeight(): Promise<
    Result<HealthWeight | null, HealthError>
  > {
    // Fixed date-of-day so test assertions don't drift across runs.
    const today = new Date();
    today.setHours(7, 0, 0, 0);
    const weight: HealthWeight = {
      value: SIMULATOR_MOCK_VALUES.latestBodyWeightKg,
      unit: "kg",
      date: today.toISOString(),
    };
    return ok(weight);
  }

  async getHeartRateLatest(): Promise<Result<number | null, HealthError>> {
    return ok(SIMULATOR_MOCK_VALUES.heartRateLatestBpm);
  }

  async writeBodyWeight(): Promise<Result<void, HealthError>> {
    // The simulator adapter can pretend writes succeed — there's no
    // backing store to mutate. Real writes still stay unavailable in
    // M1 on device (see `ExpoHealthKitAdapter`).
    return ok(undefined);
  }

  async disconnect(): Promise<void> {
    // No-op — mock has no cached auth to clear.
  }
}
