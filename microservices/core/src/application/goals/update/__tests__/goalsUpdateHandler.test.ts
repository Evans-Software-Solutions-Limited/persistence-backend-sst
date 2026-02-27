/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { update: vi.fn() };

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

describe("GoalsUpdateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({
      id: "goal-1",
      userId: "test-user-id",
      goalTypeId: "gt-1",
      priority: 2,
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("should require authentication", async () => {
    const { goalsUpdateHandler } = await import("../goalsUpdateHandler");
    const response = await goalsUpdateHandler.handle(
      new Request("http://localhost/goals/g1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 on successful update", async () => {
    const { goalsUpdateHandler } = await import("../goalsUpdateHandler");
    const response = await goalsUpdateHandler.handle(
      new Request("http://localhost/goals/g1", {
        method: "PATCH",
        body: JSON.stringify({ priority: 2 }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("should return 404 when goal not found", async () => {
    mocks.update.mockResolvedValue(null);
    const { goalsUpdateHandler } = await import("../goalsUpdateHandler");
    const response = await goalsUpdateHandler.handle(
      new Request("http://localhost/goals/g1", {
        method: "PATCH",
        body: JSON.stringify({ priority: 2 }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("should return 400 when no valid fields provided", async () => {
    const { goalsUpdateHandler } = await import("../goalsUpdateHandler");
    const response = await goalsUpdateHandler.handle(
      new Request("http://localhost/goals/g1", {
        method: "PATCH",
        body: JSON.stringify({}),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(400);
  });
});
