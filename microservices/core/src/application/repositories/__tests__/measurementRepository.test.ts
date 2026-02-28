/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

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

describe("MeasurementRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should create a measurement", async () => {
      const mockMeasurement = {
        id: "m1",
        userId: "u1",
        chestCm: 100,
        waistCm: 80,
        hipsCm: 95,
        thighCm: 55,
        armCm: 35,
        forearmCm: 30,
        calfCm: 38,
        bodyFatPercent: 15,
        weightKg: 80,
        notes: null,
        measuredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockMeasurement]),
          }),
        }),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { MeasurementRepository } =
        await import("../measurementRepository");
      const repo = new MeasurementRepository();
      const result = await repo.create("u1", {
        chestCm: 100,
        waistCm: 80,
        hipsCm: 95,
        thighCm: 55,
        armCm: 35,
        forearmCm: 30,
        calfCm: 38,
        bodyFatPercent: 15,
        weightKg: 80,
        measuredAt: new Date(),
      } as any);

      expect(result).toEqual(mockMeasurement);
    });
  });

  describe("list", () => {
    it("should list measurements for a user", async () => {
      const mockMeasurement = {
        id: "m1",
        userId: "u1",
        chestCm: 100,
        waistCm: 80,
        hipsCm: 95,
        thighCm: 55,
        armCm: 35,
        forearmCm: 30,
        calfCm: 38,
        bodyFatPercent: 15,
        weightKg: 80,
        notes: null,
        measuredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDb = {
        select: vi.fn().mockReturnValue(makeListChain([mockMeasurement])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { MeasurementRepository } =
        await import("../measurementRepository");
      const repo = new MeasurementRepository();
      const result = await repo.list("u1", 20, 0);

      expect(result).toEqual([mockMeasurement]);
    });
  });
});
