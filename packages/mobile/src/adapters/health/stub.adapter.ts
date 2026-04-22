import type {
  HealthPort,
  HealthPermissionStatus,
  HealthWeight,
  HealthError,
} from "@/domain/ports/health.port";
import { fail, type Result } from "@/shared/errors";

const UNAVAILABLE: HealthError = {
  kind: "health",
  code: "unavailable",
  message: "Health integration not yet available",
};

const NOT_DETERMINED: HealthPermissionStatus = {
  steps: "not_determined",
  calories: "not_determined",
  bodyWeight: "not_determined",
  heartRate: "not_determined",
};

/**
 * No-op health adapter. Replaced in milestone 07.
 */
export class StubHealthAdapter implements HealthPort {
  async isAvailable() {
    return false;
  }
  async requestPermissions(): Promise<
    Result<HealthPermissionStatus, HealthError>
  > {
    return fail(UNAVAILABLE);
  }
  async getPermissionStatus() {
    return NOT_DETERMINED;
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
  async disconnect() {}
}
