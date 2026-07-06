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
    // Wire payload MUST be the date-only local day, NOT a noon-UTC ISO instant
    // (backend treats date-only as the authoritative user-local day; sweep 11).
    expect((JSON.parse(queued[0].payload) as { date: string }).date).toBe(
      "2026-06-10",
    );

    expect(storage.getCachedHome("u1")).toBeNull(); // invalidated
  });

  it("regression fix: done=true with a value threads it into BOTH the optimistic row and the wire payload", () => {
    // A grid tap on a CONFIGURED water habit sends value=targetValue so the
    // backend's validateCompletionValue (value_gte requires one) doesn't 422.
    toggleHabitDayCommand(deps(), {
      goalId: "g-water",
      day: "2026-06-10",
      done: true,
      value: 2, // the habit's live targetValue (2 l/day)
    });

    const rows = storage.getCachedHabitCompletions("u1", {
      goalId: "g-water",
    });
    expect(rows[0].value).toBe(2);

    const queued = storage.getPendingMutations();
    const payload = JSON.parse(queued[0].payload) as {
      goalId: string;
      date: string;
      value: number | null;
    };
    expect(payload).toEqual({
      goalId: "g-water",
      date: "2026-06-10",
      value: 2,
    });
  });

  it("done=true with value omitted: local cache stores null but the wire payload OMITS the value key entirely (byte-identical to legacy)", () => {
    // Gym (count) and any legacy/no-config habit never require a value —
    // sending `value: null` would be inert but not byte-identical to the
    // pre-fix `{goalId, date}` shape. The key itself must be absent.
    toggleHabitDayCommand(deps(), {
      goalId: "g-legacy",
      day: "2026-06-10",
      done: true,
    });
    const rows = storage.getCachedHabitCompletions("u1", {
      goalId: "g-legacy",
    });
    expect(rows[0].value).toBeNull();
    const queued = storage.getPendingMutations();
    const payload = JSON.parse(queued[0].payload) as Record<string, unknown>;
    expect(payload).toEqual({ goalId: "g-legacy", date: "2026-06-10" });
    expect(Object.prototype.hasOwnProperty.call(payload, "value")).toBe(false);
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

    expect(
      storage.getCachedHabitCompletions("u1", { goalId: "g1" }),
    ).toHaveLength(0);
    const queued = storage.getPendingMutations();
    expect(queued[0].method).toBe("DELETE");
    expect(queued[0].endpoint).toContain("goalId=g1");
    // Date-only local day on the wire, not a noon-UTC ISO instant.
    expect(queued[0].endpoint).toContain("date=2026-06-10");
    expect(queued[0].endpoint).not.toContain("T12%3A00");
    expect((JSON.parse(queued[0].payload) as { date: string }).date).toBe(
      "2026-06-10",
    );
  });

  it("un-toggling is unaffected by the regression fix — a passed value is ignored on DELETE", () => {
    storage.upsertHabitCompletion({
      id: "seed",
      userId: "u1",
      goalId: "g1",
      day: "2026-06-10",
      completedAt: "2026-06-10T12:00:00.000Z",
      value: 2,
    });
    toggleHabitDayCommand(deps(), {
      goalId: "g1",
      day: "2026-06-10",
      done: false,
      value: 2, // present, but DELETE never carries a value payload
    });
    const queued = storage.getPendingMutations();
    expect(queued[0].method).toBe("DELETE");
    expect(JSON.parse(queued[0].payload)).toEqual({
      goalId: "g1",
      date: "2026-06-10",
    });
  });
});
