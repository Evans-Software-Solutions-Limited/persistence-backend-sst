/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { list: vi.fn() };

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

describe("SessionsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([
      {
        id: "session-1",
        userId: "test-user-id",
        workoutId: "w1",
        name: "Test Session",
        status: "in_progress",
        startedAt: new Date(),
        createdAt: new Date(),
      },
    ]);
  });

  it("should require authentication", async () => {
    const { sessionsListHandler } = await import("../sessionsListHandler");
    const response = await sessionsListHandler.handle(
      new Request("http://localhost/sessions", {
        method: "GET",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 with sessions list", async () => {
    const { sessionsListHandler } = await import("../sessionsListHandler");
    const response = await sessionsListHandler.handle(
      new Request("http://localhost/sessions", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data).toHaveProperty("data");
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("should support pagination with limit and offset", async () => {
    const { sessionsListHandler } = await import("../sessionsListHandler");
    await sessionsListHandler.handle(
      new Request("http://localhost/sessions?limit=10&offset=5", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      limit: 10,
      offset: 5,
      status: undefined,
    });
  });

  it("should use default limit and offset", async () => {
    const { sessionsListHandler } = await import("../sessionsListHandler");
    await sessionsListHandler.handle(
      new Request("http://localhost/sessions", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      limit: 20,
      offset: 0,
      status: undefined,
    });
  });

  it("forwards the ?status=in_progress filter to the repository", async () => {
    const { sessionsListHandler } = await import("../sessionsListHandler");
    await sessionsListHandler.handle(
      new Request("http://localhost/sessions?status=in_progress", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith("test-user-id", {
      limit: 20,
      offset: 0,
      status: "in_progress",
    });
  });

  it("rejects unknown status values via the query schema", async () => {
    const { sessionsListHandler } = await import("../sessionsListHandler");
    const response = await sessionsListHandler.handle(
      new Request("http://localhost/sessions?status=banana", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    // Elysia returns 422 for invalid query params per the t.Union schema.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
