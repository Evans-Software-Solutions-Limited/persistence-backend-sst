/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { ProgressRepository } from "../progressRepository";

describe("ProgressRepository", () => {
  let repository: ProgressRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new ProgressRepository();
  });

  describe("getStats", () => {
    it("should return progress stats for a date range", async () => {
      const userId = "user-123";
      const from = "2024-01-01";
      const to = "2024-01-31";

      const mockSession = {
        id: "session-1",
        userId,
        startedAt: new Date(from),
        completedAt: new Date(to),
        status: "completed",
      };

      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([mockSession]),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        selectDistinct: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getStats(userId, from, to);

      expect(result).toBeDefined();
      expect(result.workoutFrequency).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.volumeTrend)).toBe(true);
      expect(result.personalRecordCount).toBe(0);
    });
  });

  describe("getRecords", () => {
    it("should return personal records for a user", async () => {
      const userId = "user-123";
      const mockRecord = {
        id: "record-1",
        userId,
        exerciseId: "exercise-1",
        recordType: "1rm",
        value: "100.00",
        achievedAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([mockRecord]),
            }),
          }),
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getRecords(userId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "record-1",
        exerciseId: "exercise-1",
        recordType: "1rm",
        value: 100,
      });
    });
  });

  describe("getHistory", () => {
    it("should return paginated session history", async () => {
      const userId = "user-123";
      const mockSession = {
        id: "session-1",
        userId,
        name: "Workout 1",
        startedAt: new Date(),
        completedAt: new Date(),
        status: "completed",
        totalDurationSeconds: 3600,
      };

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockResolvedValue([mockSession]),
                }),
              }),
            }),
          }),
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getHistory(userId, 20, 0);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "session-1",
        name: "Workout 1",
        status: "completed",
      });
    });
  });
});
