import { ExpoHealthKitAdapter } from "@/adapters/health/expo-healthkit.adapter";

describe("ExpoHealthKitAdapter", () => {
  function makeHealthKit(overrides: Record<string, unknown> = {}) {
    return {
      isHealthDataAvailable: jest.fn(() => true),
      requestAuthorization: jest.fn(async () => true),
      authorizationStatusFor: jest.fn(() => 2), // authorized
      queryStatisticsForQuantity: jest.fn(async () => ({
        sumQuantity: { quantity: 4812 },
      })),
      getMostRecentQuantitySample: jest.fn(async () => ({
        quantity: 74.5,
        unit: "kg",
        endDate: new Date("2026-04-20T07:00:00Z"),
      })),
      ...overrides,
    };
  }

  it("reports available when the library reports available", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk);
    expect(await adapter.isAvailable()).toBe(true);
    expect(hk.isHealthDataAvailable).toHaveBeenCalled();
  });

  it("reports false when the library throws", async () => {
    const hk = makeHealthKit({
      isHealthDataAvailable: jest.fn(() => {
        throw new Error("boom");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    expect(await adapter.isAvailable()).toBe(false);
  });

  it("requests read + write scopes on permission request", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.requestPermissions();
    expect(result.ok).toBe(true);
    expect(hk.requestAuthorization).toHaveBeenCalledTimes(1);
    const call = (hk.requestAuthorization as jest.Mock).mock.calls[0] as [
      readonly string[],
      readonly string[],
    ];
    const [readScopes, writeScopes] = call;
    expect(readScopes).toContain("HKQuantityTypeIdentifierStepCount");
    expect(readScopes).toContain("HKQuantityTypeIdentifierActiveEnergyBurned");
    expect(readScopes).toContain("HKQuantityTypeIdentifierBodyMass");
    expect(readScopes).toContain("HKQuantityTypeIdentifierHeartRate");
    expect(writeScopes).toContain("HKQuantityTypeIdentifierBodyMass");
  });

  it("surfaces permission_denied when requestAuthorization rejects", async () => {
    const hk = makeHealthKit({
      requestAuthorization: jest.fn(async () => {
        throw new Error("nope");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.requestPermissions();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("permission_denied");
    expect(result.error.message).toBe("nope");
  });

  it("maps authorization status for each tracked identifier", async () => {
    // 0 notDetermined, 1 denied, 2 authorized
    const hk = makeHealthKit({
      authorizationStatusFor: jest.fn((id: string) => {
        if (id === "HKQuantityTypeIdentifierStepCount") return 2;
        if (id === "HKQuantityTypeIdentifierBodyMass") return 1;
        return 0;
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const status = await adapter.getPermissionStatus();
    expect(status.steps).toBe("granted");
    expect(status.bodyWeight).toBe("denied");
    expect(status.calories).toBe("not_determined");
    expect(status.heartRate).toBe("not_determined");
  });

  it("treats a throwing authorizationStatusFor as not_determined", async () => {
    const hk = makeHealthKit({
      authorizationStatusFor: jest.fn(() => {
        throw new Error("boom");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const status = await adapter.getPermissionStatus();
    expect(status.steps).toBe("not_determined");
  });

  it("returns today's step count rounded to an integer", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => ({
        sumQuantity: { quantity: 4812.6 },
      })),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getStepsToday();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(4813);
  });

  it("returns 0 when no step samples are in the window", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => null),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getStepsToday();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(0);
  });

  it("surfaces read_failed when the steps query throws", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => {
        throw new Error("native boom");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getStepsToday();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("read_failed");
    expect(result.error.message).toBe("native boom");
  });

  it("reads today's active calories", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => ({
        sumQuantity: { quantity: 312 },
      })),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getActiveCaloriesToday();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(312);
  });

  it("surfaces read_failed when active-calorie query throws", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getActiveCaloriesToday();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("read_failed");
  });

  it("reads the latest body weight sample (kg)", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getLatestBodyWeight();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).not.toBeNull();
    expect(result.value?.value).toBe(74.5);
    expect(result.value?.unit).toBe("kg");
  });

  it("maps lbs samples correctly", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => ({
        quantity: 164,
        unit: "lbs",
        endDate: "2026-04-20T07:00:00Z",
      })),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getLatestBodyWeight();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value?.unit).toBe("lbs");
  });

  it("returns null when no body-weight sample exists", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => null),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getLatestBodyWeight();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBeNull();
  });

  it("returns a fallback date when endDate is missing", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => ({
        quantity: 80,
      })),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getLatestBodyWeight();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value?.date).toEqual(expect.any(String));
  });

  it("surfaces read_failed when body-weight query throws", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getLatestBodyWeight();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("read_failed");
  });

  it("reads the latest heart rate", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => ({
        quantity: 62.4,
      })),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getHeartRateLatest();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(62);
  });

  it("returns null when no heart rate sample exists", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => null),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getHeartRateLatest();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBeNull();
  });

  it("surfaces read_failed when heart-rate query throws", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.getHeartRateLatest();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("read_failed");
  });

  it("stubs writeBodyWeight as unavailable in M1", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk);
    const result = await adapter.writeBodyWeight();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("unavailable");
  });

  it("has a no-op disconnect", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk);
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });
});
