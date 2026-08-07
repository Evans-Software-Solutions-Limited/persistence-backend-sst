/**
 * Android Health Connect adapter backed by `react-native-health-connect`.
 *
 * The native module is loaded lazily so iOS/web bundles can import the health
 * adapter factory without evaluating Android-only native symbols. The adapter
 * requests only the data Persistence actually consumes or writes; Play Console
 * declarations must match this list exactly.
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

type HealthConnectModule = typeof import("react-native-health-connect");
type Permission = import("react-native-health-connect").Permission;

const SDK_AVAILABLE = 3;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SLEEP_STAGE_SLEEPING = 2;
const ASLEEP_STAGE_VALUES: ReadonlySet<number> = new Set([2, 4, 5, 6]);

/** Least-privilege read/write contract mirrored in app.json. */
export const HEALTH_CONNECT_PERMISSIONS: readonly Permission[] = [
  { accessType: "read", recordType: "Steps" },
  { accessType: "read", recordType: "ActiveCaloriesBurned" },
  { accessType: "read", recordType: "BasalMetabolicRate" },
  { accessType: "read", recordType: "Weight" },
  { accessType: "write", recordType: "Weight" },
  { accessType: "read", recordType: "BodyFat" },
  { accessType: "write", recordType: "BodyFat" },
  { accessType: "read", recordType: "HeartRate" },
  { accessType: "read", recordType: "SleepSession" },
  { accessType: "write", recordType: "SleepSession" },
] as const;

function loadHealthConnect(): HealthConnectModule {
  /* eslint-disable @typescript-eslint/no-require-imports */
  return require("react-native-health-connect") as HealthConnectModule;
  /* eslint-enable @typescript-eslint/no-require-imports */
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function lastNightWindow(): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  return { start, end };
}

function recentWindow(): { operator: "after"; startTime: string } {
  return {
    operator: "after",
    startTime: new Date(Date.now() - THIRTY_DAYS_MS).toISOString(),
  };
}

