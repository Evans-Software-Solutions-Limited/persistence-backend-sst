/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";

const programmes = {
  getActiveProgrammesForRelationships: vi.fn(),
  listOpenAssignmentsForRelationships: vi.fn(),
};
const nutrition = { get: vi.fn() };
const habits = { listForUser: vi.fn() };
const goals = { list: vi.fn() };
vi.mock("../programAssignmentRepository", () => ({
  ProgramAssignmentRepository: vi.fn(function () {
    return programmes;
  }),
}));
vi.mock("../nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn(function () {
    return nutrition;
  }),
}));
vi.mock("../habitConfigRepository", () => ({
  HabitConfigRepository: vi.fn(function () {
    return habits;
  }),
}));
vi.mock("../goalRepository", () => ({
  GoalRepository: vi.fn(function () {
    return goals;
  }),
}));

import { CoachingAggregateRepository } from "../coachingAggregateRepository";

function aggregateDb(queue: unknown[][]) {
  const [selectRows = [], executeRows = []] = queue;
  return {
    select: vi.fn(() => {
      const chain: any = {};
      for (const key of ["from", "orderBy"]) chain[key] = vi.fn(() => chain);
      chain.where = vi.fn(() => chain);
      chain.limit = vi.fn(async () => selectRows);
      chain.then = (resolve: (value: unknown[]) => unknown) =>
        resolve(selectRows);
      return chain;
    }),
    execute: vi.fn(async (query: unknown) => {
      void query;
      return executeRows;
    }),
  };
}

