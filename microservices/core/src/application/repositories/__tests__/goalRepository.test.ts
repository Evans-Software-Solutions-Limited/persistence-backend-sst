/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

/**
 * Recording select chain for the enriched list/getById reads. Unlike the
 * canned chains above it captures the two `.leftJoin` conditions and the
 * `.where` predicate so a test can render them via `PgDialect` and assert the
 * emitted SQL — the mocked-DB SQL blind spot the repo's MEMORY warns about
 * (reference_drizzle_groupby_param_bug.md): a wrong join predicate or a dropped
 * ownership filter would otherwise ship green.
 */
interface CapturedSql {
  joins: unknown[];
  where: unknown;
}
function makeRecordingChain(
  resolvedValue: unknown,
  capture: CapturedSql,
  // list resolves at `.offset()`; getById resolves at `.limit()`.
  resolveAt: "offset" | "limit",
) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.leftJoin = vi.fn((_table: unknown, cond: unknown) => {
    capture.joins.push(cond);
    return chain;
  });
  chain.where = vi.fn((cond: unknown) => {
    capture.where = cond;
    return chain;
  });
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit =
    resolveAt === "limit"
      ? vi.fn().mockResolvedValue(resolvedValue)
      : vi.fn().mockReturnValue(chain);
  chain.offset = vi.fn().mockResolvedValue(resolvedValue);
  return chain;
}

// Ownership-check select used by update/delete: `.from().where().limit()`.
function makeSelectChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

// Enriched getById read: `.from().leftJoin().leftJoin().where().limit()`.
function makeGetByIdChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      leftJoin: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(resolvedValue),
          }),
        }),
      }),
    }),
  };
}

// Enriched list read:
// `.from().leftJoin().leftJoin().where().orderBy().limit().offset()`.
function makeListChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      leftJoin: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(resolvedValue),
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

function makeUpdateChain(resolvedValue: unknown) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeDeleteChain(resolvedValue: unknown) {
  return {
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(resolvedValue),
    }),
  };
}

