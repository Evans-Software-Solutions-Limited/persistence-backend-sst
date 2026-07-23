import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import {
  defaultHabitConfig,
  type HabitConfig,
} from "@/domain/models/habit-config";
import { reflectStepsHabit } from "../steps-habit-bridge.command";

/**
 * An active, enabled steps habit with a steps `targetValue` (value_gte) and
 * a synced goalId — the shape `reflectStepsHabit` looks for. Mirrors
 * `waterHabit`/`sleepHabit` in the water/sleep bridge test suites.
 */
function stepsHabit(over: Partial<HabitConfig> = {}): HabitConfig {
  return {
    ...defaultHabitConfig("steps"),
    enabled: true,
    goalId: "g-steps",
    targetValue: 8000,
    ...over,
  };
}

const USER = "u1";
const DATE = "2026-07-22";
let n = 0;
const idFactory = () => `id${++n}`;
const deps = (storage: InMemoryStorageAdapter) => ({
  storage,
  userId: USER,
  idFactory,
});

describe("reflectStepsHabit (BRIEF-7 QA-1..QA-4)", () => {
  const completions = (storage: InMemoryStorageAdapter) =>
    storage.getCachedHabitCompletions(USER, { goalId: "g-steps" });
  const habitMutations = (storage: InMemoryStorageAdapter) =>
    storage
      .getPendingMutations()
      .filter((m) => m.entityType === "habit_completion");

  beforeEach(() => {
    n = 0;
  });

  it("ticks the steps habit when steps reach the target (value = target steps)", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [stepsHabit()]); // target 8000

    reflectStepsHabit(deps(storage), DATE, 8000);

    const rows = completions(storage);
    expect(rows).toHaveLength(1);
    expect(rows[0].localCompletedDate).toBe(DATE);
    expect(rows[0].value).toBe(8000);

    const posts = habitMutations(storage).filter((m) => m.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].endpoint).toBe("/habit-completions");
    expect(JSON.parse(posts[0].payload)).toEqual({
      goalId: "g-steps",
      date: DATE,
      value: 8000,
    });
  });

  it("ticks when steps exceed the target", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [stepsHabit()]);
    reflectStepsHabit(deps(storage), DATE, 9500);
    expect(completions(storage)).toHaveLength(1);
  });

  it("does NOT tick when steps are below the target", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [stepsHabit()]);
    reflectStepsHabit(deps(storage), DATE, 4000);
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });

  it("un-ticks (DELETE) when a later read drops back below the target", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [stepsHabit()]);

    reflectStepsHabit(deps(storage), DATE, 8000); // tick
    expect(completions(storage)).toHaveLength(1);

    // Steps are cumulative in practice so this shouldn't normally happen
    // intraday, but the bridge must still be correct/symmetric like water's.
    reflectStepsHabit(deps(storage), DATE, 2000);
    expect(completions(storage)).toHaveLength(0);

    const del = habitMutations(storage).find((m) => m.method === "DELETE")!;
    expect(del.endpoint).toContain("goalId=g-steps");
    expect(del.endpoint).toContain(`date=${DATE}`);
  });

  it("no steps habit configured → writes NO completion", () => {
    const storage = new InMemoryStorageAdapter();
    reflectStepsHabit(deps(storage), DATE, 10000);
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });

  it("disabled steps habit → no completion", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [stepsHabit({ enabled: false })]);
    reflectStepsHabit(deps(storage), DATE, 10000);
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });

  it("steps habit with no synced goalId → no completion", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [stepsHabit({ goalId: null })]);
    reflectStepsHabit(deps(storage), DATE, 10000);
    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });

  it("is idempotent: re-reading a higher step count while already ticked enqueues no duplicate completion (no double-write)", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [stepsHabit()]);

    reflectStepsHabit(deps(storage), DATE, 8000); // tick
    reflectStepsHabit(deps(storage), DATE, 8500); // still ≥ target — no change
    reflectStepsHabit(deps(storage), DATE, 9000); // still ≥ target — no change

    expect(completions(storage)).toHaveLength(1);
    const posts = habitMutations(storage);
    expect(posts).toHaveLength(1);
    expect(posts[0].method).toBe("POST");
  });

  it("is idempotent: repeated below-target reads enqueue nothing", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheHabitConfigs(USER, [stepsHabit()]);

    reflectStepsHabit(deps(storage), DATE, 1000);
    reflectStepsHabit(deps(storage), DATE, 3000);
    reflectStepsHabit(deps(storage), DATE, 5000);

    expect(completions(storage)).toHaveLength(0);
    expect(habitMutations(storage)).toHaveLength(0);
  });
});
