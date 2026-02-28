/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { DashboardRepository } from "../dashboardRepository";

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

      const mockMeasurement = {
        id: "measurement-1",
        userId,
        weightKg: "75.5",
        bodyFatPercentage: "15.5",
        measuredAt: new Date(),
      };

      const mockDb = {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([mockSession]),
                }),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([mockMeasurement]),
                }),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getDashboard(userId);

      expect(result).toBeDefined();
      expect(result.recentWorkouts).toHaveLength(1);
      expect(result.latestMeasurements).toBeDefined();
      expect(result.personalRecordsCount).toBe(0);
    });
  });
});
