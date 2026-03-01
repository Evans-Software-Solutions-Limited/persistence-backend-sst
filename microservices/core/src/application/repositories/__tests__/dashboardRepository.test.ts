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
    it("should return dashboard data for a user with all results", async () => {
      const userId = "user-123";
      const today = new Date();

      const mockSession = {
        id: "session-1",
        userId,
        name: "Workout 1",
        status: "completed",
        startedAt: today,
        completedAt: today,
        totalDurationSeconds: 3600,
      };

      const mockGoal = {
        id: "goal-1",
        userId,
        priority: 1,
        isActive: true,
        targetDate: "2024-12-31",
      };

      const mockMeasurement = {
        id: "measurement-1",
        userId,
        weightKg: "75.5",
        bodyFatPercentage: "15.5",
        measuredAt: today,
      };

      const mockRecord = {
        id: "record-1",
        userId,
        exerciseId: "exercise-1",
        recordType: "1rm",
        value: "100",
        achievedAt: today,
      };

      let callCount = 0;
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return createSelectMock([mockSession]); // recentWorkouts
          if (callCount === 2) return createSelectMock([mockGoal]); // activeGoals
          if (callCount === 3) return createSelectMock([mockMeasurement]); // latestMeasurement
          if (callCount === 4) return createSelectMock([mockRecord]); // personalRecords
          return createSelectMock([mockSession]); // streak calculation
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getDashboard(userId);

      expect(result).toBeDefined();
      expect(result.recentWorkouts).toHaveLength(1);
      expect(result.recentWorkouts[0].id).toBe("session-1");
      expect(result.activeGoals).toHaveLength(1);
      expect(result.latestMeasurements).toBeDefined();
      expect(result.latestMeasurements?.weightKg).toBe("75.5");
      expect(result.personalRecordsCount).toBe(1);
    });

    it("should return null for latestMeasurements when none exist", async () => {
      const userId = "user-123";

      let callCount = 0;
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 3) return createSelectMock([]); // latestMeasurement is empty
          return createSelectMock([]); // all other queries return empty
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getDashboard(userId);

      expect(result.latestMeasurements).toBeNull();
      expect(result.recentWorkouts).toHaveLength(0);
      expect(result.activeGoals).toHaveLength(0);
      expect(result.personalRecordsCount).toBe(0);
    });

    it("should calculate streak correctly for consecutive days", async () => {
      const userId = "user-123";
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const streakSessions = [{ startedAt: today }, { startedAt: yesterday }];

      let callCount = 0;
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount <= 4) return createSelectMock([]); // Empty for first 4 queries
          return createSelectMock(streakSessions); // Sessions for streak calculation
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getDashboard(userId);

      expect(result.streak).toBe(2);
    });

    it("should break streak on gap between sessions", async () => {
      const userId = "user-123";
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const threeDaysAgo = new Date(today);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const streakSessions = [
        { startedAt: today },
        { startedAt: twoDaysAgo }, // Gap of 2 days - this breaks the streak
        { startedAt: threeDaysAgo }, // Even older session
      ];

      let callCount = 0;
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount <= 4) return createSelectMock([]); // Empty for first 4 queries
          return createSelectMock(streakSessions); // Sessions for streak calculation
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getDashboard(userId);

      // Should only count today's session, then break
      expect(result.streak).toBe(1);
    });

    it("should return streak of 0 when no sessions exist", async () => {
      const userId = "user-123";

      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          return createSelectMock([]); // all queries return empty
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getDashboard(userId);

      expect(result.streak).toBe(0);
    });

    it("should handle sessions with null startedAt in streak calculation", async () => {
      const userId = "user-123";

      const streakSessions = [{ startedAt: null }, { startedAt: new Date() }];

      let callCount = 0;
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount <= 4) return createSelectMock([]); // Empty for first 4 queries
          return createSelectMock(streakSessions); // Sessions for streak calculation
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getDashboard(userId);

      expect(typeof result.streak).toBe("number");
      expect(result.streak).toBeGreaterThanOrEqual(0);
    });

    it("should handle default status when status is null", async () => {
      const userId = "user-123";

      const mockSession = {
        id: "session-1",
        userId,
        name: "Workout 1",
        status: null,
        startedAt: new Date(),
        completedAt: new Date(),
        totalDurationSeconds: 3600,
      };

      const mockGoal = {
        id: "goal-1",
        userId,
        priority: null,
        isActive: null,
        targetDate: "2024-12-31",
      };

      let callCount = 0;
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return createSelectMock([mockSession]); // recentWorkouts
          if (callCount === 2) return createSelectMock([mockGoal]); // activeGoals
          if (callCount === 3) return createSelectMock([]); // latestMeasurement
          if (callCount === 4) return createSelectMock([]); // personalRecords
          return createSelectMock([]);
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getDashboard(userId);

      expect(result.recentWorkouts[0].status).toBe("in_progress");
      expect(result.activeGoals[0].priority).toBe(1);
      expect(result.activeGoals[0].isActive).toBe(true);
    });
  });
});
