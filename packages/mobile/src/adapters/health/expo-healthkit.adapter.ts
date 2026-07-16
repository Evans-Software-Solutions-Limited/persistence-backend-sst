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
  HealthBodyFat,
  HealthDailySteps,
  HealthError,
  HealthPermissionStatus,
  HealthPort,
  HealthSleep,
  HealthWeight,
} from "@/domain/ports/health.port";
import { fail, ok, type Result } from "@/shared/errors";

/**
 * Subset of the HealthKit module we consume. Typed loosely (`unknown`)
 * rather than against the library's rich generic types so the adapter
 * remains testable (Jest factory mocks replace the whole module).
 *
 * Matches `@kingstinct/react-native-healthkit@14` API. Key differences
 * from v12 (which the legacy app targets):
 * - `requestAuthorization` takes a single `AuthDataTypes` object with
 *   `{ toShare, toRead }` keys — NOT the legacy positional
 *   `(toRead, toWrite)`. Getting this wrong means no permission sheet
 *   ever fires and every subsequent read returns 0.
 * - `queryStatisticsCollectionForQuantity` powers the step-history
 *   tile graph (legacy used the per-day aggregation for the two-week
 *   trend).
 */
/**
 * v14 `StatisticsQueryOptions.filter` is a `FilterForSamples` — the date
 * range lives under a nested `date` predicate, NOT as top-level
 * `startDate`/`endDate` (that was the v12 shape). Passing the v12 shape
 * leaves the query with no date predicate, so HealthKit returns the
 * `cumulativeSum` over ALL time — i.e. lifetime steps (~millions) instead
 * of today's. This loose type encodes the v14 shape so the call sites
 * can't silently regress to v12. (Brad spotted ~18.5M steps on the ring.)
 */
type DateFilterOptions = {
  filter?: { date?: { startDate: Date; endDate: Date } };
};

type StatisticsQuery = (
  identifier: string,
  statistics: readonly string[],
  options?: DateFilterOptions,
) => Promise<{ sumQuantity?: { quantity?: number } } | null | undefined>;

type StatisticsCollectionQuery = (
  identifier: string,
  statistics: readonly string[],
  anchorDate: Date,
  intervalComponents: { day?: number; hour?: number },
  options?: DateFilterOptions,
) => Promise<
  readonly {
    startDate?: Date | string | number;
    endDate?: Date | string | number;
    sumQuantity?: { quantity?: number };
  }[]
>;

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

type AuthDataTypes = {
  toShare?: readonly string[];
  toRead?: readonly string[];
};

/**
 * v14 `saveQuantitySample(identifier, unit, value, start, end, metadata?)`.
 * Typed loosely here (the library's generic write type is keyed on a
 * writeable-identifier union); the concrete identifiers we pass (BODY_MASS,
 * BODY_FAT_PERCENTAGE) are both in the WRITE scope.
 */
type SaveQuantitySample = (
  identifier: string,
  unit: string,
  value: number,
  start: Date,
  end: Date,
) => Promise<unknown>;

/**
 * `SleepAnalysis` is a HealthKit CATEGORY sample, not a quantity — it has no
 * unit/statistics and is read/written via a distinct API
 * (`queryCategorySamples` / `saveCategorySample`) from `queryStatisticsFor
 * Quantity` / `saveQuantitySample` above. `value` is the raw
 * `CategoryValueSleepAnalysis` numeric enum (0 inBed, 1 asleep(Unspecified),
 * 2 awake, 3 asleepCore, 4 asleepDeep, 5 asleepREM).
 */
type CategorySample = {
  value?: number;
  startDate?: Date | string | number;
  endDate?: Date | string | number;
};

type CategoryQuery = (
  identifier: string,
  options: {
    limit: number;
    ascending?: boolean;
    filter?: { date?: { startDate: Date; endDate: Date } };
  },
) => Promise<readonly CategorySample[]>;

/** v14 `saveCategorySample(identifier, value, start, end, metadata?)`. */
type SaveCategorySample = (
  identifier: string,
  value: number,
  start: Date,
  end: Date,
) => Promise<unknown>;

/** Matches the library's AuthorizationStatus enum. 0 notDetermined, 1 sharingDenied, 2 sharingAuthorized. */
const AUTH_STATUS_AUTHORIZED = 2;
const AUTH_STATUS_DENIED = 1;

