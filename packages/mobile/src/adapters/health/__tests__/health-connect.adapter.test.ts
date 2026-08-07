import type * as HealthConnect from "react-native-health-connect";
import {
  HEALTH_CONNECT_PERMISSIONS,
  HealthConnectAdapter,
} from "@/adapters/health/health-connect.adapter";

type NativeModule = typeof HealthConnect;

function nativeModule(
  over: Partial<Record<keyof NativeModule, unknown>> = {},
): NativeModule {
  return {
    getSdkStatus: jest.fn(async () => 3),
    initialize: jest.fn(async () => true),
    requestPermission: jest.fn(async (permissions) => permissions),
    getGrantedPermissions: jest.fn(async () => [...HEALTH_CONNECT_PERMISSIONS]),
    aggregateRecord: jest.fn(async (request: { recordType: string }) => {
      if (request.recordType === "Steps") return { COUNT_TOTAL: 8421 };
      if (request.recordType === "ActiveCaloriesBurned") {
        return { ACTIVE_CALORIES_TOTAL: { inKilocalories: 456.4 } };
      }
      return { BASAL_CALORIES_TOTAL: { inKilocalories: 1_702.6 } };
    }),
    aggregateGroupByPeriod: jest.fn(async () => [
      {
        startTime: "2026-08-06T00:00:00.000Z",
        endTime: "2026-08-07T00:00:00.000Z",
        result: { COUNT_TOTAL: 5000 },
      },
    ]),
    readRecords: jest.fn(async (recordType: string) => {
      if (recordType === "Weight") {
        return {
          records: [
            {
              time: "2026-08-07T08:00:00.000Z",
              weight: { inKilograms: 82.5 },
            },
          ],
        };
      }
      if (recordType === "BodyFat") {
        return {
          records: [{ time: "2026-08-07T08:00:00.000Z", percentage: 18.2 }],
        };
      }
      if (recordType === "HeartRate") {
        return {
          records: [
            {
              samples: [
                { time: "2026-08-07T08:00:00.000Z", beatsPerMinute: 62 },
                { time: "2026-08-07T09:00:00.000Z", beatsPerMinute: 71 },
              ],
            },
          ],
        };
      }
      return {
        records: [
          {
            startTime: "2026-08-06T23:00:00.000Z",
            endTime: "2026-08-07T07:00:00.000Z",
            stages: [
              {
                startTime: "2026-08-06T23:30:00.000Z",
                endTime: "2026-08-07T06:30:00.000Z",
                stage: 2,
              },
              {
                startTime: "2026-08-07T06:30:00.000Z",
                endTime: "2026-08-07T07:00:00.000Z",
                stage: 1,
              },
            ],
          },
        ],
      };
    }),
    insertRecords: jest.fn(async () => ["record-id"]),
    ...over,
  } as unknown as NativeModule;
}

