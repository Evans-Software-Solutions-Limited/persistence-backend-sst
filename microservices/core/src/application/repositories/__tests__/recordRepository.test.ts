/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeSelectWithOrderBy(resolvedValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

describe("RecordRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should create a personal record", async () => {
      const mockRecord = {
        id: "pr1",
        userId: "u1",
        exerciseId: "ex1",
        weight: 100,
        reps: 5,
        durationSeconds: null,
        distance: null,
        achievedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockRecord]),
          }),
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { RecordRepository } = await import("../recordRepository");
      const repo = new RecordRepository();
      const result = await repo.create("u1", {
        exerciseId: "ex1",
        weight: 100,
        reps: 5,
        achievedAt: new Date(),
      } as any);

      expect(result).toEqual(mockRecord);
    });
  });

  describe("list", () => {
    it("should list all personal records for a user", async () => {
      const mockRecord = {
        id: "pr1",
        userId: "u1",
        exerciseId: "ex1",
        weight: 100,
        reps: 5,
        durationSeconds: null,
        distance: null,
        achievedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectWithOrderBy([mockRecord])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { RecordRepository } = await import("../recordRepository");
      const repo = new RecordRepository();
      const result = await repo.list("u1");

      expect(result).toEqual([mockRecord]);
    });

    it("should list personal records filtered by exercise", async () => {
      const mockRecord = {
        id: "pr1",
        userId: "u1",
        exerciseId: "ex1",
        weight: 100,
        reps: 5,
        durationSeconds: null,
        distance: null,
        achievedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeSelectWithOrderBy([mockRecord])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { RecordRepository } = await import("../recordRepository");
      const repo = new RecordRepository();
      const result = await repo.list("u1", "ex1");

      expect(result).toEqual([mockRecord]);
    });
  });
});
