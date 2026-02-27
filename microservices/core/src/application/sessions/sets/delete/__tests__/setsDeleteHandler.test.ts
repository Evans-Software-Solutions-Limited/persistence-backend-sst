/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { getSetInSession: vi.fn(), deleteSet: vi.fn() };

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

vi.mock("../../../../repositories/sessionRepository", () => ({
  SessionRepository: vi.fn().mockImplementation(() => mocks),
}));

describe("SetsDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteSet.mockResolvedValue(true);
  });

  it("should require authentication", async () => {
    const { setsDeleteHandler } = await import("../setsDeleteHandler");
    const response = await setsDeleteHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se-1/sets/set1", {
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 404 when set not in session (hierarchy)", async () => {
    mocks.getSetInSession.mockResolvedValue(null);
    const { setsDeleteHandler } = await import("../setsDeleteHandler");
    const response = await setsDeleteHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se-1/sets/set1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("should return 404 when deleteSet fails", async () => {
    mocks.getSetInSession.mockResolvedValue({
      id: "set1",
      sessionExerciseId: "se-1",
      setNumber: 1,
      createdAt: new Date(),
    });
    mocks.deleteSet.mockResolvedValue(false);
    const { setsDeleteHandler } = await import("../setsDeleteHandler");
    const response = await setsDeleteHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se-1/sets/set1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("should return 200 on successful delete", async () => {
    mocks.getSetInSession.mockResolvedValue({
      id: "set1",
      sessionExerciseId: "se-1",
      setNumber: 1,
      createdAt: new Date(),
    });
    mocks.deleteSet.mockResolvedValue(true);
    const { setsDeleteHandler } = await import("../setsDeleteHandler");
    const response = await setsDeleteHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se-1/sets/set1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data).toHaveProperty("data");
  });
});
