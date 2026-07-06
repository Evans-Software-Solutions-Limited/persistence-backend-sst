import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import {
  configureHabitCommand,
  disableHabitCommand,
  nextMondayISO,
} from "../configure-habit.command";
import { defaultHabitConfig } from "@/domain/models/habit-config";

describe("nextMondayISO", () => {
  it("returns the upcoming Monday (never today, even on a Monday)", () => {
    // 2026-06-10 is a Wednesday → next Monday 2026-06-15.
    expect(nextMondayISO(new Date("2026-06-10T12:00:00.000Z"))).toBe(
      "2026-06-15",
    );
    // 2026-06-08 is a Monday → the NEXT Monday, 2026-06-15 (not today).
    expect(nextMondayISO(new Date("2026-06-08T12:00:00.000Z"))).toBe(
      "2026-06-15",
    );
    // 2026-06-14 is a Sunday → 2026-06-15.
    expect(nextMondayISO(new Date("2026-06-14T12:00:00.000Z"))).toBe(
      "2026-06-15",
    );
  });
});

describe("configureHabitCommand", () => {
  let storage: InMemoryStorageAdapter;
  let n: number;
  const now = () => new Date("2026-06-10T12:00:00.000Z"); // Wed → Mon 06-15
  const deps = () => ({
    storage,
    userId: "u1",
    idFactory: () => `id-${(n += 1)}`,
    now,
  });

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    n = 0;
  });

  it("first enable: writes a LIVE config effective next Monday with a local- goalId + enqueues PUT + invalidates home", () => {
    storage.cacheHome("u1", {} as never);
    configureHabitCommand(deps(), {
      category: "water",
      targetValue: 2.5,
      daysPerWeek: 5,
    });

    const cached = storage.getHabitConfigs("u1");
    expect(cached).toHaveLength(1);
    expect(cached[0].category).toBe("water");
    expect(cached[0].enabled).toBe(true);
    expect(cached[0].goalId).toMatch(/^local-/);
    expect(cached[0].effectiveFrom).toBe("2026-06-15");
    expect(cached[0].pending).toBeNull();

    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0].method).toBe("PUT");
    expect(queued[0].endpoint).toBe("/users/me/habits/water/config");
    expect(JSON.parse(queued[0].payload)).toEqual({
      targetValue: 2.5,
      daysPerWeek: 5,
    });

    expect(storage.getCachedHome("u1")).toBeNull();
  });

  it("edit to an already-active habit: writes a PENDING config (Starts Monday), leaves the live row", () => {
    // Seed an already-active water habit.
    storage.upsertHabitConfig("u1", {
      ...defaultHabitConfig("water"),
      enabled: true,
      goalId: "server-goal",
      targetValue: 2,
      daysPerWeek: 5,
      effectiveFrom: "2026-06-01",
    });

    configureHabitCommand(deps(), {
      category: "water",
      targetValue: 3,
      daysPerWeek: 6,
    });

    const cached = storage.getHabitConfigs("u1")[0];
    // Live row untouched — this week's bar unchanged.
    expect(cached.targetValue).toBe(2);
    expect(cached.daysPerWeek).toBe(5);
    // The new value is queued as pending, promoting next Monday.
    expect(cached.pending).toEqual({
      from: "2026-06-15",
      targetValue: 3,
      daysPerWeek: 6,
      tolerancePct: null,
    });
  });

  it("coach write (clientId): enqueues the trainer endpoint, does NOT mirror to the coach's own cache", () => {
    configureHabitCommand(
      deps(),
      { category: "water", targetValue: 2 },
      "client-9",
    );
    expect(storage.getHabitConfigs("u1")).toHaveLength(0); // no self mirror
    const queued = storage.getPendingMutations();
    expect(queued[0].endpoint).toBe(
      "/trainers/me/clients/client-9/habits/water/config",
    );
  });

  it("Calories includes daysPerWeek + tolerancePct in the wire body", () => {
    configureHabitCommand(deps(), {
      category: "calories",
      targetValue: 2000,
      daysPerWeek: 6,
      tolerancePct: 10,
    });
    const queued = storage.getPendingMutations();
    expect(JSON.parse(queued[0].payload)).toEqual({
      targetValue: 2000,
      daysPerWeek: 6,
      tolerancePct: 10,
    });
  });

  it("Gym omits daysPerWeek from the wire body (its target IS the weekly count)", () => {
    configureHabitCommand(deps(), { category: "gym", targetValue: 3 });
    const queued = storage.getPendingMutations();
    expect(JSON.parse(queued[0].payload)).toEqual({ targetValue: 3 });
  });
});

describe("disableHabitCommand", () => {
  let storage: InMemoryStorageAdapter;
  const now = () => new Date("2026-06-10T12:00:00.000Z");
  const deps = () => ({ storage, userId: "u1", now });

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it("queues a PENDING { enabled:false } locally + enqueues DELETE + invalidates home", () => {
    storage.cacheHome("u1", {} as never);
    storage.upsertHabitConfig("u1", {
      ...defaultHabitConfig("water"),
      enabled: true,
      goalId: "server-goal",
    });

    disableHabitCommand(deps(), "water");

    const cached = storage.getHabitConfigs("u1")[0];
    // Deferred: still enabled locally with a Starts-Monday disable pending.
    expect(cached.enabled).toBe(true);
    expect(cached.pending).toEqual({ from: "2026-06-15", enabled: false });

    const queued = storage.getPendingMutations();
    expect(queued[0].method).toBe("DELETE");
    expect(queued[0].endpoint).toBe("/users/me/habits/water");
    expect(storage.getCachedHome("u1")).toBeNull();
  });

  it("coach disable (clientId): trainer endpoint, no self-cache mutation", () => {
    disableHabitCommand(deps(), "water", "client-9");
    expect(storage.getHabitConfigs("u1")).toHaveLength(0);
    expect(storage.getPendingMutations()[0].endpoint).toBe(
      "/trainers/me/clients/client-9/habits/water",
    );
  });
});
