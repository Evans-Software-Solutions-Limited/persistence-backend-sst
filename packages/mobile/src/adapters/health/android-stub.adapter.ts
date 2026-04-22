/**
 * Android stub adapter (M1).
 *
 * Android M1 ships as "does not crash, renders an empty health tile
 * with 'Not available on Android yet'". A real Health Connect adapter
 * is deferred past M1 (post-M4 candidate).
 *
 * Spec: specs/07-health-integration/design.md § M1 scope: platform
 *       adapter matrix · requirements.md STORY-007 AC 7.3, 7.4
 */

import type {
  HealthError,
  HealthPermissionStatus,
  HealthPort,
  HealthWeight,
} from "@/domain/ports/health.port";
import { fail, ok, type Result } from "@/shared/errors";

const UNAVAILABLE: HealthError = {
  kind: "health",
  code: "unavailable",
  message: "Health Connect is not wired up on Android yet",
};

const DENIED: HealthPermissionStatus = {
  steps: "denied",
  calories: "denied",
  bodyWeight: "denied",
  heartRate: "denied",
};

export class AndroidStubHealthAdapter implements HealthPort {
  async isAvailable() {
    return false;
  }

  async requestPermissions(): Promise<
    Result<HealthPermissionStatus, HealthError>
  > {
    // Per the design matrix: permission request resolves as a no-op
    // success, so the UI's "Connect Health" CTA doesn't error out —
    // it just keeps showing the "Not available yet" state.
    return ok(DENIED);
  }

  async getPermissionStatus(): Promise<HealthPermissionStatus> {
    return DENIED;
  }

  async getStepsToday(): Promise<Result<number, HealthError>> {
    return fail(UNAVAILABLE);
  }

  async getActiveCaloriesToday(): Promise<Result<number, HealthError>> {
    return fail(UNAVAILABLE);
  }

  async getLatestBodyWeight(): Promise<
    Result<HealthWeight | null, HealthError>
  > {
    return fail(UNAVAILABLE);
  }

  async getHeartRateLatest(): Promise<Result<number | null, HealthError>> {
    return fail(UNAVAILABLE);
  }

  async writeBodyWeight(): Promise<Result<void, HealthError>> {
    return fail(UNAVAILABLE);
  }

  async disconnect(): Promise<void> {
    // No-op — no cached auth on the stub.
  }
}
