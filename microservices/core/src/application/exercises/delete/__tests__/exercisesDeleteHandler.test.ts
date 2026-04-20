/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const exerciseRepositoryMocks = {
  delete: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  getMuscleGroups: vi.fn(),
  getEquipmentTypes: vi.fn(),
  getCategories: vi.fn(),
};

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "user-1",
      email: "user-1@example.com",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-1" }),
}));

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => exerciseRepositoryMocks),
}));

describe("ExercisesDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    const { exercisesDeleteHandler } =
      await import("../exercisesDeleteHandler");
    const response = await exercisesDeleteHandler.handle(
      new Request("http://localhost/exercises/ex-1", { method: "DELETE" }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 204 when delete succeeds", async () => {
    exerciseRepositoryMocks.delete.mockResolvedValue(true);
    const { exercisesDeleteHandler } =
      await import("../exercisesDeleteHandler");
    const response = await exercisesDeleteHandler.handle(
      new Request("http://localhost/exercises/ex-1", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(204);
  });

  it("returns 404 (not 403) when non-owner tries to delete", async () => {
    exerciseRepositoryMocks.delete.mockResolvedValue(false);
    const { exercisesDeleteHandler } =
      await import("../exercisesDeleteHandler");
    const response = await exercisesDeleteHandler.handle(
      new Request("http://localhost/exercises/ex-of-other", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
    expect(response.status).not.toBe(403);
  });

  it("returns 404 when exercise does not exist", async () => {
    exerciseRepositoryMocks.delete.mockResolvedValue(false);
    const { exercisesDeleteHandler } =
      await import("../exercisesDeleteHandler");
    const response = await exercisesDeleteHandler.handle(
      new Request("http://localhost/exercises/does-not-exist", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("calls repository with id and authenticated userId", async () => {
    exerciseRepositoryMocks.delete.mockResolvedValue(true);
    const { exercisesDeleteHandler } =
      await import("../exercisesDeleteHandler");
    await exercisesDeleteHandler.handle(
      new Request("http://localhost/exercises/ex-42", {
        method: "DELETE",
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(exerciseRepositoryMocks.delete).toHaveBeenCalledWith(
      "ex-42",
      "user-1",
    );
  });
});
