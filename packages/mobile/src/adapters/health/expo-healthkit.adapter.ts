/**
 * iOS HealthKit adapter backed by `@kingstinct/react-native-healthkit`.
 *
 * M1 scope: read-only adapter powering the dashboard StepsTile and
 * MyProgress active-energy tile. `writeBodyWeight` stays stubbed and
 * lights up in M6 (measurement editor).
 *
 * Spec: specs/07-health-integration/design.md § M1 scope: platform
 *       adapter matrix · requirements.md STORY-007 AC 7.1, 7.6
 */

import type {
  HealthError,
  HealthPermissionStatus,
  HealthPort,
  HealthWeight,
} from "@/domain/ports/health.port";
import { fail, ok, type Result } from "@/shared/errors";

/**
 * Subset of the HealthKit module we consume. Typed loosely (`unknown`)
 * rather than against the library's rich generic types so the adapter
 * remains testable (Jest factory mocks replace the whole module).
 */
type StatisticsQuery = (
  identifier: string,
  statistics: readonly string[],
  options?: { filter?: { startDate: Date; endDate: Date } },
) => Promise<{ sumQuantity?: { quantity?: number } } | null | undefined>;

type MostRecentQuery = (identifier: string) => Promise<
  | {
      quantity?: number;
      unit?: string;
      endDate?: Date | string | number;
      startDate?: Date | string | number;
    }
  | null
  | undefined
>;

/** Matches the library's AuthorizationStatus enum. 0 notDetermined, 1 denied, 2 authorized. */
const AUTH_STATUS_AUTHORIZED = 2;
const AUTH_STATUS_DENIED = 1;

/** HKQuantityTypeIdentifier strings (stable across HealthKit versions). */
const IDENTIFIER = {
  STEPS: "HKQuantityTypeIdentifierStepCount",
  ACTIVE_ENERGY: "HKQuantityTypeIdentifierActiveEnergyBurned",
  BODY_MASS: "HKQuantityTypeIdentifierBodyMass",
  HEART_RATE: "HKQuantityTypeIdentifierHeartRate",
} as const;

/** Type-erased handle to the HealthKit module (lazily imported). */
type HealthKitLike = {
  isHealthDataAvailable: () => boolean;
  requestAuthorization: (
    toRead: readonly string[],
    toWrite: readonly string[],
  ) => Promise<boolean>;
  authorizationStatusFor: (identifier: string) => number;
  queryStatisticsForQuantity: StatisticsQuery;
  getMostRecentQuantitySample: MostRecentQuery;
};

