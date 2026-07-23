import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import {
  defaultHabitConfig,
  type HabitConfig,
} from "@/domain/models/habit-config";
import { logSleepCommand } from "../log-sleep.command";

/**
 * An active, enabled sleep habit with an hours `targetValue` (value_gte) and
 * a synced goalId — the shape the bridge in `logSleepCommand` looks for.
 */
function sleepHabit(over: Partial<HabitConfig> = {}): HabitConfig {
  return {
    ...defaultHabitConfig("sleep"),
    enabled: true,
    goalId: "g-sleep",
    targetValue: 8, // 8h/night = 480 minutes
    ...over,
  };
}

describe("logSleepCommand", () => {
  let storage: InMemoryStorageAdapter;
  let n = 0;
  const idFactory = () => `id${++n}`;
  const deps = () => ({ storage, userId: "u1", idFactory });

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    n = 0;
  });

  it("rejects a zero duration", () => {
    const res = logSleepCommand(deps(), {
      sleepDate: "2026-07-16",
      durationMinutes: 0,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a duration over 1440 minutes", () => {
    const res = logSleepCommand(deps(), {
      sleepDate: "2026-07-16",
      durationMinutes: 1441,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a non-finite duration", () => {
    const res = logSleepCommand(deps(), {
      sleepDate: "2026-07-16",
      durationMinutes: NaN,
    });
    expect(res.ok).toBe(false);
  });

  it("enqueues a POST + invalidates home", () => {
    storage.cacheHome("u1", {} as never);
    const res = logSleepCommand(deps(), {
      sleepDate: "2026-07-16",
      durationMinutes: 450,
      sleepStart: "2026-07-15T23:30:00.000Z",
      sleepEnd: "2026-07-16T07:00:00.000Z",
    });
    expect(res.ok).toBe(true);

    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0].entityType).toBe("sleep");
    expect(queued[0].entityId).toBe("2026-07-16");
    expect(queued[0].endpoint).toBe("/health/sleep");
    expect(queued[0].method).toBe("POST");
    expect(JSON.parse(queued[0].payload)).toEqual({
      sleepDate: "2026-07-16",
      durationMinutes: 450,
      sleepStart: "2026-07-15T23:30:00.000Z",
      sleepEnd: "2026-07-16T07:00:00.000Z",
    });

    expect(storage.getCachedHome("u1")).toBeNull();
  });

  it("re-saving the same day enqueues independently (idempotent day-keyed upsert)", () => {
    logSleepCommand(deps(), { sleepDate: "2026-07-16", durationMinutes: 300 });
    logSleepCommand(deps(), { sleepDate: "2026-07-16", durationMinutes: 480 });
    // Both saves enqueue independently (the sync worker's idempotent
    // day-keyed upsert makes replaying either one safe on reconnect — the
    // backend overwrites rather than duplicating).
    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(2);
    expect(JSON.parse(queued[1].payload)).toMatchObject({
      durationMinutes: 480,
    });
  });

  it("enqueues the payload without sleepStart/sleepEnd when not provided", () => {
    logSleepCommand(deps(), { sleepDate: "2026-07-16", durationMinutes: 300 });
    const queued = storage.getPendingMutations();
    const payload = JSON.parse(queued[0].payload) as {
      sleepStart?: string;
      sleepEnd?: string;
    };
    expect(payload.sleepStart).toBeUndefined();
    expect(payload.sleepEnd).toBeUndefined();
  });
});

