import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { toggleHabitDayCommand } from "../toggle-habit.command";

describe("toggleHabitDayCommand", () => {
  let storage: InMemoryStorageAdapter;
  let n: number;
  const deps = () => ({
    storage,
    userId: "u1",
    idFactory: () => `id-${(n += 1)}`,
  });

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    n = 0;
  });

  it("done=true: optimistically caches the completion + enqueues a POST", () => {
    storage.cacheHome("u1", {} as never); // ensure invalidation is observable
    toggleHabitDayCommand(deps(), {
      goalId: "g1",
      day: "2026-06-10",
      done: true,
    });

    const rows = storage.getCachedHabitCompletions("u1", { goalId: "g1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].completedAt).toBe("2026-06-10T12:00:00.000Z");

    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0].endpoint).toBe("/habit-completions");
    expect(queued[0].method).toBe("POST");

    expect(storage.getCachedHome("u1")).toBeNull(); // invalidated
  });

  it("done=false: optimistically removes the completion + enqueues a DELETE", () => {
    storage.upsertHabitCompletion({
      id: "seed",
      userId: "u1",
      goalId: "g1",
      day: "2026-06-10",
      completedAt: "2026-06-10T12:00:00.000Z",
      value: null,
    });

    toggleHabitDayCommand(deps(), {
      goalId: "g1",
      day: "2026-06-10",
      done: false,
    });

    expect(storage.getCachedHabitCompletions("u1", { goalId: "g1" })).toHaveLength(
      0,
    );
    const queued = storage.getPendingMutations();
    expect(queued[0].method).toBe("DELETE");
    expect(queued[0].endpoint).toContain("goalId=g1");
  });
});
