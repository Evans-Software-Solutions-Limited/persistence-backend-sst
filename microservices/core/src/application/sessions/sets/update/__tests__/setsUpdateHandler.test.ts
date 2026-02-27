/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { getById: vi.fn(), updateSet: vi.fn() };

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

describe("SetsUpdateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockResolvedValue({
      id: "set-1",
      sessionExerciseId: "se-1",
      setNumber: 1,
      reps: 12,
      weightKg: "55",
      createdAt: new Date(),
    });
  });

  it("should require authentication", async () => {
    const { setsUpdateHandler } = await import("../setsUpdateHandler");
    const response = await setsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/ex1/sets/set1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("should return 404 when session not found", async () => {
    mocks.getById.mockResolvedValue(null);
    const { setsUpdateHandler } = await import("../setsUpdateHandler");
    const response = await setsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/ex1/sets/set1", {
        method: "PATCH",
        body: JSON.stringify({ reps: 12 }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("should return 400 when no valid fields provided", async () => {
    mocks.getById.mockResolvedValue({ id: "s1", exercises: [] });
    const { setsUpdateHandler } = await import("../setsUpdateHandler");
    const response = await setsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/ex1/sets/set1", {
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

  it("should return 404 when set not found", async () => {
    mocks.getById.mockResolvedValue({ id: "s1", exercises: [] });
    mocks.updateSet.mockResolvedValue(null);
    const { setsUpdateHandler } = await import("../setsUpdateHandler");
    const response = await setsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/ex1/sets/set1", {
        method: "PATCH",
        body: JSON.stringify({ reps: 12 }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("should return 200 on successful update", async () => {
    mocks.getById.mockResolvedValue({ id: "s1", exercises: [] });
    const { setsUpdateHandler } = await import("../setsUpdateHandler");
    const response = await setsUpdateHandler.handle(
      new Request("http://localhost/sessions/s1/exercises/ex1/sets/set1", {
        method: "PATCH",
        body: JSON.stringify({ reps: 12 }),
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as any;
    expect(data).toHaveProperty("data");
    expect(data.data.reps).toBe(12);
  });
});
