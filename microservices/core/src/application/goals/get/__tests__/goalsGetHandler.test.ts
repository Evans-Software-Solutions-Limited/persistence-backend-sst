/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { getById: vi.fn() };

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "test-user-id",
      email: "test@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

vi.mock("../../../repositories/goalRepository", () => ({
  GoalRepository: vi.fn().mockImplementation(() => mocks),
}));

describe("GoalsGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getById.mockResolvedValue({
      id: "goal-1",
      userId: "test-user-id",
      goalTypeId: "gt-1",
      priority: 1,
      isActive: true,
      createdAt: new Date(),
    });
  });

  it("should require authentication", async () => {
    const { goalsGetHandler } = await import("../goalsGetHandler");
    const response = await goalsGetHandler.handle(
      new Request("http://localhost/goals/g1", {
        method: "GET",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 with goal data", async () => {
    const { goalsGetHandler } = await import("../goalsGetHandler");
    const response = await goalsGetHandler.handle(
      new Request("http://localhost/goals/g1", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data.data.id).toBe("goal-1");
  });

  it("should return 404 when goal not found", async () => {
    mocks.getById.mockResolvedValue(null);
    const { goalsGetHandler } = await import("../goalsGetHandler");
    const response = await goalsGetHandler.handle(
      new Request("http://localhost/goals/g1", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });
});
