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

vi.mock("../../../repositories/sessionRepository", () => ({
  SessionRepository: vi.fn().mockImplementation(() => mocks),
}));

describe("SessionsGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getById.mockResolvedValue({
      id: "session-1",
      userId: "test-user-id",
      workoutId: "w1",
      name: "Test Session",
      status: "in_progress",
      startedAt: new Date(),
      createdAt: new Date(),
      exercises: [],
    });
  });

  it("should require authentication", async () => {
    const { sessionsGetHandler } = await import("../sessionsGetHandler");
    const response = await sessionsGetHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "GET",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 with session data", async () => {
    const { sessionsGetHandler } = await import("../sessionsGetHandler");
    const response = await sessionsGetHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data).toHaveProperty("data");
    expect(data.data.id).toBe("session-1");
  });

  it("should return 404 when session not found", async () => {
    mocks.getById.mockResolvedValue(null);
    const { sessionsGetHandler } = await import("../sessionsGetHandler");
    const response = await sessionsGetHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });
});
