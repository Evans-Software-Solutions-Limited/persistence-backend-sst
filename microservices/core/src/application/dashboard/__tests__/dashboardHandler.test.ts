import { describe, it, expect, vi, beforeEach } from "vitest";
import { dashboardHandler } from "../dashboardHandler";

vi.mock("../../../repositories/dashboardRepository", () => ({
  DashboardRepository: vi.fn().mockImplementation(() => ({
    getDashboard: vi.fn().mockResolvedValue({
      recentWorkouts: [],
      activeGoals: [],
      latestMeasurements: null,
      personalRecordsCount: 0,
      streak: 0,
      steps: null,
      energy: null,
    }),
  })),
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn().mockResolvedValue({ sub: "user-123" }),
  requireAuth: vi.fn((x) => x),
  getUser: vi.fn(() => ({ sub: "user-123" })),
}));

describe("DashboardHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with dashboard data", async () => {
    const response = await dashboardHandler.handle(
      new Request("http://localhost/dashboard", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown };
    expect(body).toHaveProperty("data");
    expect(body.data).toHaveProperty("recentWorkouts");
    expect(body.data).toHaveProperty("activeGoals");
    expect(body.data).toHaveProperty("personalRecordsCount");
    expect(body.data).toHaveProperty("streak");
  });

  it("should return dashboard with required fields", async () => {
    const response = await dashboardHandler.handle(
      new Request("http://localhost/dashboard", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );

    const body = (await response.json()) as {
      data: {
        recentWorkouts: unknown[];
        activeGoals: unknown[];
        latestMeasurements: unknown;
        personalRecordsCount: number;
        streak: number;
        steps: null;
        energy: null;
      };
    };

    expect(Array.isArray(body.data.recentWorkouts)).toBe(true);
    expect(Array.isArray(body.data.activeGoals)).toBe(true);
    expect(typeof body.data.personalRecordsCount).toBe("number");
    expect(typeof body.data.streak).toBe("number");
  });
});
