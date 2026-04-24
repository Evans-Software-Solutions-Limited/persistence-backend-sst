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
      queryStatisticsCollectionForQuantity: jest.fn(
        async () => [] as ReadonlyArray<unknown>,
      ),
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
    expect(await adapter.isAvailable()).toBe(true);
    expect(hk.isHealthDataAvailable).toHaveBeenCalled();
  });

  it("reports false when the library throws", async () => {
    const hk = makeHealthKit({
      isHealthDataAvailable: jest.fn(() => {
        throw new Error("boom");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    expect(await adapter.isAvailable()).toBe(false);
  });

  it("requests read + share scopes on permission request (v14 AuthDataTypes shape)", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.requestPermissions();
    expect(result.ok).toBe(true);
    expect(hk.requestAuthorization).toHaveBeenCalledTimes(1);
    // v14 library signature: single `{ toRead, toShare }` object, NOT
    // the v12 positional `(toRead, toWrite)` arrays. Calling the v12
    // shape silently no-ops on device — every subsequent read returns
    // 0. Bug caught on PR #37.
    const call = (hk.requestAuthorization as jest.Mock).mock.calls[0] as [
      { toRead?: readonly string[]; toShare?: readonly string[] },
    ];
    const [authDataTypes] = call;
    expect(authDataTypes.toRead).toContain("HKQuantityTypeIdentifierStepCount");
    expect(authDataTypes.toRead).toContain(
      "HKQuantityTypeIdentifierActiveEnergyBurned",
    );
    expect(authDataTypes.toRead).toContain("HKQuantityTypeIdentifierBodyMass");
    expect(authDataTypes.toRead).toContain("HKQuantityTypeIdentifierHeartRate");
    expect(authDataTypes.toShare).toContain("HKQuantityTypeIdentifierBodyMass");
  });

  it("surfaces permission_denied when requestAuthorization rejects", async () => {
    const hk = makeHealthKit({
      requestAuthorization: jest.fn(async () => {
        throw new Error("nope");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const status = await adapter.getPermissionStatus();
    expect(status.steps).toBe("not_determined");
  });

  it("returns today's step count rounded to an integer", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => ({
        sumQuantity: { quantity: 4812.6 },
      })),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getStepsToday();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(4813);
  });

  it("returns 0 when no step samples are in the window", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => null),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getActiveCaloriesToday();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("read_failed");
  });

  it("reads the latest body weight sample (kg)", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk as never);
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getLatestBodyWeight();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value?.unit).toBe("lbs");
  });

  it("returns null when no body-weight sample exists", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => null),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getHeartRateLatest();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(62);
  });

  it("returns null when no heart rate sample exists", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => null),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
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
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getHeartRateLatest();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("read_failed");
  });

  it("aggregates step history via queryStatisticsCollectionForQuantity", async () => {
    const hk = makeHealthKit({
      queryStatisticsCollectionForQuantity: jest.fn(async () => [
        {
          startDate: new Date("2026-04-18T00:00:00Z"),
          sumQuantity: { quantity: 4200 },
        },
        {
          startDate: new Date("2026-04-19T00:00:00Z"),
          sumQuantity: { quantity: 6100 },
        },
        {
          startDate: new Date("2026-04-20T00:00:00Z"),
          sumQuantity: { quantity: 4812 },
        },
      ]),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getStepsLastNDays(3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    expect(result.value[0].steps).toBe(4200);
    expect(result.value[2].steps).toBe(4812);
    expect(hk.queryStatisticsCollectionForQuantity).toHaveBeenCalledTimes(1);
  });

  it("falls back to empty step-history when the library build lacks collection query", async () => {
    const hk = makeHealthKit({
      queryStatisticsCollectionForQuantity: undefined,
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getStepsLastNDays(7);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("returns empty history for days <= 0", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getStepsLastNDays(0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
    expect(hk.queryStatisticsCollectionForQuantity).not.toHaveBeenCalled();
  });

  it("stubs writeBodyWeight as unavailable in M1", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.writeBodyWeight();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("unavailable");
  });

  it("has a no-op disconnect", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk as never);
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });
});
