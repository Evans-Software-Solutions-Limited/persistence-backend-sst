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

vi.mock("../../../repositories/sessionRepository", () => ({
  SessionRepository: vi.fn().mockImplementation(() => mocks),
}));

describe("SessionsDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.delete.mockResolvedValue(true);
  });

  it("should require authentication", async () => {
    const { sessionsDeleteHandler } = await import("../sessionsDeleteHandler");
    const response = await sessionsDeleteHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 on successful delete", async () => {
    const { sessionsDeleteHandler } = await import("../sessionsDeleteHandler");
    const response = await sessionsDeleteHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("should return 404 when session not found", async () => {
    mocks.delete.mockResolvedValue(false);
    const { sessionsDeleteHandler } = await import("../sessionsDeleteHandler");
    const response = await sessionsDeleteHandler.handle(
      new Request("http://localhost/sessions/s1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });
});
