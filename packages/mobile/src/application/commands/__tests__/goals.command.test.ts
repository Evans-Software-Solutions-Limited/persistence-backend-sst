import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import {
  createGoalCommand,
  updateGoalCommand,
  deleteGoalCommand,
} from "@/application/commands/goals.command";
import type { GoalType } from "@/domain/ports/api.port";
import type { Goal } from "@/domain/models/goal";

const USER = "u-1";
const SQUAT: GoalType = {
  id: "gt-squat",
  name: "Squat 1RM",
  description: null,
  category: "strength",
  iconName: "barbell",
};

function deps() {
  const storage = new InMemoryStorageAdapter();
  const api = new InMemoryApiAdapter();
  return { storage, api, userId: USER, idFactory: () => "fixed" };
}

function seed(storage: InMemoryStorageAdapter, goals: Goal[]) {
  storage.cacheGoals(USER, goals);
}

function existing(over: Partial<Goal> = {}): Goal {
  return {
    id: "g-old",
    goalTypeId: "gt-old",
    goalTypeName: "Old goal",
    iconName: null,
    category: null,
    targetValue: null,
    currentValue: null,
    unit: null,
    targetDate: "2026-01-01",
    notes: null,
    priority: 1,
    isActive: true,
    assignedByUserId: null,
    assignedByName: null,
    isCoachAssigned: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

describe("createGoalCommand", () => {
  it("optimistically prepends then reconciles to the server id, keeping the type name", async () => {
    const d = deps();
    seed(d.storage, [existing()]);

    const result = await createGoalCommand(d, {
      goalType: SQUAT,
      targetDate: "2026-12-31",
    });

    expect(result.ok).toBe(true);
    const cached = d.storage.getCachedGoals(USER)!;
    expect(cached).toHaveLength(2);
    // Newest-first; the temp `local-fixed` id was swapped for the server id.
    expect(cached[0].id).not.toBe("local-fixed");
    expect(cached[0].goalTypeName).toBe("Squat 1RM");
    expect(cached[0].goalTypeId).toBe("gt-squat");
    expect(cached[0].targetDate).toBe("2026-12-31");
    expect(cached[0].isCoachAssigned).toBe(false);
    expect(cached[1].id).toBe("g-old");
  });

  it("writes the optimistic row synchronously (before the network resolves)", () => {
    const d = deps();
    seed(d.storage, []);
    // Do NOT await — inspect the cache after the sync prefix ran.
    void createGoalCommand(d, { goalType: SQUAT });
    const cached = d.storage.getCachedGoals(USER)!;
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe("local-fixed");
    expect(cached[0].goalTypeName).toBe("Squat 1RM");
  });

  it("reverts the optimistic row on failure", async () => {
    const d = deps();
    seed(d.storage, [existing()]);
    d.api.shouldFail = true;

    const result = await createGoalCommand(d, { goalType: SQUAT });

    expect(result.ok).toBe(false);
    const cached = d.storage.getCachedGoals(USER)!;
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe("g-old");
  });
});

describe("updateGoalCommand", () => {
  it("patches the target date while preserving the goal-type name", async () => {
    const d = deps();
    const g = existing({ id: "g-1", goalTypeName: "Squat 1RM" });
    seed(d.storage, [g]);
    d.api.goals.push({
      id: "g-1",
      userId: USER,
      goalTypeId: g.goalTypeId,
      priority: 1,
      targetDate: "2026-01-01",
      isActive: true,
      createdAt: g.createdAt,
      updatedAt: g.createdAt,
    });

    const result = await updateGoalCommand(d, "g-1", {
      targetDate: "2027-03-03",
    });

    expect(result.ok).toBe(true);
    const cached = d.storage.getCachedGoals(USER)!;
    expect(cached[0].targetDate).toBe("2027-03-03");
    expect(cached[0].goalTypeName).toBe("Squat 1RM");
  });

  it("reverts on failure", async () => {
    const d = deps();
    seed(d.storage, [existing({ id: "g-1", targetDate: "2026-01-01" })]);
    d.api.shouldFail = true;

    const result = await updateGoalCommand(d, "g-1", {
      targetDate: "2099-09-09",
    });

    expect(result.ok).toBe(false);
    expect(d.storage.getCachedGoals(USER)![0].targetDate).toBe("2026-01-01");
  });

  it("falls back to the mapped server row when the goal is not cached", async () => {
    const d = deps();
    seed(d.storage, []); // empty cache → no baseline target to merge
    d.api.goals.push({
      id: "g-x",
      userId: USER,
      goalTypeId: "gt-1",
      priority: 1,
      targetDate: "2026-01-01",
      isActive: true,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    const result = await updateGoalCommand(d, "g-x", { targetDate: null });

    // Success via the `target ? … : raw` fallback (no baseline row to merge).
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.id).toBe("g-x");
  });
});

describe("deleteGoalCommand", () => {
  it("optimistically removes the goal", async () => {
    const d = deps();
    const g = existing({ id: "g-1" });
    seed(d.storage, [g]);
    d.api.goals.push({
      id: "g-1",
      userId: USER,
      goalTypeId: g.goalTypeId,
      priority: 1,
      targetDate: null,
      isActive: true,
      createdAt: g.createdAt,
      updatedAt: g.createdAt,
    });

    const result = await deleteGoalCommand(d, "g-1");

    expect(result.ok).toBe(true);
    expect(d.storage.getCachedGoals(USER)).toEqual([]);
  });

  it("restores the goal on failure", async () => {
    const d = deps();
    seed(d.storage, [existing({ id: "g-1" })]);
    d.api.shouldFail = true;

    const result = await deleteGoalCommand(d, "g-1");

    expect(result.ok).toBe(false);
    expect(d.storage.getCachedGoals(USER)![0].id).toBe("g-1");
  });
});
