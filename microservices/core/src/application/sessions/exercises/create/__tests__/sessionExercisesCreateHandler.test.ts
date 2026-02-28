/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { getById: vi.fn(), addExercise: vi.fn() };

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

describe("SessionExercisesCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addExercise.mockResolvedValue({
      id: "se-1",
      sessionId: "s1",
      exerciseId: "ex1",
      sortOrder: 1,
      notes: null,
      createdAt: new Date(),
    });
  });

  it("should require authentication", async () => {
    const { sessionExercisesCreateHandler } =
      await import("../sessionExercisesCreateHandler");
    const response = await sessionExercisesCreateHandler.handle(
      new Request("http://localhost/sessions/s1/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: "ex1" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 404 when session not found", async () => {
    mocks.getById.mockResolvedValue(null);
    const { sessionExercisesCreateHandler } =
      await import("../sessionExercisesCreateHandler");
    const response = await sessionExercisesCreateHandler.handle(
      new Request("http://localhost/sessions/s1/exercises", {
        method: "POST",
        body: JSON.stringify({ exerciseId: "ex1" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("should return 201 on successful creation", async () => {
    mocks.getById.mockResolvedValue({ id: "s1", exercises: [] });
    const { sessionExercisesCreateHandler } =
      await import("../sessionExercisesCreateHandler");
    const response = await sessionExercisesCreateHandler.handle(
      new Request("http://localhost/sessions/s1/exercises", {
        method: "POST",
        body: JSON.stringify({ exerciseId: "ex1" }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(201);
  });
});