describe("CoachingAggregateRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    programmes.getActiveProgrammesForRelationships.mockResolvedValue(new Map());
    programmes.listOpenAssignmentsForRelationships.mockResolvedValue(new Map());
    nutrition.get.mockResolvedValue(null);
    habits.listForUser.mockResolvedValue([]);
    goals.list.mockResolvedValue([]);
    (getDb as any).mockReturnValue(aggregateDb([[], [], []]));
  });

  it("does not issue client-wide reads when there are no active relationships", async () => {
    const out = await new CoachingAggregateRepository().getMany([], "client-a");
    expect(out).toEqual(new Map());
    expect(getDb).not.toHaveBeenCalled();
    expect(habits.listForUser).not.toHaveBeenCalled();
  });

  it("returns purposeful empty modules for an active relationship with no setup", async () => {
    const out = await new CoachingAggregateRepository().get(
      "trainer-a",
      "client-a",
    );
    expect(out).toEqual({
      activeProgramme: null,
      upcomingWorkouts: [],
      habits: [],
      nutritionTarget: null,
      activeGoal: null,
      visibleBriefs: [],
    });
  });

  it("shares public assignment data and never exposes private notes", async () => {
    programmes.getActiveProgrammesForRelationships.mockResolvedValue(
      new Map([
        ["trainer-a", { programId: "program-a", assignedByName: "Coach A" }],
      ]),
    );
    programmes.listOpenAssignmentsForRelationships.mockResolvedValue(
      new Map([
        [
          "trainer-a",
          [
            {
              assignmentId: "assignment-a",
              workoutId: "workout-a",
              name: "Upper",
              estimatedDurationMinutes: 45,
              dueDate: "2026-09-02",
            },
          ],
        ],
      ]),
    );
    habits.listForUser.mockResolvedValue([
      {
        goalId: "enabled",
        enabled: true,
        category: "steps",
        assignedByUserId: "trainer-a",
        assignedByName: "Coach A",
        targetValue: 8000,
        unit: "steps",
        period: "daily",
        completionRule: "value_gte",
        daysPerWeek: 5,
        tolerancePct: null,
        pending: null,
      },
      { goalId: "disabled", enabled: false },
    ]);
    nutrition.get.mockResolvedValue({
      dailyKcal: 2200,
      setByUserId: "trainer-a",
    });
    goals.list.mockResolvedValue([
      { id: "old", isActive: false },
      {
        id: "active",
        isActive: true,
        assignedByUserId: "trainer-a",
        goalTypeName: "Lose weight",
        targetValue: 75,
        currentValue: 80,
        unit: "kg",
        targetDate: "2026-12-01",
      },
    ]);
    (getDb as any).mockReturnValue(
      aggregateDb([
        [{ id: "trainer-a", role: "personal_trainer", name: "Coach A" }],
        [
          {
            id: "brief-a",
            trainerId: "trainer-a",
            title: "Brief",
            message: "Visible guidance",
            createdAt: new Date("2026-09-01T09:00:00Z"),
          },
        ],
      ]),
    );
    const out = await new CoachingAggregateRepository().get(
      "trainer-a",
      "client-a",
    );
    expect(out.habits[0]).toMatchObject({
      goalId: "enabled",
      enabled: true,
      assignedByCoach: true,
      locked: true,
    });
    expect(out.upcomingWorkouts).toEqual([
      {
        assignmentId: "assignment-a",
        workoutId: "workout-a",
        name: "Upper",
        estimatedDurationMinutes: 45,
        dueDate: "2026-09-02",
        assignedByType: "personal_trainer",
        assignedByName: "Coach A",
      },
    ]);
    expect(out.activeGoal).toEqual({
      id: "active",
      title: "Lose weight",
      targetValue: 75,
      currentValue: 80,
      unit: "kg",
      targetDate: "2026-12-01",
    });
    expect(out.visibleBriefs[0].content).toBe("Visible guidance");
    expect("notes" in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain("private");
  });

  it("maps physio attribution, pending habit edits, and nullable brief content", async () => {
    programmes.listOpenAssignmentsForRelationships.mockResolvedValue(
      new Map([
        [
          "trainer-b",
          [
            {
              assignmentId: "assignment-b",
              workoutId: "workout-b",
              name: null,
              estimatedDurationMinutes: null,
              dueDate: null,
            },
          ],
        ],
      ]),
    );
    habits.listForUser.mockResolvedValue([
      {
        goalId: "habit-b",
        enabled: true,
        category: "water",
        assignedByUserId: "trainer-b",
        assignedByName: "Pat Physio",
        targetValue: 2,
        unit: "l",
        period: "daily",
        completionRule: "value_gte",
        daysPerWeek: 7,
        tolerancePct: null,
        pending: {
          from: "2026-09-07",
          config: { targetValue: 3, from: "untrusted-json-value" },
        },
      },
    ]);
    (getDb as any).mockReturnValue(
      aggregateDb([
        [
          {
            id: "trainer-b",
            role: "physiotherapist",
            name: "Pat Physio",
          },
        ],
        [
          {
            id: "brief-b",
            trainerId: "trainer-b",
            title: "Check-in",
            message: null,
            createdAt: "2026-09-01T09:00:00.000Z",
          },
        ],
      ]),
    );
    const out = await new CoachingAggregateRepository().get(
      "trainer-b",
      "client-a",
    );
    expect(out.upcomingWorkouts[0]).toMatchObject({
      assignedByType: "physiotherapist",
      assignedByName: "Pat Physio",
    });
    expect(out.habits[0]).toMatchObject({
      assignedByCoach: true,
      locked: true,
      pending: { from: "2026-09-07", targetValue: 3 },
    });
    expect(out.visibleBriefs[0]).toEqual({
      id: "brief-b",
      title: "Check-in",
      content: "",
      createdAt: "2026-09-01T09:00:00.000Z",
    });
  });

  it("batches two active coaching relationships without repeating client-wide reads", async () => {
    programmes.getActiveProgrammesForRelationships.mockResolvedValue(
      new Map([
        ["trainer-a", { programId: "program-a" }],
        ["trainer-b", { programId: "program-b" }],
      ]),
    );
    programmes.listOpenAssignmentsForRelationships.mockResolvedValue(new Map());
    habits.listForUser.mockResolvedValue([
      {
        goalId: "habit-a",
        enabled: true,
        assignedByUserId: "trainer-a",
        pending: null,
      },
      {
        goalId: "habit-b",
        enabled: true,
        assignedByUserId: "trainer-b",
        pending: null,
      },
    ]);
    const db = aggregateDb([
      [
        { id: "trainer-a", role: "personal_trainer", name: "Coach A" },
        { id: "trainer-b", role: "physiotherapist", name: "Coach B" },
      ],
      [
        {
          id: "brief-a",
          trainerId: "trainer-a",
          title: "A",
          message: "A",
          createdAt: "2026-09-02T00:00:00Z",
        },
        {
          id: "brief-b",
          trainerId: "trainer-b",
          title: "B",
          message: "B",
          createdAt: "2026-09-01T00:00:00Z",
        },
      ],
    ]);
    (getDb as any).mockReturnValue(db);

    const out = await new CoachingAggregateRepository().getMany(
      ["trainer-a", "trainer-b"],
      "client-a",
    );

    expect(programmes.getActiveProgrammesForRelationships).toHaveBeenCalledWith(
      ["trainer-a", "trainer-b"],
      "client-a",
      expect.any(String),
    );
    expect(habits.listForUser).toHaveBeenCalledTimes(1);
    expect(nutrition.get).toHaveBeenCalledTimes(1);
    expect(goals.list).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(out.get("trainer-a")?.habits).toHaveLength(1);
    expect(out.get("trainer-a")?.visibleBriefs[0]?.id).toBe("brief-a");
    expect(out.get("trainer-b")?.habits).toHaveLength(1);
    expect(out.get("trainer-b")?.visibleBriefs[0]?.id).toBe("brief-b");
  });

  it("excludes self-authored and other-coach setup from this relationship", async () => {
    habits.listForUser.mockResolvedValue([
      {
        goalId: "self-habit",
        enabled: true,
        assignedByUserId: null,
      },
      {
        goalId: "other-habit",
        enabled: true,
        assignedByUserId: "trainer-b",
      },
    ]);
    nutrition.get.mockResolvedValue({
      dailyKcal: 2200,
      setByUserId: "trainer-b",
    });
    goals.list.mockResolvedValue([
      {
        id: "self-goal",
        isActive: true,
        assignedByUserId: null,
      },
      {
        id: "other-goal",
        isActive: true,
        assignedByUserId: "trainer-b",
      },
    ]);

    const out = await new CoachingAggregateRepository().get(
      "trainer-a",
      "client-a",
    );

    expect(out.habits).toEqual([]);
    expect(out.nutritionTarget).toBeNull();
    expect(out.activeGoal).toBeNull();
  });

  it("fails closed for unattributed legacy briefs", async () => {
    const db = aggregateDb([
      [{ id: "trainer-a", role: "personal_trainer", name: "Coach A" }],
      [],
    ]);
    (getDb as any).mockReturnValue(db);

    const out = await new CoachingAggregateRepository().get(
      "trainer-a",
      "client-a",
    );

    expect(out.visibleBriefs).toEqual([]);
    const briefPredicate = new PgDialect().sqlToQuery(
      db.execute.mock.calls[0][0] as never,
    );
    expect(briefPredicate.sql).toContain("trainerId");
    expect(briefPredicate.sql).toContain("row_number() OVER");
    expect(briefPredicate.sql).toContain("relationship_rank <= 20");
    expect(briefPredicate.sql).not.toContain("is null");
  });
});