// BRIEF-7 QA-1..QA-4 (mobile half) — mirrors the water-litres-habit-bridge
// tests in nutrition.command.test.ts exactly, adapted to sleep's
// minutes-logged / hours-target unit conversion.
describe("logSleepCommand → sleep-habit bridge", () => {
  const DATE = "2026-07-16";
  const completions = (s: InMemoryStorageAdapter) =>
    s.getCachedHabitCompletions("u1", { goalId: "g-sleep" });
  const habitMutations = (s: InMemoryStorageAdapter) =>
    s.getPendingMutations().filter((m) => m.entityType === "habit_completion");

  it("ticks the sleep habit when logged hours reach the target (value = target hours)", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs("u1", [sleepHabit()]); // target 8h = 480 min
    let n = 0;
    const idFactory = () => `id${++n}`;

    logSleepCommand(
      { storage, userId: "u1", idFactory },
      { sleepDate: DATE, durationMinutes: 480 }, // exactly 8h
    );

    const rows = completions(storage);
    expect(rows).toHaveLength(1);
    expect(rows[0].localCompletedDate).toBe(DATE);
    expect(rows[0].value).toBe(8);

    const posts = habitMutations(storage).filter((m) => m.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].endpoint).toBe("/habit-completions");
    expect(JSON.parse(posts[0].payload)).toEqual({
      goalId: "g-sleep",
      date: DATE,
      value: 8,
    });
  });

  it("does NOT tick when logged hours are below the target", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs("u1", [sleepHabit()]); // 8h target
    let n = 0;
    logSleepCommand(
      { storage, userId: "u1", idFactory: () => `id${++n}` },
      { sleepDate: DATE, durationMinutes: 420 }, // 7h < 8h
    );
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });

  it("un-ticks (DELETE) when a later re-save drops back below the target", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs("u1", [sleepHabit()]);
    let n = 0;
    const idFactory = () => `id${++n}`;

    logSleepCommand(
      { storage, userId: "u1", idFactory },
      { sleepDate: DATE, durationMinutes: 480 }, // tick at 8h
    );
    expect(completions(storage)).toHaveLength(1);

    logSleepCommand(
      { storage, userId: "u1", idFactory },
      { sleepDate: DATE, durationMinutes: 300 }, // 5h < 8h → un-tick
    );
    expect(completions(storage)).toHaveLength(0);

    const del = habitMutations(storage).find((m) => m.method === "DELETE")!;
    expect(del.endpoint).toContain("goalId=g-sleep");
    expect(del.endpoint).toContain(`date=${DATE}`);
  });

  it("no sleep habit configured → logs sleep but writes NO completion", () => {
    const storage = new InMemoryStorageAdapter();
    let n = 0;
    logSleepCommand(
      { storage, userId: "u1", idFactory: () => `id${++n}` },
      { sleepDate: DATE, durationMinutes: 480 },
    );
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
    expect(
      storage.getPendingMutations().filter((m) => m.entityType === "sleep"),
    ).toHaveLength(1);
  });

  it("disabled sleep habit → no completion", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs("u1", [sleepHabit({ enabled: false })]);
    let n = 0;
    logSleepCommand(
      { storage, userId: "u1", idFactory: () => `id${++n}` },
      { sleepDate: DATE, durationMinutes: 480 },
    );
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });

  it("sleep habit with no synced goalId → no completion", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs("u1", [sleepHabit({ goalId: null })]);
    let n = 0;
    logSleepCommand(
      { storage, userId: "u1", idFactory: () => `id${++n}` },
      { sleepDate: DATE, durationMinutes: 480 },
    );
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });

  it("is idempotent: re-saving MORE minutes while already ticked enqueues no duplicate completion", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs("u1", [sleepHabit()]);
    let n = 0;
    const idFactory = () => `id${++n}`;

    logSleepCommand(
      { storage, userId: "u1", idFactory },
      { sleepDate: DATE, durationMinutes: 480 }, // tick (8h)
    );
    logSleepCommand(
      { storage, userId: "u1", idFactory },
      { sleepDate: DATE, durationMinutes: 540 }, // 9h, still ≥ 8h — no change
    );

    expect(completions(storage)).toHaveLength(1);
    const posts = habitMutations(storage);
    expect(posts).toHaveLength(1);
    expect(posts[0].method).toBe("POST");
  });
});