describe("GoalRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should create a goal", async () => {
      const mockGoal = {
        id: "g1",
        userId: "u1",
        goalTypeId: "gt1",
        targetValue: 100,
        currentValue: 0,
        unit: "kg",
        deadline: new Date(),
        priority: 1,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockGoal]),
          }),
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.create("u1", {
        goalTypeId: "gt1",
        targetValue: 100,
        unit: "kg",
        deadline: new Date(),
        priority: 1,
      } as any);

      expect(result).toEqual(mockGoal);
    });
  });

  describe("list", () => {
    it("should map a self-set goal to the enriched DTO (no attribution)", async () => {
      // Raw joined-select row: numeric→string, timestamp→Date, self-set goal
      // (assignedByUserId null → assignedByName suppressed).
      const row = {
        id: "g1",
        userId: "u1",
        goalTypeId: "gt1",
        priority: 1,
        isActive: true,
        targetDate: "2026-12-31",
        notes: "push hard",
        assignedByUserId: null,
        targetValue: null,
        currentValue: null,
        unit: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-02T00:00:00.000Z"),
        goalTypeName: "Bench press 1RM",
        goalTypeIconName: "barbell",
        goalTypeCategory: "strength",
        assignedByName: null,
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([row])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.list("u1", 20, 0);

      expect(result).toEqual([
        {
          id: "g1",
          userId: "u1",
          goalTypeId: "gt1",
          priority: 1,
          isActive: true,
          targetDate: "2026-12-31",
          notes: "push hard",
          assignedByUserId: null,
          targetValue: null,
          currentValue: null,
          unit: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
          goalTypeName: "Bench press 1RM",
          goalTypeIconName: "barbell",
          goalTypeCategory: "strength",
          assignedByName: null,
        },
      ]);
    });

    it("should carry coach attribution + convert numeric targets for an assigned goal", async () => {
      const row = {
        id: "g2",
        userId: "u1",
        goalTypeId: "gt2",
        priority: 2,
        isActive: true,
        targetDate: null,
        notes: null,
        assignedByUserId: "coach1",
        targetValue: "100",
        currentValue: "40",
        unit: "kg",
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
        updatedAt: new Date("2026-07-03T00:00:00.000Z"),
        goalTypeName: "Squat 1RM",
        goalTypeIconName: "barbell",
        goalTypeCategory: "strength",
        assignedByName: "Coach Jane",
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([row])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const [result] = await repo.list("u1", 20, 0);

      expect(result.assignedByName).toBe("Coach Jane");
      expect(result.assignedByUserId).toBe("coach1");
      expect(result.targetValue).toBe(100);
      expect(result.currentValue).toBe(40);
      expect(result.unit).toBe("kg");
    });

    it("should tolerate null priority/isActive/timestamps and a string timestamp", async () => {
      // Nullable defaults not yet applied + a non-Date timestamp value exercise
      // the `?? null` and `toIso` fallback branches.
      const row = {
        id: "g4",
        userId: "u1",
        goalTypeId: "gt1",
        priority: null,
        isActive: null,
        targetDate: null,
        notes: null,
        assignedByUserId: null,
        targetValue: null,
        currentValue: null,
        unit: null,
        createdAt: null,
        updatedAt: "2026-07-05T00:00:00.000Z",
        goalTypeName: "Body weight",
        goalTypeIconName: null,
        goalTypeCategory: null,
        assignedByName: null,
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([row])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const [result] = await repo.list("u1", 20, 0);

      expect(result.priority).toBeNull();
      expect(result.isActive).toBeNull();
      expect(result.createdAt).toBeNull();
      expect(result.updatedAt).toBe("2026-07-05T00:00:00.000Z");
    });

    it("should suppress a name when assignedByUserId is null even if the join returned one", async () => {
      const row = {
        id: "g3",
        userId: "u1",
        goalTypeId: "gt1",
        priority: 1,
        isActive: true,
        targetDate: null,
        notes: null,
        assignedByUserId: null,
        targetValue: null,
        currentValue: null,
        unit: null,
        createdAt: new Date("2026-07-04T00:00:00.000Z"),
        updatedAt: new Date("2026-07-04T00:00:00.000Z"),
        goalTypeName: "Body weight",
        goalTypeIconName: null,
        goalTypeCategory: null,
        assignedByName: "Ghost Coach",
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([row])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const [result] = await repo.list("u1", 20, 0);

      expect(result.assignedByName).toBeNull();
      expect(result.goalTypeIconName).toBeNull();
      expect(result.goalTypeCategory).toBeNull();
    });
  });

  describe("getById", () => {
    it("should get an enriched goal by id", async () => {
      const row = {
        id: "g1",
        userId: "u1",
        goalTypeId: "gt1",
        priority: 1,
        isActive: true,
        targetDate: "2026-12-31",
        notes: null,
        assignedByUserId: "coach1",
        targetValue: "80",
        currentValue: null,
        unit: "kg",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        goalTypeName: "Deadlift 1RM",
        goalTypeIconName: "barbell",
        goalTypeCategory: "strength",
        assignedByName: "Coach Jane",
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeGetByIdChain([row])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.getById("g1", "u1");

      expect(result).not.toBeNull();
      expect(result?.goalTypeName).toBe("Deadlift 1RM");
      expect(result?.assignedByName).toBe("Coach Jane");
      expect(result?.targetValue).toBe(80);
      expect(result?.currentValue).toBeNull();
    });

    it("should return null when goal not found", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeGetByIdChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.getById("g1", "u1");

      expect(result).toBeNull();
    });
  });

  // SQL render guards — the mock chains above return canned rows regardless of
  // the real join/where arguments, so a mis-wired predicate (e.g. joining
  // profiles on user_id → attributing the athlete's OWN name as the assigner,
  // or dropping the ownership filter) would still pass. Rendering the captured
  // expressions via PgDialect asserts the emitted SQL text.
  describe("enriched-read SQL", () => {
    it("list joins goal_types + profiles on the right keys and scopes to the user", async () => {
      const capture: CapturedSql = { joins: [], where: undefined };
      (getDb as any).mockReturnValue({
        select: vi
          .fn()
          .mockReturnValue(makeRecordingChain([], capture, "offset")),
      });

      const { GoalRepository } = await import("../goalRepository");
      await new GoalRepository().list("user-123", 20, 0);

      const dialect = new PgDialect();
      expect(capture.joins).toHaveLength(2);
      const [typeJoin, profileJoin] = capture.joins.map(
        (c) => dialect.sqlToQuery(c as never).sql,
      );
      const where = dialect.sqlToQuery(capture.where as never).sql;

      expect(typeJoin).toContain('"goal_types"."id"');
      expect(typeJoin).toContain('"user_goals"."goal_type_id"');
      // The assigner join keys profiles to assigned_by_user_id — NOT user_id;
      // the wrong column would leak the athlete's own name as the "assigner".
      expect(profileJoin).toContain('"profiles"."id"');
      expect(profileJoin).toContain('"user_goals"."assigned_by_user_id"');
      expect(profileJoin).not.toContain('"user_goals"."user_id"');
      expect(where).toContain('"user_goals"."user_id"');
    });

    it("getById scopes to both the goal id and the owning user", async () => {
      const capture: CapturedSql = { joins: [], where: undefined };
      (getDb as any).mockReturnValue({
        select: vi
          .fn()
          .mockReturnValue(makeRecordingChain([], capture, "limit")),
      });

      const { GoalRepository } = await import("../goalRepository");
      await new GoalRepository().getById("goal-9", "user-123");

      const dialect = new PgDialect();
      expect(capture.joins).toHaveLength(2);
      const where = dialect.sqlToQuery(capture.where as never).sql;
      expect(where).toContain('"user_goals"."id"');
      expect(where).toContain('"user_goals"."user_id"');
    });
  });

  describe("update", () => {
    it("should update a goal", async () => {
      const mockGoal = {
        id: "g1",
        userId: "u1",
        goalTypeId: "gt1",
        targetValue: 100,
        currentValue: 50,
        unit: "kg",
        deadline: new Date(),
        priority: 2,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([mockGoal])),
        update: vi.fn().mockReturnValue(makeUpdateChain([mockGoal])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.update("g1", "u1", { priority: 2 });

      expect(result).toEqual(mockGoal);
    });

    it("should return null when goal not found for update", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.update("g1", "u1", { priority: 2 });

      expect(result).toBeNull();
    });
  });

  describe("listTypes", () => {
    it("should return the catalog mapped to the wire shape, sorted by the DB order", async () => {
      // orderBy resolves directly to the rows (no limit/offset chaining),
      // sort order itself is asserted on the query builder call below.
      const rows = [
        {
          id: "gt-1",
          name: "Bench press 1RM",
          description: "Increase one-rep max on bench press",
          category: "strength",
          iconName: "barbell",
        },
        {
          id: "gt-2",
          name: "Body weight",
          description: null,
          category: null,
          iconName: null,
        },
      ];

      const orderBy = vi.fn().mockResolvedValue(rows);
      const from = vi.fn().mockReturnValue({ orderBy });
      const select = vi.fn().mockReturnValue({ from });
      (getDb as any).mockReturnValue({ select });

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.listTypes();

      expect(result).toEqual(rows);
      expect(select).toHaveBeenCalledTimes(1);
      expect(orderBy).toHaveBeenCalledTimes(1);
    });

    it("should map missing description/category/iconName to null", async () => {
      const rows = [
        {
          id: "gt-3",
          name: "Habit streak",
          description: undefined,
          category: undefined,
          iconName: undefined,
        },
      ];

      const orderBy = vi.fn().mockResolvedValue(rows);
      const from = vi.fn().mockReturnValue({ orderBy });
      const select = vi.fn().mockReturnValue({ from });
      (getDb as any).mockReturnValue({ select });

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.listTypes();

      expect(result).toEqual([
        {
          id: "gt-3",
          name: "Habit streak",
          description: null,
          category: null,
          iconName: null,
        },
      ]);
    });

    it("should order by category ASC NULLS LAST, then name ASC", async () => {
      const orderBy = vi.fn().mockResolvedValue([]);
      const from = vi.fn().mockReturnValue({ orderBy });
      const select = vi.fn().mockReturnValue({ from });
      (getDb as any).mockReturnValue({ select });

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      await repo.listTypes();

      expect(orderBy).toHaveBeenCalledTimes(1);
      const [categoryOrdering, nameOrdering] = orderBy.mock.calls[0];
      // The category ordering is a raw `sql` fragment (drizzle's SQL object
      // graph is cyclic — pull the literal string chunks out rather than
      // JSON.stringify-ing the whole thing) carrying "NULLS LAST".
      const stringChunks = (categoryOrdering as any).queryChunks
        .filter((chunk: any) => chunk && "value" in chunk)
        .flatMap((chunk: any) => chunk.value)
        .join("");
      expect(stringChunks).toContain("NULLS LAST");
      // The name ordering is a plain `asc()` column expression.
      expect(nameOrdering).toBeDefined();
    });
  });

  describe("delete", () => {
    it("should delete a goal", async () => {
      const mockGoal = {
        id: "g1",
        userId: "u1",
        goalTypeId: "gt1",
        targetValue: 100,
        currentValue: 0,
        unit: "kg",
        deadline: new Date(),
        priority: 1,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([mockGoal])),
        delete: vi.fn().mockReturnValue(makeDeleteChain([mockGoal])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.delete("g1", "u1");

      expect(result).toBe(true);
    });

    it("should return false when goal not found for delete", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.delete("g1", "u1");

      expect(result).toBe(false);
    });
  });
});