/** HKQuantityTypeIdentifier strings (stable across HealthKit versions). */
const IDENTIFIER = {
  STEPS: "HKQuantityTypeIdentifierStepCount",
  STEP_DISTANCE: "HKQuantityTypeIdentifierDistanceWalkingRunning",
  BASAL_ENERGY: "HKQuantityTypeIdentifierBasalEnergyBurned",
  ACTIVE_ENERGY: "HKQuantityTypeIdentifierActiveEnergyBurned",
  EXERCISE_MINUTES: "HKQuantityTypeIdentifierAppleExerciseTime",
  STAND_TIME: "HKQuantityTypeIdentifierAppleStandTime",
  BODY_MASS: "HKQuantityTypeIdentifierBodyMass",
  BODY_FAT_PERCENTAGE: "HKQuantityTypeIdentifierBodyFatPercentage",
  HEART_RATE: "HKQuantityTypeIdentifierHeartRate",
  /** HKCategoryTypeIdentifier (not a quantity) — 20-sleep-quicklog. */
  SLEEP_ANALYSIS: "HKCategoryTypeIdentifierSleepAnalysis",
} as const;

/**
 * `CategoryValueSleepAnalysis` raw enum values (stable HealthKit constants).
 * `asleepUnspecified` and `asleep` share the same raw value (1) across
 * library versions — both are "asleep" for our summing purposes, along with
 * the stage-specific core/deep/REM values. `inBed` (0) and `awake` (2) are
 * explicitly excluded — time in bed but not asleep isn't sleep duration.
 */
const SLEEP_ASLEEP_VALUES: ReadonlySet<number> = new Set([1, 3, 4, 5]);
/** Value written for a manual mirror — "asleep, stage unspecified". */
const SLEEP_VALUE_ASLEEP_UNSPECIFIED = 1;

/**
 * Read-permission scope. Mirrors the legacy app's
 * `IOS_READ_HEALTH_DATA_PERMISSIONS` set in
 * `persistence-mobile/hooks/health/constants.ts` so the iOS HealthKit
 * sheet asks for the same data points the user is used to seeing.
 *
 * V2 keeps `HEART_RATE` on top of legacy because the read path is
 * already wired for M4 Progress. Adding read-only identifiers is
 * cheap — Apple doesn't surface unused scopes anywhere outside the
 * grant sheet, and the user only sees a single combined dialog.
 */
const READ_IDENTIFIERS: readonly string[] = [
  IDENTIFIER.STEPS,
  IDENTIFIER.STEP_DISTANCE,
  IDENTIFIER.BASAL_ENERGY,
  IDENTIFIER.ACTIVE_ENERGY,
  IDENTIFIER.EXERCISE_MINUTES,
  IDENTIFIER.STAND_TIME,
  IDENTIFIER.BODY_MASS,
  IDENTIFIER.BODY_FAT_PERCENTAGE,
  IDENTIFIER.HEART_RATE,
  IDENTIFIER.SLEEP_ANALYSIS,
];

/**
 * Write-permission scope. Mirrors the legacy app's
 * `IOS_WRITE_HEALTH_DATA_PERMISSIONS` set — drops EXERCISE_MINUTES
 * and STAND_TIME because HealthKit treats those as system-derived
 * categories and rejects the write scope.
 *
 * Heart rate writes are not requested. M1 ships with all writes
 * stubbed (`writeBodyWeight` returns `unavailable`); the scope is
 * pre-requested so M6 doesn't need a second permission prompt.
 */
const WRITE_IDENTIFIERS: readonly string[] = [
  IDENTIFIER.STEPS,
  IDENTIFIER.STEP_DISTANCE,
  IDENTIFIER.BASAL_ENERGY,
  IDENTIFIER.ACTIVE_ENERGY,
  IDENTIFIER.BODY_MASS,
  IDENTIFIER.BODY_FAT_PERCENTAGE,
  IDENTIFIER.SLEEP_ANALYSIS,
];

/** Type-erased handle to the HealthKit module (lazily imported). */
type HealthKitLike = {
  isHealthDataAvailable: () => boolean;
  requestAuthorization: (toRequest: AuthDataTypes) => Promise<boolean>;
  authorizationStatusFor: (identifier: string) => number;
  queryStatisticsForQuantity: StatisticsQuery;
  queryStatisticsCollectionForQuantity?: StatisticsCollectionQuery;
  getMostRecentQuantitySample: MostRecentQuery;
  saveQuantitySample: SaveQuantitySample;
  queryCategorySamples: CategoryQuery;
  saveCategorySample: SaveCategorySample;
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

/**
 * A 24h window from yesterday-noon to today-noon, local time — wide enough
 * to contain any typical bedtime→wake sleep session regardless of what hour
 * the user went to bed, without pulling in the PRIOR night's sleep too
 * (which an "any time before now" window would risk once past midnight).
 */
function lastNightWindow(): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  return { start, end };
}