describe("HealthConnectAdapter", () => {
  it("initializes Health Connect and requests the least-privilege parity scope", async () => {
    const native = nativeModule();
    const adapter = new HealthConnectAdapter(native);

    expect(await adapter.isAvailable()).toBe(true);
    const result = await adapter.requestPermissions();

    expect(result.ok).toBe(true);
    expect(native.requestPermission).toHaveBeenCalledWith(
      HEALTH_CONNECT_PERMISSIONS,
    );
    if (!result.ok) return;
    expect(result.value).toEqual({
      steps: "granted",
      calories: "granted",
      bodyWeight: "granted",
      heartRate: "granted",
      sleep: "granted",
    });
  });

  it("maps aggregate and latest-record reads into the HealthPort units", async () => {
    const adapter = new HealthConnectAdapter(nativeModule());

    await expect(adapter.getStepsToday()).resolves.toEqual({
      ok: true,
      value: 8421,
    });
    await expect(adapter.getActiveCaloriesToday()).resolves.toEqual({
      ok: true,
      value: 456,
    });
    await expect(adapter.getBasalCaloriesToday()).resolves.toEqual({
      ok: true,
      value: 1703,
    });
    await expect(adapter.getLatestBodyWeight()).resolves.toEqual({
      ok: true,
      value: {
        value: 82.5,
        unit: "kg",
        date: "2026-08-07T08:00:00.000Z",
      },
    });
    await expect(adapter.getLatestBodyFat()).resolves.toEqual({
      ok: true,
      value: { value: 18.2, date: "2026-08-07T08:00:00.000Z" },
    });
    await expect(adapter.getHeartRateLatest()).resolves.toEqual({
      ok: true,
      value: 71,
    });
    await expect(adapter.getStandTimeTodayMinutes()).resolves.toEqual({
      ok: true,
      value: 0,
    });
  });

  it("groups daily steps and excludes awake sleep stages", async () => {
    const adapter = new HealthConnectAdapter(nativeModule());

    const history = await adapter.getStepsLastNDays(7);
    expect(history).toEqual({
      ok: true,
      value: [{ date: "2026-08-06T00:00:00.000Z", steps: 5000 }],
    });

    const sleep = await adapter.getSleepLastNight();
    expect(sleep.ok).toBe(true);
    if (!sleep.ok || sleep.value === null) return;
    expect(sleep.value.durationMinutes).toBe(420);
    expect(sleep.value.start.toISOString()).toBe("2026-08-06T23:30:00.000Z");
    expect(sleep.value.end.toISOString()).toBe("2026-08-07T06:30:00.000Z");
  });

  it("writes weight, body fat and a sleeping session in native units", async () => {
    const native = nativeModule();
    const adapter = new HealthConnectAdapter(native);
    const at = new Date("2026-08-07T08:00:00.000Z");

    await expect(adapter.writeBodyWeight(82.5, at)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(adapter.writeBodyFat(18.2, at)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(
      adapter.writeSleep(
        new Date("2026-08-06T23:00:00.000Z"),
        new Date("2026-08-07T07:00:00.000Z"),
      ),
    ).resolves.toEqual({ ok: true, value: undefined });

    expect(native.insertRecords).toHaveBeenNthCalledWith(1, [
      {
        recordType: "Weight",
        time: at.toISOString(),
        weight: { value: 82.5, unit: "kilograms" },
      },
    ]);
    expect(native.insertRecords).toHaveBeenNthCalledWith(2, [
      { recordType: "BodyFat", time: at.toISOString(), percentage: 18.2 },
    ]);
    expect(native.insertRecords).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        expect.objectContaining({ recordType: "SleepSession" }),
      ]),
    );
  });

  it("returns unavailable without requesting data when the SDK is absent", async () => {
    const native = nativeModule({ getSdkStatus: jest.fn(async () => 1) });
    const adapter = new HealthConnectAdapter(native);

    expect(await adapter.isAvailable()).toBe(false);
    for (const operation of [
      () => adapter.getStepsToday(),
      () => adapter.getStepsLastNDays(7),
      () => adapter.getActiveCaloriesToday(),
      () => adapter.getBasalCaloriesToday(),
      () => adapter.getLatestBodyWeight(),
      () => adapter.getHeartRateLatest(),
      () => adapter.getLatestBodyFat(),
      () => adapter.writeBodyWeight(82, new Date()),
      () => adapter.writeBodyFat(18, new Date()),
      () => adapter.getSleepLastNight(),
      () => adapter.writeSleep(new Date(0), new Date(60_000)),
    ]) {
      const result = await operation();
      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "unavailable" }),
      });
    }
    expect(native.aggregateRecord).not.toHaveBeenCalled();
  });

  it("re-checks availability after Health Connect is installed or updated", async () => {
    const getSdkStatus = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValue(3);
    const native = nativeModule({ getSdkStatus });
    const adapter = new HealthConnectAdapter(native);

    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.isAvailable()).resolves.toBe(true);
    await expect(adapter.isAvailable()).resolves.toBe(true);
    expect(getSdkStatus).toHaveBeenCalledTimes(2);
    expect(native.initialize).toHaveBeenCalledTimes(1);
  });

  it("loads the native module lazily and treats native initialization errors as unavailable", async () => {
    await expect(new HealthConnectAdapter().isAvailable()).resolves.toBe(false);

    const native = nativeModule({
      getSdkStatus: jest.fn(async () => {
        throw new Error("native module unavailable");
      }),
    });
    const adapter = new HealthConnectAdapter(native);
    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.requestPermissions()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: "unavailable" }),
    });
    await expect(adapter.getPermissionStatus()).resolves.toEqual({
      steps: "not_determined",
      calories: "not_determined",
      bodyWeight: "not_determined",
      heartRate: "not_determined",
      sleep: "not_determined",
    });
  });

  it("maps partial and failed permission state without over-claiming access", async () => {
    const partial = nativeModule({
      getGrantedPermissions: jest.fn(async () => [
        { accessType: "read", recordType: "Steps" },
        { accessType: "read", recordType: "BackgroundAccessPermission" },
      ]),
    });
    await expect(
      new HealthConnectAdapter(partial).getPermissionStatus(),
    ).resolves.toEqual({
      steps: "granted",
      calories: "not_determined",
      bodyWeight: "not_determined",
      heartRate: "not_determined",
      sleep: "not_determined",
    });

    const failedStatus = nativeModule({
      getGrantedPermissions: jest.fn(async () => {
        throw new Error("provider failed");
      }),
    });
    await expect(
      new HealthConnectAdapter(failedStatus).getPermissionStatus(),
    ).resolves.toEqual({
      steps: "not_determined",
      calories: "not_determined",
      bodyWeight: "not_determined",
      heartRate: "not_determined",
      sleep: "not_determined",
    });

    const denied = nativeModule({
      requestPermission: jest.fn(async () => {
        throw "request rejected";
      }),
    });
    await expect(
      new HealthConnectAdapter(denied).requestPermissions(),
    ).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "permission_denied",
        message: "Health Connect permission request failed",
      }),
    });
  });

  it("returns zero/null for valid empty provider responses and ignores invalid sleep intervals", async () => {
    const empty = nativeModule({
      aggregateRecord: jest.fn(async () => ({})),
      aggregateGroupByPeriod: jest.fn(async () => [
        {
          startTime: "2026-08-07T00:00:00.000Z",
          endTime: "2026-08-08T00:00:00.000Z",
          result: {},
        },
      ]),
      readRecords: jest.fn(async (recordType: string) => {
        if (recordType !== "SleepSession") return { records: [] };
        return {
          records: [
            {
              startTime: "not-a-date",
              endTime: "2026-08-07T07:00:00.000Z",
            },
            {
              startTime: "2026-08-07T07:00:00.000Z",
              endTime: "2026-08-07T06:00:00.000Z",
              stages: [],
            },
          ],
        };
      }),
    });
    const adapter = new HealthConnectAdapter(empty);

    await expect(adapter.getStepsToday()).resolves.toEqual({
      ok: true,
      value: 0,
    });
    await expect(adapter.getStepsLastNDays(0)).resolves.toEqual({
      ok: true,
      value: [],
    });
    await expect(adapter.getStepsLastNDays(1)).resolves.toEqual({
      ok: true,
      value: [{ date: "2026-08-07T00:00:00.000Z", steps: 0 }],
    });
    await expect(adapter.getActiveCaloriesToday()).resolves.toEqual({
      ok: true,
      value: 0,
    });
    await expect(adapter.getBasalCaloriesToday()).resolves.toEqual({
      ok: true,
      value: 0,
    });
    await expect(adapter.getLatestBodyWeight()).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(adapter.getLatestBodyFat()).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(adapter.getHeartRateLatest()).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(adapter.getSleepLastNight()).resolves.toEqual({
      ok: true,
      value: null,
    });
    await expect(adapter.disconnect()).resolves.toBeUndefined();

    const noSleep = nativeModule({
      readRecords: jest.fn(async () => ({ records: [] })),
    });
    await expect(
      new HealthConnectAdapter(noSleep).getSleepLastNight(),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("merges multiple valid sleep intervals regardless of provider order", async () => {
    const native = nativeModule({
      readRecords: jest.fn(async () => ({
        records: [
          {
            startTime: "2026-08-07T01:00:00.000Z",
            endTime: "2026-08-07T02:00:00.000Z",
            stages: [
              {
                startTime: "2026-08-07T01:00:00.000Z",
                endTime: "2026-08-07T02:00:00.000Z",
                stage: 2,
              },
              {
                startTime: "2026-08-06T23:00:00.000Z",
                endTime: "2026-08-07T01:00:00.000Z",
                stage: 4,
              },
              {
                startTime: "2026-08-07T02:00:00.000Z",
                endTime: "2026-08-07T06:00:00.000Z",
                stage: 5,
              },
            ],
          },
        ],
      })),
    });

    const result = await new HealthConnectAdapter(native).getSleepLastNight();
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) return;
    expect(result.value.durationMinutes).toBe(420);
    expect(result.value.start.toISOString()).toBe("2026-08-06T23:00:00.000Z");
    expect(result.value.end.toISOString()).toBe("2026-08-07T06:00:00.000Z");
  });

  it("maps native read and write failures across every HealthPort operation", async () => {
    const readFailure = jest.fn(async () => {
      throw new Error("provider read failed");
    });
    const native = nativeModule({
      aggregateRecord: readFailure,
      aggregateGroupByPeriod: readFailure,
      readRecords: readFailure,
      insertRecords: jest.fn(async () => {
        throw "provider write failed";
      }),
    });
    const adapter = new HealthConnectAdapter(native);

    for (const operation of [
      () => adapter.getStepsToday(),
      () => adapter.getStepsLastNDays(7),
      () => adapter.getActiveCaloriesToday(),
      () => adapter.getBasalCaloriesToday(),
      () => adapter.getLatestBodyWeight(),
      () => adapter.getHeartRateLatest(),
      () => adapter.getLatestBodyFat(),
      () => adapter.getSleepLastNight(),
    ]) {
      const result = await operation();
      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "read_failed" }),
      });
    }

    for (const operation of [
      () => adapter.writeBodyWeight(82, new Date()),
      () => adapter.writeBodyFat(18, new Date()),
      () => adapter.writeSleep(new Date(0), new Date(60_000)),
    ]) {
      const result = await operation();
      expect(result).toEqual({
        ok: false,
        error: expect.objectContaining({ code: "write_failed" }),
      });
    }
  });

  it("classifies provider permission errors from reads", async () => {
    const native = nativeModule({
      aggregateRecord: jest.fn(async () => {
        throw new Error("Permission not granted");
      }),
    });
    await expect(
      new HealthConnectAdapter(native).getStepsToday(),
    ).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: "permission_denied" }),
    });
  });
});
