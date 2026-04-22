import {
  SIMULATOR_MOCK_VALUES,
  SimulatorMockHealthAdapter,
} from "@/adapters/health/simulator-mock.adapter";

describe("SimulatorMockHealthAdapter", () => {
  const adapter = new SimulatorMockHealthAdapter();

  it("reports isAvailable: true", async () => {
    expect(await adapter.isAvailable()).toBe(true);
  });

  it("resolves permission request as all-granted", async () => {
    const result = await adapter.requestPermissions();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      steps: "granted",
      calories: "granted",
      bodyWeight: "granted",
      heartRate: "granted",
    });
  });

  it("returns the deterministic step count from the parent spec", async () => {
    const result = await adapter.getStepsToday();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(4812);
    expect(result.value).toBe(SIMULATOR_MOCK_VALUES.stepsToday);
  });

  it("returns the deterministic active-calorie value", async () => {
    const result = await adapter.getActiveCaloriesToday();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(312);
  });

  it("returns the deterministic latest body-weight sample", async () => {
    const result = await adapter.getLatestBodyWeight();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).not.toBeNull();
    expect(result.value?.value).toBe(74.5);
    expect(result.value?.unit).toBe("kg");
    expect(typeof result.value?.date).toBe("string");
  });

  it("returns the deterministic latest heart rate", async () => {
    const result = await adapter.getHeartRateLatest();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBe(62);
  });

  it("returns ok on writeBodyWeight (the simulator can pretend it writes)", async () => {
    const result = await adapter.writeBodyWeight();
    expect(result.ok).toBe(true);
  });

  it("has a no-op disconnect", async () => {
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });

  it("exposes permission status as all-granted", async () => {
    const status = await adapter.getPermissionStatus();
    expect(status).toEqual({
      steps: "granted",
      calories: "granted",
      bodyWeight: "granted",
      heartRate: "granted",
    });
  });
});
