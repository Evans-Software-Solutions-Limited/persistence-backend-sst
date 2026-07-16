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
        async () => [] as readonly unknown[],
      ),
      getMostRecentQuantitySample: jest.fn(async () => ({
        quantity: 74.5,
        unit: "kg",
        endDate: new Date("2026-04-20T07:00:00Z"),
      })),
      saveQuantitySample: jest.fn(async () => ({})),
      queryCategorySamples: jest.fn(async () => [] as readonly unknown[]),
      saveCategorySample: jest.fn(async () => ({})),
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

  it("requests the full legacy read + write scope set (v14 AuthDataTypes shape)", async () => {
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

    // Read scope mirrors `persistence-mobile/hooks/health/constants.ts`
    // `IOS_READ_HEALTH_DATA_PERMISSIONS` plus `HEART_RATE` (V2-only,
    // for M4 Progress prep). Brad flagged on PR #38 that the prior
    // 4-identifier scope was missing legacy data points.
    const expectedRead = [
      "HKQuantityTypeIdentifierStepCount",
      "HKQuantityTypeIdentifierDistanceWalkingRunning",
      "HKQuantityTypeIdentifierBasalEnergyBurned",
      "HKQuantityTypeIdentifierActiveEnergyBurned",
      "HKQuantityTypeIdentifierAppleExerciseTime",
      "HKQuantityTypeIdentifierAppleStandTime",
      "HKQuantityTypeIdentifierBodyMass",
      "HKQuantityTypeIdentifierBodyFatPercentage",
      "HKQuantityTypeIdentifierHeartRate",
      "HKCategoryTypeIdentifierSleepAnalysis",
    ];
    for (const id of expectedRead) {
      expect(authDataTypes.toRead).toContain(id);
    }

    // Write scope mirrors legacy
    // `IOS_WRITE_HEALTH_DATA_PERMISSIONS`: drops EXERCISE_MINUTES /
    // STAND_TIME (HealthKit treats them as system-derived and rejects
    // the write scope) and HEART_RATE (no V2 write path planned).
    const expectedWrite = [
      "HKQuantityTypeIdentifierStepCount",
      "HKQuantityTypeIdentifierDistanceWalkingRunning",
      "HKQuantityTypeIdentifierBasalEnergyBurned",
      "HKQuantityTypeIdentifierActiveEnergyBurned",
      "HKQuantityTypeIdentifierBodyMass",
      "HKQuantityTypeIdentifierBodyFatPercentage",
      "HKCategoryTypeIdentifierSleepAnalysis",
    ];
    for (const id of expectedWrite) {
      expect(authDataTypes.toShare).toContain(id);
    }
    // Defensive: read-only-on-device identifiers must NOT appear in
    // the write scope. HealthKit will reject the whole request if
    // they do.
    expect(authDataTypes.toShare).not.toContain(
      "HKQuantityTypeIdentifierAppleExerciseTime",
    );
    expect(authDataTypes.toShare).not.toContain(
      "HKQuantityTypeIdentifierAppleStandTime",
    );
    expect(authDataTypes.toShare).not.toContain(
      "HKQuantityTypeIdentifierHeartRate",
    );
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
        if (id === "HKCategoryTypeIdentifierSleepAnalysis") return 2;
        return 0;
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const status = await adapter.getPermissionStatus();
    expect(status.steps).toBe("granted");
    expect(status.bodyWeight).toBe("denied");
    expect(status.calories).toBe("not_determined");
    expect(status.heartRate).toBe("not_determined");
    expect(status.sleep).toBe("granted");
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

  it("bounds the steps query to today via a v14 filter.date predicate", async () => {
    // Regression: @kingstinct/react-native-healthkit@14 nests the date
    // range under `filter.date`. The v12 shape (top-level
    // filter.startDate/endDate) is silently ignored, so the cumulativeSum
    // covers ALL time → lifetime steps (~millions) on the ring. Assert the
    // nested predicate is present and bounded to a single day.
    const query = jest.fn(async () => ({ sumQuantity: { quantity: 1 } }));
    const hk = makeHealthKit({ queryStatisticsForQuantity: query });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    await adapter.getStepsToday();

    expect(query).toHaveBeenCalledTimes(1);
    const [, , options] = query.mock.calls[0] as unknown as [
      string,
      readonly string[],
      { filter?: { date?: { startDate: Date; endDate: Date } } },
    ];
    const date = options?.filter?.date;
    expect(date).toBeDefined();
    expect(date?.startDate).toBeInstanceOf(Date);
    expect(date?.endDate).toBeInstanceOf(Date);
    // start is local midnight; the window is under 24h and non-negative.
    const start = date!.startDate;
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    const spanMs = date!.endDate.getTime() - start.getTime();
    expect(spanMs).toBeGreaterThanOrEqual(0);
    expect(spanMs).toBeLessThan(24 * 60 * 60 * 1000);
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

  it("reads today's basal calories", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => ({
        sumQuantity: { quantity: 1450.4 },
      })),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getBasalCaloriesToday();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(1450);
  });

  it("returns 0 when basal-calorie query returns no sum", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => ({})),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getBasalCaloriesToday();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(0);
  });

  it("surfaces read_failed when basal-calorie query throws", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => {
        throw new Error("basal boom");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getBasalCaloriesToday();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("read_failed");
    expect(result.error.message).toBe("basal boom");
  });

  it("reads today's stand-time minutes", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => ({
        sumQuantity: { quantity: 54.6 },
      })),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getStandTimeTodayMinutes();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(55);
  });

  it("returns 0 when stand-time query returns no sum", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => ({})),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getStandTimeTodayMinutes();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(0);
  });

  it("surfaces read_failed when stand-time query throws", async () => {
    const hk = makeHealthKit({
      queryStatisticsForQuantity: jest.fn(async () => {
        throw new Error("stand boom");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getStandTimeTodayMinutes();
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("read_failed");
    expect(result.error.message).toBe("stand boom");
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
    // Same v14 filter.date shape as the single-stat queries (line above).
    const call = (hk.queryStatisticsCollectionForQuantity as jest.Mock).mock
      .calls[0] as unknown[];
    const options = call[4] as {
      filter?: { date?: { startDate: Date; endDate: Date } };
    };
    expect(options?.filter?.date?.startDate).toBeInstanceOf(Date);
    expect(options?.filter?.date?.endDate).toBeInstanceOf(Date);
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

  it("writeBodyWeight saves a BodyMass sample in kg", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const date = new Date("2026-06-10T08:00:00Z");
    const result = await adapter.writeBodyWeight(80.5, date);
    expect(result.ok).toBe(true);
    expect(hk.saveQuantitySample).toHaveBeenCalledWith(
      "HKQuantityTypeIdentifierBodyMass",
      "kg",
      80.5,
      date,
      date,
    );
  });

  it("writeBodyFat converts a percentage to HealthKit's 0..1 fraction", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const date = new Date("2026-06-10T08:00:00Z");
    const result = await adapter.writeBodyFat(18, date);
    expect(result.ok).toBe(true);
    expect(hk.saveQuantitySample).toHaveBeenCalledWith(
      "HKQuantityTypeIdentifierBodyFatPercentage",
      "%",
      0.18,
      date,
      date,
    );
  });

  it("writeBodyWeight surfaces a write_failed error when the library throws", async () => {
    const hk = makeHealthKit({
      saveQuantitySample: jest.fn(async () => {
        throw new Error("denied");
      }),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.writeBodyWeight(80, new Date());
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("write_failed");
  });

  it("getLatestBodyFat returns the sample as a percentage (fraction × 100) with its date", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => ({
        quantity: 0.182,
        unit: "%",
        endDate: new Date("2026-06-10T08:00:00Z"),
      })),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getLatestBodyFat();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.value).toBeCloseTo(18.2, 5);
    expect(result.value?.date).toBe("2026-06-10T08:00:00.000Z");
  });

  it("getLatestBodyFat returns null when there is no sample", async () => {
    const hk = makeHealthKit({
      getMostRecentQuantitySample: jest.fn(async () => null),
    });
    const adapter = new ExpoHealthKitAdapter(hk as never);
    const result = await adapter.getLatestBodyFat();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it("has a no-op disconnect", async () => {
    const hk = makeHealthKit();
    const adapter = new ExpoHealthKitAdapter(hk as never);
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });

  describe("getSleepLastNight (SleepAnalysis category read)", () => {
    it("sums asleep samples into a duration + spans earliest start to latest end", async () => {
      const hk = makeHealthKit({
        queryCategorySamples: jest.fn(async () => [
          {
            value: 4, // asleepDeep
            startDate: new Date("2026-06-10T23:00:00Z"),
            endDate: new Date("2026-06-11T01:00:00Z"),
          },
          {
            value: 5, // asleepREM
            startDate: new Date("2026-06-11T01:00:00Z"),
            endDate: new Date("2026-06-11T03:30:00Z"),
          },
        ]),
      });
      const adapter = new ExpoHealthKitAdapter(hk as never);
      const result = await adapter.getSleepLastNight();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      expect(result.value?.durationMinutes).toBe(270); // 2h + 2.5h
      expect(result.value?.start).toEqual(new Date("2026-06-10T23:00:00Z"));
      expect(result.value?.end).toEqual(new Date("2026-06-11T03:30:00Z"));
    });

    it("uses the category query API, not the quantity path", async () => {
      const query = jest.fn(async () => []);
      const hk = makeHealthKit({ queryCategorySamples: query });
      const adapter = new ExpoHealthKitAdapter(hk as never);
      await adapter.getSleepLastNight();
      expect(query).toHaveBeenCalledWith(
        "HKCategoryTypeIdentifierSleepAnalysis",
        expect.objectContaining({
          filter: expect.objectContaining({
            date: expect.objectContaining({
              startDate: expect.any(Date),
              endDate: expect.any(Date),
            }),
          }),
        }),
      );
      expect(hk.queryStatisticsForQuantity).not.toHaveBeenCalled();
    });

    it("excludes inBed and awake samples from the duration", async () => {
      const hk = makeHealthKit({
        queryCategorySamples: jest.fn(async () => [
          {
            value: 0, // inBed — not asleep
            startDate: new Date("2026-06-10T22:30:00Z"),
            endDate: new Date("2026-06-10T23:00:00Z"),
          },
          {
            value: 1, // asleep(Unspecified)
            startDate: new Date("2026-06-10T23:00:00Z"),
            endDate: new Date("2026-06-11T06:00:00Z"),
          },
          {
            value: 2, // awake — not asleep
            startDate: new Date("2026-06-11T02:00:00Z"),
            endDate: new Date("2026-06-11T02:10:00Z"),
          },
        ]),
      });
      const adapter = new ExpoHealthKitAdapter(hk as never);
      const result = await adapter.getSleepLastNight();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.durationMinutes).toBe(420); // only the 7h asleep sample
    });

    it("returns null when there are no asleep samples in the window", async () => {
      const hk = makeHealthKit({
        queryCategorySamples: jest.fn(async () => [
          {
            value: 0,
            startDate: new Date("2026-06-10T22:30:00Z"),
            endDate: new Date("2026-06-10T23:00:00Z"),
          },
        ]),
      });
      const adapter = new ExpoHealthKitAdapter(hk as never);
      const result = await adapter.getSleepLastNight();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("returns null when the query returns no samples", async () => {
      const hk = makeHealthKit({
        queryCategorySamples: jest.fn(async () => []),
      });
      const adapter = new ExpoHealthKitAdapter(hk as never);
      const result = await adapter.getSleepLastNight();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("skips a sample with an unparseable date rather than throwing", async () => {
      const hk = makeHealthKit({
        queryCategorySamples: jest.fn(async () => [
          { value: 1, startDate: "not-a-date", endDate: "also-not-a-date" },
          {
            value: 1,
            startDate: new Date("2026-06-10T23:00:00Z"),
            endDate: new Date("2026-06-11T07:00:00Z"),
          },
        ]),
      });
      const adapter = new ExpoHealthKitAdapter(hk as never);
      const result = await adapter.getSleepLastNight();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value?.durationMinutes).toBe(480);
    });

    it("surfaces read_failed when the category query throws", async () => {
      const hk = makeHealthKit({
        queryCategorySamples: jest.fn(async () => {
          throw new Error("category boom");
        }),
      });
      const adapter = new ExpoHealthKitAdapter(hk as never);
      const result = await adapter.getSleepLastNight();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("read_failed");
      expect(result.error.message).toBe("category boom");
    });
  });

  describe("writeSleep (SleepAnalysis category write)", () => {
    it("saves one asleep-unspecified category sample spanning start..end", async () => {
      const hk = makeHealthKit();
      const adapter = new ExpoHealthKitAdapter(hk as never);
      const start = new Date("2026-06-10T23:30:00Z");
      const end = new Date("2026-06-11T07:00:00Z");
      const result = await adapter.writeSleep(start, end);
      expect(result.ok).toBe(true);
      expect(hk.saveCategorySample).toHaveBeenCalledWith(
        "HKCategoryTypeIdentifierSleepAnalysis",
        1,
        start,
        end,
      );
    });

    it("surfaces write_failed when the library throws", async () => {
      const hk = makeHealthKit({
        saveCategorySample: jest.fn(async () => {
          throw new Error("denied");
        }),
      });
      const adapter = new ExpoHealthKitAdapter(hk as never);
      const result = await adapter.writeSleep(new Date(), new Date());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("write_failed");
      expect(result.error.message).toBe("denied");
    });
  });
});
