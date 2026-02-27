/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { getById: vi.fn(), removeExercise: vi.fn() };

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

describe("SessionExercisesDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.removeExercise.mockResolvedValue(true);
  });

  it("should require authentication", async () => {
    const { sessionExercisesDeleteHandler } =
      await import("../sessionExercisesDeleteHandler");
    const response = await sessionExercisesDeleteHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se1", {
        method: "DELETE",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 200 on successful delete", async () => {
    mocks.getById.mockResolvedValue({
      id: "s1",
      exercises: [{ id: "se1", sessionId: "s1", exerciseId: "ex1", sortOrder: 1, notes: null, createdAt: new Date() }],
    });
    const { sessionExercisesDeleteHandler } =
      await import("../sessionExercisesDeleteHandler");
    const response = await sessionExercisesDeleteHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("should return 404 when session not found", async () => {
    mocks.getById.mockResolvedValue(null);
    const { sessionExercisesDeleteHandler } =
      await import("../sessionExercisesDeleteHandler");
    const response = await sessionExercisesDeleteHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("should return 404 when exercise not found", async () => {
    mocks.getById.mockResolvedValue({ id: "s1", exercises: [] });
    mocks.removeExercise.mockResolvedValue(false);
    const { sessionExercisesDeleteHandler } =
      await import("../sessionExercisesDeleteHandler");
    const response = await sessionExercisesDeleteHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });
});
