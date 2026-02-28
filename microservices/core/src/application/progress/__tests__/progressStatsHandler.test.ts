import { describe, it, expect, vi, beforeEach } from "vitest";
import { progressStatsHandler } from "../progressStatsHandler";

vi.mock("../../../repositories/progressRepository", () => ({
  ProgressRepository: vi.fn().mockImplementation(() => ({
    getStats: vi.fn().mockResolvedValue({
      workoutFrequency: 3.5,
      volumeTrend: [1000, 1200, 1100],
      personalRecordCount: 2,
      bodyMeasurementTrend: {
        dates: ["2024-01-01", "2024-01-08"],
        weights: [75.5, 74.8],
        bodyFats: [15.5, 15.2],
      },
    }),
  })),
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn().mockResolvedValue({ sub: "user-123" }),
  requireAuth: vi.fn((x) => x),
  getUser: vi.fn(() => ({ sub: "user-123" })),
}));

describe("ProgressStatsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with progress stats", async () => {
    const from = "2024-01-01";
    const to = "2024-01-31";

    const response = await progressStatsHandler.handle(
      new Request(`http://localhost/progress/stats?from=${from}&to=${to}`, {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body).toHaveProperty("data");
  });

  it("should return 400 when dates are missing", async () => {
    const response = await progressStatsHandler.handle(
      new Request("http://localhost/progress/stats", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(400);
  });

  it("should return stats with required fields", async () => {
    const from = "2024-01-01";
    const to = "2024-01-31";

    const response = await progressStatsHandler.handle(
      new Request(`http://localhost/progress/stats?from=${from}&to=${to}`, {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    const body = (await response.json()) as {
      data: {
        workoutFrequency: number;
        volumeTrend: number[];
        personalRecordCount: number;
        bodyMeasurementTrend: {
          dates: string[];
          weights: (number | null)[];
          bodyFats: (number | null)[];
        };
      };
    };

    expect(typeof body.data.workoutFrequency).toBe("number");
    expect(Array.isArray(body.data.volumeTrend)).toBe(true);
    expect(typeof body.data.personalRecordCount).toBe("number");
    expect(body.data.bodyMeasurementTrend).toBeDefined();
  });
});
