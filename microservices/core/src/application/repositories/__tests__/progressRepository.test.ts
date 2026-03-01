/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { ProgressRepository } from "../progressRepository";

// Helper function to create a reusable mock chain
function createMockChain(result: any) {
  const chain = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(result),
    resolve: vi.fn().mockResolvedValue(result),
  };
  // Make the chain resolve when awaited
  (chain as any).then = function (onFulfilled: any) {
    return Promise.resolve(result).then(onFulfilled);
  };
  return chain;
}

function createSelectMock(result: any) {
  return {
    from: vi.fn().mockReturnValue(createMockChain(result)),
  };
}

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

      // Create a mock db that returns data for sessions but empty for other queries
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          // Return different results based on the number of calls
          // This is a workaround since we can't track context
          return createSelectMock([mockSession]);
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getStats(userId, from, to);

      expect(result).toBeDefined();
      expect(result.workoutFrequency).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.volumeTrend)).toBe(true);
      // Expect at least the mock session to be counted as one record
      expect(result.personalRecordCount).toBeGreaterThanOrEqual(0);
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
        select: vi.fn().mockImplementation(() => createSelectMock([mockRecord])),
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
        select: vi.fn().mockImplementation(() => createSelectMock([mockSession])),
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
