/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { create: vi.fn() };

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

describe("GoalsCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({
      id: "goal-1",
      userId: "test-user-id",
      goalTypeId: "gt-1",
      priority: 1,
      isActive: true,
      targetDate: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("should require authentication", async () => {
    const { goalsCreateHandler } = await import("../goalsCreateHandler");
    const response = await goalsCreateHandler.handle(
      new Request("http://localhost/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalTypeId: "gt-1" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 201 on successful creation", async () => {
    const { goalsCreateHandler } = await import("../goalsCreateHandler");
    const response = await goalsCreateHandler.handle(
      new Request("http://localhost/goals", {
        method: "POST",
        body: JSON.stringify({ goalTypeId: "gt-1" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(201);
    const data = (await response.json()) as any;
    expect(data).toHaveProperty("data");
    expect(data.data.goalTypeId).toBe("gt-1");
  });

  it("should set default priority to 1", async () => {
    const { goalsCreateHandler } = await import("../goalsCreateHandler");
    await goalsCreateHandler.handle(
      new Request("http://localhost/goals", {
        method: "POST",
        body: JSON.stringify({ goalTypeId: "gt-1" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(mocks.create).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ priority: 1, isActive: true }),
    );
  });
});