function toDateOrNull(value: Date | string | number | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
      // v14 signature: single AuthDataTypes object. Passing two
      // positional arrays (the v12 shape) silently no-ops on device —
      // no permission sheet, no errors, every subsequent read returns
      // 0. This was the bug Brad spotted on PR #37.
      //
      // Read + write scopes mirror the legacy app's permission set
      // (see `persistence-mobile/hooks/health/constants.ts`). Brad
      // flagged on PR #38 that the M1-narrow scope (steps / active
      // energy / body mass / heart rate) was missing legacy data
      // points — this aligns the grant sheet to legacy parity.
      await this.healthkit.requestAuthorization({
        toRead: READ_IDENTIFIERS,
        toShare: WRITE_IDENTIFIERS,
      });
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
      sleep: safeStatusFor(IDENTIFIER.SLEEP_ANALYSIS),
    };
  }

  async getStepsToday(): Promise<Result<number, HealthError>> {
    try {
      const stats = await this.healthkit.queryStatisticsForQuantity(
        IDENTIFIER.STEPS,
        ["cumulativeSum"],
        {
          filter: { date: { startDate: startOfToday(), endDate: new Date() } },
        },
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

  async getStepsLastNDays(
    days: number,
  ): Promise<Result<readonly HealthDailySteps[], HealthError>> {
    if (days <= 0) return ok([]);
    const collection = this.healthkit.queryStatisticsCollectionForQuantity;
    if (!collection) {
      // Older library build — fall back to an empty history rather
      // than throwing. Today's value still comes from getStepsToday.
      return ok([]);
    }
    try {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(end.getDate() - (days - 1));
      start.setHours(0, 0, 0, 0);

      const buckets = await collection(
        IDENTIFIER.STEPS,
        ["cumulativeSum"],
        start,
        { day: 1 },
        { filter: { date: { startDate: start, endDate: end } } },
      );

      const out: HealthDailySteps[] = [];
      for (const bucket of buckets) {
        const stepsValue = bucket.sumQuantity?.quantity;
        if (typeof stepsValue !== "number") continue;
        const rawDate = bucket.startDate ?? bucket.endDate;
        const date =
          rawDate instanceof Date
            ? rawDate.toISOString()
            : typeof rawDate === "string"
              ? rawDate
              : new Date(rawDate ?? Date.now()).toISOString();
        out.push({ date, steps: Math.round(stepsValue) });
      }
      return ok(out);
    } catch (err) {
      return fail(
        readFailure(
          err instanceof Error ? err.message : "Failed to read step history",
        ),
      );
    }
  }

  async getActiveCaloriesToday(): Promise<Result<number, HealthError>> {
    try {
      const stats = await this.healthkit.queryStatisticsForQuantity(
        IDENTIFIER.ACTIVE_ENERGY,
        ["cumulativeSum"],
        {
          filter: { date: { startDate: startOfToday(), endDate: new Date() } },
        },
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

  async getBasalCaloriesToday(): Promise<Result<number, HealthError>> {
    try {
      const stats = await this.healthkit.queryStatisticsForQuantity(
        IDENTIFIER.BASAL_ENERGY,
        ["cumulativeSum"],
        {
          filter: { date: { startDate: startOfToday(), endDate: new Date() } },
        },
      );
      const value = stats?.sumQuantity?.quantity ?? 0;
      return ok(Math.round(value));
    } catch (err) {
      return fail(
        readFailure(
          err instanceof Error ? err.message : "Failed to read basal calories",
        ),
      );
    }
  }

  async getStandTimeTodayMinutes(): Promise<Result<number, HealthError>> {
    try {
      const stats = await this.healthkit.queryStatisticsForQuantity(
        IDENTIFIER.STAND_TIME,
        ["cumulativeSum"],
        {
          filter: { date: { startDate: startOfToday(), endDate: new Date() } },
        },
      );
      // HKQuantityTypeIdentifierAppleStandTime is stored in minutes;
      // the underlying library normalises the cumulativeSum to the
      // identifier's default unit, so `.quantity` here is already in
      // minutes. Round to keep the wire shape clean.
      const value = stats?.sumQuantity?.quantity ?? 0;
      return ok(Math.round(value));
    } catch (err) {
      return fail(
        readFailure(
          err instanceof Error ? err.message : "Failed to read stand time",
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

  async getLatestBodyFat(): Promise<Result<HealthBodyFat | null, HealthError>> {
    try {
      const sample = await this.healthkit.getMostRecentQuantitySample(
        IDENTIFIER.BODY_FAT_PERCENTAGE,
      );
      if (!sample || typeof sample.quantity !== "number") return ok(null);
      const date =
        sample.endDate instanceof Date
          ? sample.endDate.toISOString()
          : typeof sample.endDate === "string"
            ? sample.endDate
            : new Date().toISOString();
      // HealthKit stores body fat as a fraction (0.18 = 18%). Surface a
      // percentage so the UI + the measurements API speak the same unit.
      return ok({ value: sample.quantity * 100, date });
    } catch (err) {
      return fail(
        readFailure(
          err instanceof Error ? err.message : "Failed to read body fat",
        ),
      );
    }
  }

  async writeBodyWeight(
    weight: number,
    date: Date,
  ): Promise<Result<void, HealthError>> {
    try {
      await this.healthkit.saveQuantitySample(
        IDENTIFIER.BODY_MASS,
        "kg",
        weight,
        date,
        date,
      );
      return ok(undefined);
    } catch (err) {
      return fail<HealthError>({
        kind: "health",
        code: "write_failed",
        message:
          err instanceof Error ? err.message : "Failed to write body weight",
      });
    }
  }

  async writeBodyFat(
    percentage: number,
    date: Date,
  ): Promise<Result<void, HealthError>> {
    try {
      // HealthKit's percent unit is a 0..1 fraction — convert from 0..100.
      await this.healthkit.saveQuantitySample(
        IDENTIFIER.BODY_FAT_PERCENTAGE,
        "%",
        percentage / 100,
        date,
        date,
      );
      return ok(undefined);
    } catch (err) {
      return fail<HealthError>({
        kind: "health",
        code: "write_failed",
        message:
          err instanceof Error ? err.message : "Failed to write body fat",
      });
    }
  }

  /**
   * Sum "asleep" `SleepAnalysis` category samples overlapping last night's
   * window (20-sleep-quicklog STORY-003 AC 3.1). Uses the category query API
   * — NOT `queryStatisticsForQuantity` — because sleep is a category sample,
   * not a quantity (no unit, no cumulativeSum). `inBed`/`awake` samples are
   * excluded; only asleep(-stage) samples count toward the duration.
   * `start`/`end` span the earliest-to-latest asleep sample in the window —
   * an approximation when sleep is fragmented, consistent with summing
   * durations rather than treating the samples as one contiguous block.
   */
  async getSleepLastNight(): Promise<Result<HealthSleep | null, HealthError>> {
    try {
      const { start, end } = lastNightWindow();
      const samples = await this.healthkit.queryCategorySamples(
        IDENTIFIER.SLEEP_ANALYSIS,
        { limit: 0, filter: { date: { startDate: start, endDate: end } } },
      );

      let durationMs = 0;
      let earliestStart: Date | null = null;
      let latestEnd: Date | null = null;
      for (const sample of samples) {
        if (sample.value == null || !SLEEP_ASLEEP_VALUES.has(sample.value)) {
          continue;
        }
        const sampleStart = toDateOrNull(sample.startDate);
        const sampleEnd = toDateOrNull(sample.endDate);
        if (!sampleStart || !sampleEnd) continue;
        durationMs += sampleEnd.getTime() - sampleStart.getTime();
        if (!earliestStart || sampleStart < earliestStart) {
          earliestStart = sampleStart;
        }
        if (!latestEnd || sampleEnd > latestEnd) latestEnd = sampleEnd;
      }

      if (durationMs <= 0 || !earliestStart || !latestEnd) return ok(null);
      return ok({
        durationMinutes: Math.round(durationMs / 60_000),
        start: earliestStart,
        end: latestEnd,
      });
    } catch (err) {
      return fail(
        readFailure(
          err instanceof Error ? err.message : "Failed to read sleep",
        ),
      );
    }
  }

  /**
   * Write one "asleep, stage unspecified" `SleepAnalysis` category sample
   * spanning `start`..`end` — the best-effort mirror of a manual quick-log
   * entry (20-sleep-quicklog STORY-003 AC 3.3). Uses `saveCategorySample`,
   * not `saveQuantitySample` (sleep has no unit/value scale).
   */
  async writeSleep(start: Date, end: Date): Promise<Result<void, HealthError>> {
    try {
      await this.healthkit.saveCategorySample(
        IDENTIFIER.SLEEP_ANALYSIS,
        SLEEP_VALUE_ASLEEP_UNSPECIFIED,
        start,
        end,
      );
      return ok(undefined);
    } catch (err) {
      return fail<HealthError>({
        kind: "health",
        code: "write_failed",
        message: err instanceof Error ? err.message : "Failed to write sleep",
      });
    }
  }

  async disconnect(): Promise<void> {
    // HealthKit permissions are OS-level — there's nothing to revoke
    // client-side. No-op intentionally; STORY-005 (settings disconnect)
    // will clear any cached weight values once that flow exists.
  }
}
