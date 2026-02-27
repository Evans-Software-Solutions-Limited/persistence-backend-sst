/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { delete: vi.fn() };

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

describe("GoalsDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.delete.mockResolvedValue(true);
  });

  it("should require authentication", async () => {
    const { goalsDeleteHandler } = await import("../goalsDeleteHandler");
    const response = await goalsDeleteHandler.handle(
      new Request("http://localhost/goals/g1", {
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 on successful delete", async () => {
    const { goalsDeleteHandler } = await import("../goalsDeleteHandler");
    const response = await goalsDeleteHandler.handle(
      new Request("http://localhost/goals/g1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("should return 404 when goal not found", async () => {
    mocks.delete.mockResolvedValue(false);
    const { goalsDeleteHandler } = await import("../goalsDeleteHandler");
    const response = await goalsDeleteHandler.handle(
      new Request("http://localhost/goals/g1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });
});
