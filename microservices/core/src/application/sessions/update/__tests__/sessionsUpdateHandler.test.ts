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

vi.mock("../../../repositories/sessionRepository", () => ({
  SessionRepository: vi.fn().mockImplementation(() => mocks),
}));

describe("SessionsUpdateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({
      id: "session-1",
      userId: "test-user-id",
      workoutId: "w1",
      name: "Updated Session",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
    });
  });

  it("should require authentication", async () => {
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    const response = await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 on successful update", async () => {
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    const response = await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("should return 404 when session not found", async () => {
    mocks.update.mockResolvedValue(null);
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    const response = await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("should return 400 when no valid fields provided", async () => {
    const { sessionsUpdateHandler } = await import("../sessionsUpdateHandler");
    const response = await sessionsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1", {
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
