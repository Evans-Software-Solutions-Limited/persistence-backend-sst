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
    it("should calculate stats with sessions and volume data", async () => {
      const userId = "user-123";
      const from = "2024-01-01";
      const to = "2024-01-31";

      const mockSession = {
        id: "session-1",
        userId,
        startedAt: new Date(from),
      };

      const mockSet = {
        reps: 10,
        weightKg: "50.5",
      };

      const mockMeasurement = {
        id: "measurement-1",
        measuredAt: new Date(from),
        weightKg: "75.5",
        bodyFatPercentage: "15.5",
      };

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue([mockSession]),
              then: (cb: any) => Promise.resolve([mockMeasurement]).then(cb),
            }),
            then: (cb: any) => Promise.resolve([mockSet]).then(cb),
          }),
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getStats(userId, from, to);

      expect(result).toBeDefined();
      expect(result.workoutFrequency).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.volumeTrend)).toBe(true);
      expect(result.personalRecordCount).toBeGreaterThanOrEqual(0);
    });

    it("should handle null measuredAt in measurements", async () => {
      const userId = "user-123";
      const from = "2024-01-01";
      const to = "2024-01-31";

      const mockSession = { startedAt: new Date(from) };

      const mockMeasurement = {
        id: "measurement-1",
        measuredAt: null,
        weightKg: "75.5",
        bodyFatPercentage: "15.5",
      };

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue([mockSession]),
              then: (cb: any) => Promise.resolve([mockMeasurement]).then(cb),
            }),
            then: (cb: any) => Promise.resolve([]).then(cb),
          }),
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getStats(userId, from, to);

      expect(result.bodyMeasurementTrend.dates).toHaveLength(1);
      expect(result.bodyMeasurementTrend.dates[0]).toBe("");
    });

    it("should handle null weightKg and bodyFatPercentage", async () => {
      const userId = "user-123";
      const from = "2024-01-01";
      const to = "2024-01-31";

      const mockSession = { startedAt: new Date(from) };

      const mockMeasurement = {
        id: "measurement-1",
        measuredAt: new Date(from),
        weightKg: null,
        bodyFatPercentage: null,
      };

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue([mockSession]),
              then: (cb: any) => Promise.resolve([mockMeasurement]).then(cb),
            }),
            then: (cb: any) => Promise.resolve([]).then(cb),
          }),
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getStats(userId, from, to);

      expect(result.bodyMeasurementTrend.dates).toHaveLength(1);
      expect(result.bodyMeasurementTrend.weights[0]).toBeNull();
      expect(result.bodyMeasurementTrend.bodyFats[0]).toBeNull();
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
              orderBy: vi.fn().mockReturnValue([mockRecord]),
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

    it("should return empty array when no records exist", async () => {
      const userId = "user-123";

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue([]),
            }),
          }),
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getRecords(userId);

      expect(result).toHaveLength(0);
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
                  offset: vi.fn().mockReturnValue([mockSession]),
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

    it("should return empty array when no sessions exist", async () => {
      const userId = "user-123";

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockReturnValue([]),
                }),
              }),
            }),
          }),
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getHistory(userId, 20, 0);

      expect(result).toHaveLength(0);
    });

    it("should handle sessions with null startedAt and completedAt", async () => {
      const userId = "user-123";
      const mockSession = {
        id: "session-1",
        userId,
        name: "Workout 1",
        startedAt: null,
        completedAt: null,
        status: "in_progress",
        totalDurationSeconds: null,
      };

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  offset: vi.fn().mockReturnValue([mockSession]),
                }),
              }),
            }),
          }),
        }),
      };

      (getDb as any).mockReturnValue(mockDb);

      const result = await repository.getHistory(userId, 20, 0);

      expect(result).toHaveLength(1);
      expect(result[0].startedAt).toBeNull();
      expect(result[0].completedAt).toBeNull();
    });
  });
});