function between(start: Date, end: Date) {
  return {
    operator: "between" as const,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

function hasPermission(
  granted: readonly Permission[],
  accessType: Permission["accessType"],
  recordType: Permission["recordType"],
): boolean {
  return granted.some(
    (permission) =>
      permission.accessType === accessType &&
      permission.recordType === recordType,
  );
}

function statusFor(
  granted: readonly Permission[],
  recordType: Permission["recordType"],
): "granted" | "not_determined" {
  return hasPermission(granted, "read", recordType)
    ? "granted"
    : "not_determined";
}

function unavailable(): HealthError {
  return {
    kind: "health",
    code: "unavailable",
    message: "Health Connect is not available on this device",
  };
}

function operationFailure(
  code: "permission_denied" | "read_failed" | "write_failed",
  fallback: string,
  error: unknown,
): HealthError {
  const message = error instanceof Error ? error.message : fallback;
  const permissionDenied = /permission/i.test(message);
  return {
    kind: "health",
    code: permissionDenied ? "permission_denied" : code,
    message,
  };
}

export class HealthConnectAdapter implements HealthPort {
  private readonly injectedModule?: HealthConnectModule;
  private loadedModule?: HealthConnectModule;
  private initialization?: Promise<boolean>;

  constructor(module?: HealthConnectModule) {
    this.injectedModule = module;
  }

  private get native(): HealthConnectModule {
    this.loadedModule ??= this.injectedModule ?? loadHealthConnect();
    return this.loadedModule;
  }

  private async ensureInitialized(): Promise<boolean> {
    this.initialization ??= (async () => {
      try {
        if ((await this.native.getSdkStatus()) !== SDK_AVAILABLE) return false;
        return await this.native.initialize();
      } catch {
        return false;
      }
    })();
    const initialized = await this.initialization;
    // An unavailable/outdated provider can become available after the user
    // follows the Play install/update prompt and returns to the app. Cache
    // success, but always re-check a previous unavailable result.
    if (!initialized) this.initialization = undefined;
    return initialized;
  }

  async isAvailable(): Promise<boolean> {
    return this.ensureInitialized();
  }

  async requestPermissions(): Promise<
    Result<HealthPermissionStatus, HealthError>
  > {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      await this.native.requestPermission([...HEALTH_CONNECT_PERMISSIONS]);
      return ok(await this.getPermissionStatus());
    } catch (error) {
      return fail(
        operationFailure(
          "permission_denied",
          "Health Connect permission request failed",
          error,
        ),
      );
    }
  }

  async getPermissionStatus(): Promise<HealthPermissionStatus> {
    if (!(await this.ensureInitialized())) {
      return {
        steps: "not_determined",
        calories: "not_determined",
        bodyWeight: "not_determined",
        heartRate: "not_determined",
        sleep: "not_determined",
      };
    }
    try {
      const granted = (await this.native.getGrantedPermissions()).filter(
        (permission): permission is Permission =>
          permission.recordType !== "BackgroundAccessPermission",
      );
      return {
        steps: statusFor(granted, "Steps"),
        calories: statusFor(granted, "ActiveCaloriesBurned"),
        bodyWeight: statusFor(granted, "Weight"),
        heartRate: statusFor(granted, "HeartRate"),
        sleep: statusFor(granted, "SleepSession"),
      };
    } catch {
      return {
        steps: "not_determined",
        calories: "not_determined",
        bodyWeight: "not_determined",
        heartRate: "not_determined",
        sleep: "not_determined",
      };
    }
  }

  async getStepsToday(): Promise<Result<number, HealthError>> {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      const result = await this.native.aggregateRecord({
        recordType: "Steps",
        timeRangeFilter: between(startOfToday(), new Date()),
      });
      return ok(Math.round(result.COUNT_TOTAL ?? 0));
    } catch (error) {
      return fail(
        operationFailure("read_failed", "Failed to read steps", error),
      );
    }
  }

  async getStepsLastNDays(
    days: number,
  ): Promise<Result<readonly HealthDailySteps[], HealthError>> {
    if (days <= 0) return ok([]);
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - (days - 1));
      start.setHours(0, 0, 0, 0);
      const groups = await this.native.aggregateGroupByPeriod({
        recordType: "Steps",
        timeRangeFilter: between(start, end),
        timeRangeSlicer: { period: "DAYS", length: 1 },
      });
      return ok(
        groups.map((group) => ({
          date: group.startTime,
          steps: Math.round(group.result.COUNT_TOTAL ?? 0),
        })),
      );
    } catch (error) {
      return fail(
        operationFailure("read_failed", "Failed to read step history", error),
      );
    }
  }

  async getActiveCaloriesToday(): Promise<Result<number, HealthError>> {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      const result = await this.native.aggregateRecord({
        recordType: "ActiveCaloriesBurned",
        timeRangeFilter: between(startOfToday(), new Date()),
      });
      return ok(Math.round(result.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? 0));
    } catch (error) {
      return fail(
        operationFailure(
          "read_failed",
          "Failed to read active calories",
          error,
        ),
      );
    }
  }

  async getBasalCaloriesToday(): Promise<Result<number, HealthError>> {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      const result = await this.native.aggregateRecord({
        recordType: "BasalMetabolicRate",
        timeRangeFilter: between(startOfToday(), new Date()),
      });
      return ok(Math.round(result.BASAL_CALORIES_TOTAL?.inKilocalories ?? 0));
    } catch (error) {
      return fail(
        operationFailure("read_failed", "Failed to read basal calories", error),
      );
    }
  }

  async getStandTimeTodayMinutes(): Promise<Result<number, HealthError>> {
    // Health Connect has no Apple Stand Time equivalent.
    return ok(0);
  }

  async getLatestBodyWeight(): Promise<
    Result<HealthWeight | null, HealthError>
  > {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      const result = await this.native.readRecords("Weight", {
        timeRangeFilter: recentWindow(),
        ascendingOrder: false,
        pageSize: 1,
      });
      const sample = result.records[0];
      if (!sample) return ok(null);
      return ok({
        value: sample.weight.inKilograms,
        unit: "kg",
        date: sample.time,
      });
    } catch (error) {
      return fail(
        operationFailure("read_failed", "Failed to read body weight", error),
      );
    }
  }

  async getHeartRateLatest(): Promise<Result<number | null, HealthError>> {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      const result = await this.native.readRecords("HeartRate", {
        timeRangeFilter: recentWindow(),
        ascendingOrder: false,
        pageSize: 20,
      });
      const latest = result.records
        .flatMap((record) => record.samples)
        .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
      return ok(latest ? Math.round(latest.beatsPerMinute) : null);
    } catch (error) {
      return fail(
        operationFailure("read_failed", "Failed to read heart rate", error),
      );
    }
  }

  async getLatestBodyFat(): Promise<Result<HealthBodyFat | null, HealthError>> {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      const result = await this.native.readRecords("BodyFat", {
        timeRangeFilter: recentWindow(),
        ascendingOrder: false,
        pageSize: 1,
      });
      const sample = result.records[0];
      return ok(
        sample ? { value: sample.percentage, date: sample.time } : null,
      );
    } catch (error) {
      return fail(
        operationFailure("read_failed", "Failed to read body fat", error),
      );
    }
  }

  async writeBodyWeight(
    weight: number,
    date: Date,
  ): Promise<Result<void, HealthError>> {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      await this.native.insertRecords([
        {
          recordType: "Weight",
          time: date.toISOString(),
          weight: { value: weight, unit: "kilograms" },
        },
      ]);
      return ok(undefined);
    } catch (error) {
      return fail(
        operationFailure("write_failed", "Failed to write body weight", error),
      );
    }
  }

  async writeBodyFat(
    percentage: number,
    date: Date,
  ): Promise<Result<void, HealthError>> {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      await this.native.insertRecords([
        { recordType: "BodyFat", time: date.toISOString(), percentage },
      ]);
      return ok(undefined);
    } catch (error) {
      return fail(
        operationFailure("write_failed", "Failed to write body fat", error),
      );
    }
  }

  async getSleepLastNight(): Promise<Result<HealthSleep | null, HealthError>> {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      const { start, end } = lastNightWindow();
      const result = await this.native.readRecords("SleepSession", {
        timeRangeFilter: between(start, end),
        ascendingOrder: true,
        pageSize: 100,
      });
      if (result.records.length === 0) return ok(null);

      let durationMs = 0;
      let earliest: Date | null = null;
      let latest: Date | null = null;
      for (const session of result.records) {
        const asleepStages = (session.stages ?? []).filter((stage) =>
          ASLEEP_STAGE_VALUES.has(stage.stage),
        );
        const intervals =
          asleepStages.length > 0
            ? asleepStages
            : [{ startTime: session.startTime, endTime: session.endTime }];
        for (const interval of intervals) {
          const intervalStart = new Date(interval.startTime);
          const intervalEnd = new Date(interval.endTime);
          if (
            Number.isNaN(intervalStart.getTime()) ||
            Number.isNaN(intervalEnd.getTime()) ||
            intervalEnd <= intervalStart
          ) {
            continue;
          }
          durationMs += intervalEnd.getTime() - intervalStart.getTime();
          if (!earliest || intervalStart < earliest) earliest = intervalStart;
          if (!latest || intervalEnd > latest) latest = intervalEnd;
        }
      }
      if (!earliest || !latest || durationMs === 0) return ok(null);
      return ok({
        durationMinutes: Math.round(durationMs / 60_000),
        start: earliest,
        end: latest,
      });
    } catch (error) {
      return fail(
        operationFailure("read_failed", "Failed to read sleep", error),
      );
    }
  }

  async writeSleep(start: Date, end: Date): Promise<Result<void, HealthError>> {
    if (!(await this.ensureInitialized())) return fail(unavailable());
    try {
      await this.native.insertRecords([
        {
          recordType: "SleepSession",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          stages: [
            {
              startTime: start.toISOString(),
              endTime: end.toISOString(),
              stage: SLEEP_STAGE_SLEEPING,
            },
          ],
          title: "Persistence sleep log",
        },
      ]);
      return ok(undefined);
    } catch (error) {
      return fail(
        operationFailure("write_failed", "Failed to write sleep", error),
      );
    }
  }

  async disconnect(): Promise<void> {
    // Intentionally do not call revokeAllPermissions(): Health Connect does
    // not apply revocation until process restart. Sync stops when permissions
    // are removed in Health Connect settings, which the UI explains.
  }
}
