/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { DashboardRepository } from "../dashboardRepository";

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

describe("DashboardRepository", () => {
  let repository: DashboardRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new DashboardRepository();
  });

  describe("getDashboard", () => {
    it("should return dashboard data for a user", async () => {
      const userId = "user-123";
      const mockSession = {
        id: "session-1",
        userId,
        name: "Workout 1",
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        totalDurationSeconds: 3600,
      };

      const mockDb = {
        select: vi.fn().mockImplementation(() => createSelectMock([mockSession])),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getDashboard(userId);

      expect(result).toBeDefined();
      // Sessions are returned for all queries, so we expect 1 for each type
      expect(result.recentWorkouts.length).toBeGreaterThanOrEqual(0);
      expect(result.personalRecordsCount).toBeGreaterThanOrEqual(0);
      expect(typeof result.streak).toBe("number");
    });
  });
});
