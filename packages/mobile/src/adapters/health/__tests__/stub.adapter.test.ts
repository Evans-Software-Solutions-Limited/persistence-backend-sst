import { StubHealthAdapter } from "../stub.adapter";

describe("StubHealthAdapter", () => {
  const adapter = new StubHealthAdapter();
  const unavailable = {
    ok: false,
    error: {
      kind: "health",
      code: "unavailable",
      message: "Health integration not yet available",
    },
  };

  it("reports no availability and undetermined permissions", async () => {
    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.getPermissionStatus()).resolves.toEqual({
      steps: "not_determined",
      calories: "not_determined",
      bodyWeight: "not_determined",
      heartRate: "not_determined",
      sleep: "not_determined",
    });
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });

  it("fails every read and write with the same unavailable error", async () => {
    const results = await Promise.all([
      adapter.requestPermissions(),
      adapter.getStepsToday(),
      adapter.getStepsLastNDays(7),
      adapter.getActiveCaloriesToday(),
      adapter.getBasalCaloriesToday(),
      adapter.getStandTimeTodayMinutes(),
      adapter.getLatestBodyWeight(),
      adapter.getHeartRateLatest(),
      adapter.getLatestBodyFat(),
      adapter.writeBodyWeight(),
      adapter.writeBodyFat(),
      adapter.getSleepLastNight(),
      adapter.writeSleep(),
    ]);
    expect(results).toHaveLength(13);
    for (const result of results) expect(result).toEqual(unavailable);
  });
});
