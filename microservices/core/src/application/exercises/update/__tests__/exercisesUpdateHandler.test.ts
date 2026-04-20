/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const exerciseRepositoryMocks = {
  update: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  delete: vi.fn(),
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

describe("ExercisesUpdateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    const { exercisesUpdateHandler } =
      await import("../exercisesUpdateHandler");
    const response = await exercisesUpdateHandler.handle(
      new Request("http://localhost/exercises/ex-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 404 when repo returns null (non-owner OR non-existent)", async () => {
    exerciseRepositoryMocks.update.mockResolvedValue(null);
    const { exercisesUpdateHandler } =
      await import("../exercisesUpdateHandler");
    const response = await exercisesUpdateHandler.handle(
      new Request("http://localhost/exercises/ex-unknown", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer token",
        },
        body: JSON.stringify({ name: "Renamed" }),
      }),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as any;
    expect(body).toHaveProperty("error");
  });

  it("never returns 403 on non-owner — only 404", async () => {
    // Simulate a row that exists but isn't owned by caller.
    exerciseRepositoryMocks.update.mockResolvedValue(null);
    const { exercisesUpdateHandler } =
      await import("../exercisesUpdateHandler");
    const response = await exercisesUpdateHandler.handle(
      new Request("http://localhost/exercises/ex-others", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer token",
        },
        body: JSON.stringify({ name: "Hijack" }),
      }),
    );
    expect(response.status).not.toBe(403);
    expect(response.status).toBe(404);
  });

  it("rejects empty name with 400", async () => {
    const { exercisesUpdateHandler } =
      await import("../exercisesUpdateHandler");
    const response = await exercisesUpdateHandler.handle(
      new Request("http://localhost/exercises/ex-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer token",
        },
        body: JSON.stringify({ name: "   " }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects name > 100 chars with 400", async () => {
    const { exercisesUpdateHandler } =
      await import("../exercisesUpdateHandler");
    const response = await exercisesUpdateHandler.handle(
      new Request("http://localhost/exercises/ex-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer token",
        },
        body: JSON.stringify({ name: "x".repeat(101) }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("applies partial update — only sent fields reach repo", async () => {
    exerciseRepositoryMocks.update.mockResolvedValue({
      id: "ex-1",
      createdBy: "user-1",
      name: "Renamed",
      description: null,
    });
    const { exercisesUpdateHandler } =
      await import("../exercisesUpdateHandler");
    await exercisesUpdateHandler.handle(
      new Request("http://localhost/exercises/ex-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer token",
        },
        body: JSON.stringify({ name: "Renamed" }),
      }),
    );
    const [id, userId, patch] = exerciseRepositoryMocks.update.mock.calls[0];
    expect(id).toBe("ex-1");
    expect(userId).toBe("user-1");
    expect(Object.keys(patch)).toEqual(["name"]);
    expect(patch.name).toBe("Renamed");
  });

  it("maps snake_case body fields to domain casing", async () => {
    exerciseRepositoryMocks.update.mockResolvedValue({
      id: "ex-1",
      createdBy: "user-1",
    });
    const { exercisesUpdateHandler } =
      await import("../exercisesUpdateHandler");
    await exercisesUpdateHandler.handle(
      new Request("http://localhost/exercises/ex-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer token",
        },
        body: JSON.stringify({
          video_url: "https://example.com/v.mp4",
          difficulty_level: "advanced",
          primary_muscles: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
        }),
      }),
    );
    const [, , patch] = exerciseRepositoryMocks.update.mock.calls[0];
    expect(patch.videoUrl).toBe("https://example.com/v.mp4");
    expect(patch.difficultyLevel).toBe("advanced");
    expect(patch.primaryMuscles).toEqual([
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    ]);
  });

  it("returns 200 with { data } on success", async () => {
    exerciseRepositoryMocks.update.mockResolvedValue({
      id: "ex-1",
      createdBy: "user-1",
      name: "Renamed",
    });
    const { exercisesUpdateHandler } =
      await import("../exercisesUpdateHandler");
    const response = await exercisesUpdateHandler.handle(
      new Request("http://localhost/exercises/ex-1", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer token",
        },
        body: JSON.stringify({ name: "Renamed" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.data.name).toBe("Renamed");
  });
});
