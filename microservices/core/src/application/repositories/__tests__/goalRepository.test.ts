/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeSelectChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeListChain(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            offset: vi.fn().mockResolvedValue(resolvedValue),
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
    it("should list goals for a user", async () => {
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
        select: vi.fn().mockReturnValue(makeListChain([mockGoal])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.list("u1", 20, 0);

      expect(result).toEqual([mockGoal]);
    });
  });

  describe("getById", () => {
    it("should get goal by id", async () => {
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
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.getById("g1", "u1");

      expect(result).toEqual(mockGoal);
    });

    it("should return null when goal not found", async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { GoalRepository } = await import("../goalRepository");
      const repo = new GoalRepository();
      const result = await repo.getById("g1", "u1");

      expect(result).toBeNull();
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