function loadHealthKit(): HealthKitLike {
  /* eslint-disable @typescript-eslint/no-require-imports */
  // Dynamic require keeps non-iOS bundles (web, Android) from pulling
  // native symbols that would throw at module-evaluation time. The
  // selection factory in `adapters/health/index.ts` only instantiates
  // this adapter on real iOS devices, so the require is safe.
  const mod = require("@kingstinct/react-native-healthkit") as HealthKitLike;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return mod;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function mapAuthorizationStatus(
  status: number,
): "granted" | "denied" | "not_determined" {
  if (status === AUTH_STATUS_AUTHORIZED) return "granted";
  if (status === AUTH_STATUS_DENIED) return "denied";
  return "not_determined";
}

function readFailure(message: string): HealthError {
  return { kind: "health", code: "read_failed", message };
}

export class ExpoHealthKitAdapter implements HealthPort {
  private readonly healthkit: HealthKitLike;

  constructor(healthkit?: HealthKitLike) {
    this.healthkit = healthkit ?? loadHealthKit();
  }

  async isAvailable(): Promise<boolean> {
    try {
      return this.healthkit.isHealthDataAvailable();
    } catch {
      return false;
    }
  }

  async requestPermissions(): Promise<
    Result<HealthPermissionStatus, HealthError>
  > {
    try {
      await this.healthkit.requestAuthorization(
        [
          IDENTIFIER.STEPS,
          IDENTIFIER.ACTIVE_ENERGY,
          IDENTIFIER.BODY_MASS,
          IDENTIFIER.HEART_RATE,
        ],
        // Body mass is the only writeable scope M1 requests; writes
        // themselves are stubbed until M6.
        [IDENTIFIER.BODY_MASS],
      );
      return ok(await this.getPermissionStatus());
    } catch (err) {
      return fail<HealthError>({
        kind: "health",
        code: "permission_denied",
        message:
          err instanceof Error ? err.message : "Permission request failed",
      });
    }
  }

  async getPermissionStatus(): Promise<HealthPermissionStatus> {
    const safeStatusFor = (
      identifier: string,
    ): "granted" | "denied" | "not_determined" => {
      try {
        return mapAuthorizationStatus(
          this.healthkit.authorizationStatusFor(identifier),
        );
      } catch {
        return "not_determined";
      }
    };
    return {
      steps: safeStatusFor(IDENTIFIER.STEPS),
      calories: safeStatusFor(IDENTIFIER.ACTIVE_ENERGY),
      bodyWeight: safeStatusFor(IDENTIFIER.BODY_MASS),
      heartRate: safeStatusFor(IDENTIFIER.HEART_RATE),
    };
  }

  async getStepsToday(): Promise<Result<number, HealthError>> {
    try {
      const stats = await this.healthkit.queryStatisticsForQuantity(
        IDENTIFIER.STEPS,
        ["cumulativeSum"],
        { filter: { startDate: startOfToday(), endDate: new Date() } },
      );
      const value = stats?.sumQuantity?.quantity ?? 0;
      return ok(Math.round(value));
    } catch (err) {
      return fail(
        readFailure(
          err instanceof Error ? err.message : "Failed to read steps",
        ),
      );
    }
  }

  async getActiveCaloriesToday(): Promise<Result<number, HealthError>> {
    try {
      const stats = await this.healthkit.queryStatisticsForQuantity(
        IDENTIFIER.ACTIVE_ENERGY,
        ["cumulativeSum"],
        { filter: { startDate: startOfToday(), endDate: new Date() } },
      );
      const value = stats?.sumQuantity?.quantity ?? 0;
      return ok(Math.round(value));
    } catch (err) {
      return fail(
        readFailure(
          err instanceof Error ? err.message : "Failed to read active calories",
        ),
      );
    }
  }

  async getLatestBodyWeight(): Promise<
    Result<HealthWeight | null, HealthError>
  > {
    try {
      const sample = await this.healthkit.getMostRecentQuantitySample(
        IDENTIFIER.BODY_MASS,
      );
      if (!sample || typeof sample.quantity !== "number") return ok(null);
      const rawUnit = typeof sample.unit === "string" ? sample.unit : "kg";
      const unit: "kg" | "lbs" =
        rawUnit.toLowerCase().includes("lb") || rawUnit.toLowerCase() === "lbs"
          ? "lbs"
          : "kg";
      const date =
        sample.endDate instanceof Date
          ? sample.endDate.toISOString()
          : typeof sample.endDate === "string"
            ? sample.endDate
            : new Date().toISOString();
      return ok({ value: sample.quantity, unit, date });
    } catch (err) {
      return fail(
        readFailure(
          err instanceof Error ? err.message : "Failed to read body weight",
        ),
      );
    }
  }

  async getHeartRateLatest(): Promise<Result<number | null, HealthError>> {
    try {
      const sample = await this.healthkit.getMostRecentQuantitySample(
        IDENTIFIER.HEART_RATE,
      );
      if (!sample || typeof sample.quantity !== "number") return ok(null);
      return ok(Math.round(sample.quantity));
    } catch (err) {
      return fail(
        readFailure(
          err instanceof Error ? err.message : "Failed to read heart rate",
        ),
      );
    }
  }

  async writeBodyWeight(): Promise<Result<void, HealthError>> {
    // M1 stub — lights up in M6 when the measurement editor ships.
    return fail<HealthError>({
      kind: "health",
      code: "unavailable",
      message:
        "writeBodyWeight is not implemented in M1 — see specs/07 Phase 6.",
    });
  }

  async disconnect(): Promise<void> {
    // HealthKit permissions are OS-level — there's nothing to revoke
    // client-side. No-op intentionally; STORY-005 (settings disconnect)
    // will clear any cached weight values once that flow exists.
  }
}
