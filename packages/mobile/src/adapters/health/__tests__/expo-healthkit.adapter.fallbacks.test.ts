import { ExpoHealthKitAdapter } from "@/adapters/health/expo-healthkit.adapter";

/** Non-Error throws and shape fallbacks: the branches the happy-path suite never reaches. */
function makeHealthKit(overrides: Record<string, unknown> = {}) {
  return {
    isHealthDataAvailable: jest.fn(() => true),
    requestAuthorization: jest.fn(async () => true),
    authorizationStatusFor: jest.fn(() => 2),
    queryStatisticsForQuantity: jest.fn(async () => ({
      sumQuantity: { quantity: 10 },
    })),
    queryStatisticsCollectionForQuantity: jest.fn(
      async () => [] as readonly unknown[],
    ),
    getMostRecentQuantitySample: jest.fn(async () => ({
      quantity: 0.2,
      unit: "%",
      endDate: new Date("2026-04-20T07:00:00Z"),
    })),
    saveQuantitySample: jest.fn(async () => ({})),
    queryCategorySamples: jest.fn(async () => [] as readonly unknown[]),
    saveCategorySample: jest.fn(async () => ({})),
    ...overrides,
  };
}
const throwing = () =>
  jest.fn(async () => {
    // Native bridges can reject with plain values, not Error instances.
    throw "native";
  });
const date = new Date("2026-06-10T08:00:00Z");

describe("ExpoHealthKitAdapter non-Error rejections use the documented fallback messages", () => {
  const cases: [
    string,
    Record<string, unknown>,
    (a: ExpoHealthKitAdapter) => Promise<{ ok: boolean; error?: unknown }>,
    string,
    string,
  ][] = [
    [
      "requestPermissions",
      { requestAuthorization: throwing() },
      (a) => a.requestPermissions(),
      "permission_denied",
      "Permission request failed",
    ],
    [
      "getStepsToday",
      { queryStatisticsForQuantity: throwing() },
      (a) => a.getStepsToday(),
      "read_failed",
      "Failed to read steps",
    ],
    [
      "getStepsLastNDays",
      { queryStatisticsCollectionForQuantity: throwing() },
      (a) => a.getStepsLastNDays(3),
      "read_failed",
      "Failed to read step history",
    ],
    [
      "getActiveCaloriesToday",
      { queryStatisticsForQuantity: throwing() },
      (a) => a.getActiveCaloriesToday(),
      "read_failed",
      "Failed to read active calories",
    ],
    [
      "getBasalCaloriesToday",
      { queryStatisticsForQuantity: throwing() },
      (a) => a.getBasalCaloriesToday(),
      "read_failed",
      "Failed to read basal calories",
    ],
    [
      "getStandTimeTodayMinutes",
      { queryStatisticsForQuantity: throwing() },
      (a) => a.getStandTimeTodayMinutes(),
      "read_failed",
      "Failed to read stand time",
    ],
    [
      "getLatestBodyWeight",
      { getMostRecentQuantitySample: throwing() },
      (a) => a.getLatestBodyWeight(),
      "read_failed",
      "Failed to read body weight",
    ],
    [
      "getHeartRateLatest",
      { getMostRecentQuantitySample: throwing() },
      (a) => a.getHeartRateLatest(),
      "read_failed",
      "Failed to read heart rate",
    ],
    [
      "getLatestBodyFat",
      { getMostRecentQuantitySample: throwing() },
      (a) => a.getLatestBodyFat(),
      "read_failed",
      "Failed to read body fat",
    ],
    [
      "writeBodyWeight",
      { saveQuantitySample: throwing() },
      (a) => a.writeBodyWeight(80, date),
      "write_failed",
      "Failed to write body weight",
    ],
    [
      "writeBodyFat",
      { saveQuantitySample: throwing() },
      (a) => a.writeBodyFat(18, date),
      "write_failed",
      "Failed to write body fat",
    ],
    [
      "getSleepLastNight",
      { queryCategorySamples: throwing() },
      (a) => a.getSleepLastNight(),
      "read_failed",
      "Failed to read sleep",
    ],
    [
      "writeSleep",
      { saveCategorySample: throwing() },
      (a) => a.writeSleep(date, new Date(date.getTime() + 3_600_000)),
      "write_failed",
      "Failed to write sleep",
    ],
  ];

  it.each(cases)("%s", async (_name, overrides, call, code, message) => {
    const adapter = new ExpoHealthKitAdapter(makeHealthKit(overrides) as never);
    const result = await call(adapter);
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({ kind: "health", code, message });
  });
});

describe("ExpoHealthKitAdapter shape fallbacks", () => {
  it("reads 0 active calories when the statistics query returns nothing", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => null),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    await expect(adapter.getActiveCaloriesToday()).resolves.toEqual({
      ok: true,
      value: 0,
    });
  });

  it("normalises every step-history bucket date shape and skips buckets without a sum", async () => {
    const before = Date.now();
    const hk = makeHealthKit({
      queryStatisticsCollectionForQuantity: jest.fn(async () => [
        { startDate: new Date("2026-04-18T00:00:00Z") },
        { startDate: "2026-04-19T00:00:00Z", sumQuantity: { quantity: 1 } },
        {
          endDate: new Date("2026-04-20T00:00:00Z"),
          sumQuantity: { quantity: 2.4 },
        },
        { sumQuantity: { quantity: 3 } },
        { startDate: 1_700_000_000_000, sumQuantity: { quantity: 4 } },
      ]),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getStepsLastNDays(5);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.map((d) => d.steps)).toEqual([1, 2, 3, 4]);
    expect(result.value[0].date).toBe("2026-04-19T00:00:00Z");
    expect(result.value[1].date).toBe("2026-04-20T00:00:00.000Z");
    expect(Date.parse(result.value[2].date)).toBeGreaterThanOrEqual(before);
    expect(result.value[3].date).toBe(
      new Date(1_700_000_000_000).toISOString(),
    );
  });

  it("keeps a string body-fat date and falls back to now for other shapes", async () => {
    const before = Date.now();
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest
        .fn()
        .mockResolvedValueOnce({ quantity: 0.18, endDate: "2026-06-01" })
        .mockResolvedValueOnce({ quantity: 0.2, endDate: 42 }),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    await expect(adapter.getLatestBodyFat()).resolves.toEqual({
      ok: true,
      value: { value: 18, date: "2026-06-01" },
    });
    const fallback = await adapter.getLatestBodyFat();
    if (!fallback.ok || !fallback.value) throw new Error("expected sample");
    expect(fallback.value.value).toBeCloseTo(20);
    expect(Date.parse(fallback.value.date)).toBeGreaterThanOrEqual(before);
  });

  it("skips sleep samples with missing or invalid dates and spans out-of-order samples correctly", async () => {
    const hk = makeHealthKit({
      queryCategorySamples: jest.fn(async () => [
        { value: 1, startDate: undefined, endDate: new Date() },
        { value: 1, startDate: "not a date", endDate: "2026-06-11T01:00:00Z" },
        {
          value: 3,
          startDate: "2026-06-11T02:00:00Z",
          endDate: "2026-06-11T04:00:00Z",
        },
        {
          value: 4,
          startDate: 1_781_132_400_000, // 2026-06-10T23:00:00Z as a number
          endDate: "2026-06-11T01:00:00Z",
        },
      ]),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getSleepLastNight();
    if (!result.ok) throw new Error("expected success");
    expect(result.value?.durationMinutes).toBe(240);
    expect(result.value?.start).toEqual(new Date(1_781_132_400_000));
    expect(result.value?.end).toEqual(new Date("2026-06-11T04:00:00Z"));
  });
});
