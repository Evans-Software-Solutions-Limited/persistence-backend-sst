/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { getById: vi.fn(), getExerciseSets: vi.fn() };

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

describe("SetsGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExerciseSets.mockResolvedValue([
      {
        id: "set-1",
        sessionExerciseId: "se-1",
        setNumber: 1,
        reps: 10,
        weightKg: "50",
        createdAt: new Date(),
      },
    ]);
  });

  it("should require authentication", async () => {
    const { setsGetHandler } = await import("../setsGetHandler");
    const response = await setsGetHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se-1/sets", {
        method: "GET",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 404 when session not found", async () => {
    mocks.getById.mockResolvedValue(null);
    const { setsGetHandler } = await import("../setsGetHandler");
    const response = await setsGetHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se-1/sets", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("should return 404 when exercise not found in session", async () => {
    mocks.getById.mockResolvedValue({ id: "s1", exercises: [] });
    const { setsGetHandler } = await import("../setsGetHandler");
    const response = await setsGetHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se-1/sets", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("should return 200 with sets for authenticated user", async () => {
    mocks.getById.mockResolvedValue({
      id: "s1",
      exercises: [
        {
          id: "se-1",
          sessionId: "s1",
          exerciseId: "ex1",
          sortOrder: 1,
          notes: null,
          createdAt: new Date(),
        },
      ],
    });
    const { setsGetHandler } = await import("../setsGetHandler");
    const response = await setsGetHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/se-1/sets", {
        method: "GET",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data).toHaveProperty("data");
    expect(Array.isArray(data.data)).toBe(true);
  });
});
