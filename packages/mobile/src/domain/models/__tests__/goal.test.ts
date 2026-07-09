import {
  areGoalsStale,
  mapApiGoalToGoal,
  GOALS_STALE_AFTER_MS,
} from "@/domain/models/goal";
import type { ApiGoal } from "@/domain/ports/api.port";

function apiGoal(over: Partial<ApiGoal> = {}): ApiGoal {
  return {
    id: "g-1",
    userId: "u-1",
    goalTypeId: "gt-1",
    priority: 1,
    targetDate: "2026-12-31",
    isActive: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

describe("mapApiGoalToGoal", () => {
  it("maps a self-set goal (no attribution)", () => {
    const g = mapApiGoalToGoal(
      apiGoal({
        goalTypeName: "Bench 1RM",
        goalTypeIconName: "barbell",
        goalTypeCategory: "strength",
        assignedByUserId: null,
        assignedByName: null,
      }),
    );
    expect(g.goalTypeName).toBe("Bench 1RM");
    expect(g.iconName).toBe("barbell");
    expect(g.category).toBe("strength");
    expect(g.isCoachAssigned).toBe(false);
    expect(g.assignedByName).toBeNull();
  });

  it("flags a coach-assigned goal + carries the assigner name", () => {
    const g = mapApiGoalToGoal(
      apiGoal({
        assignedByUserId: "coach-1",
        assignedByName: "Coach Jane",
        targetValue: 100,
        unit: "kg",
      }),
    );
    expect(g.isCoachAssigned).toBe(true);
    expect(g.assignedByName).toBe("Coach Jane");
    expect(g.targetValue).toBe(100);
    expect(g.unit).toBe("kg");
  });

  it("defaults missing enrichment fields to null", () => {
    const g = mapApiGoalToGoal(apiGoal());
    expect(g.goalTypeName).toBeNull();
    expect(g.iconName).toBeNull();
    expect(g.targetValue).toBeNull();
    expect(g.notes).toBeNull();
    expect(g.isCoachAssigned).toBe(false);
  });
});

describe("areGoalsStale", () => {
  it("is stale when never synced", () => {
    expect(areGoalsStale(null, Date.now())).toBe(true);
  });

  it("is fresh within the TTL and stale past it", () => {
    const now = 1_000_000_000_000;
    const recent = new Date(now - 1000).toISOString();
    const old = new Date(now - GOALS_STALE_AFTER_MS - 1000).toISOString();
    expect(areGoalsStale(recent, now)).toBe(false);
    expect(areGoalsStale(old, now)).toBe(true);
  });
});
