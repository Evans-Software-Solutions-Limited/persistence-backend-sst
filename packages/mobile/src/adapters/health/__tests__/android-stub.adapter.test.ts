import { AndroidStubHealthAdapter } from "@/adapters/health/android-stub.adapter";

describe("AndroidStubHealthAdapter", () => {
  const adapter = new AndroidStubHealthAdapter();

  it("reports isAvailable: false", async () => {
    expect(await adapter.isAvailable()).toBe(false);
  });

  it("resolves permission request as no-op success", async () => {
    const result = await adapter.requestPermissions();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      steps: "denied",
      calories: "denied",
      bodyWeight: "denied",
      heartRate: "denied",
    });
  });

  it("surfaces unavailable for every read", async () => {
    const stepsResult = await adapter.getStepsToday();
    expect(stepsResult.ok).toBe(false);
    if (stepsResult.ok) return;
    expect(stepsResult.error.code).toBe("unavailable");

    const energyResult = await adapter.getActiveCaloriesToday();
    expect(energyResult.ok).toBe(false);

    const basalResult = await adapter.getBasalCaloriesToday();
    expect(basalResult.ok).toBe(false);

    const standResult = await adapter.getStandTimeTodayMinutes();
    expect(standResult.ok).toBe(false);

    const weightResult = await adapter.getLatestBodyWeight();
    expect(weightResult.ok).toBe(false);

    const hrResult = await adapter.getHeartRateLatest();
    expect(hrResult.ok).toBe(false);
  });

  it("surfaces unavailable for writes", async () => {
    const result = await adapter.writeBodyWeight();
    expect(result.ok).toBe(false);
  });

  it("has a no-op disconnect", async () => {
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });

  it("exposes permission status as denied", async () => {
    const status = await adapter.getPermissionStatus();
    expect(status.steps).toBe("denied");
  });
});
