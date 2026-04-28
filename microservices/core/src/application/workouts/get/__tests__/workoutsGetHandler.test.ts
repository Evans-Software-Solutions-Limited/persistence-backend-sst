/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const workoutRepositoryMocks = {
  getById: vi.fn(),
  list: vi.fn(),
  createWithExercises: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getQuota: vi.fn(),
};

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
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

vi.mock("../../../repositories/workoutRepository", () => ({
  WorkoutRepository: vi.fn().mockImplementation(() => workoutRepositoryMocks),
}));

describe("WorkoutsGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workoutRepositoryMocks.getById.mockResolvedValue({
      id: "workout-1",
      name: "Test Workout",
      description: null,
      createdBy: "test-user-id",
      visibility: "private",
      estimatedDurationMinutes: 30,
      exercises: [
        {
          id: "we-1",
          exerciseId: "ex-1",
          sortOrder: 0,
          supersetGroup: null,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          targetDurationSeconds: null,
          restSeconds: 90,
          notes: null,
          exercise: null,
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  describe("unauthenticated requests", () => {
    it("should require authentication", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/123", { method: "GET" }),
      );
      expect(response.status).toBe(401);
    });
  });

  describe("authenticated requests", () => {
    it("should return 200 with single-envelope { data }", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.data).toBeDefined();
      expect(body.data.id).toBe("workout-1");
    });

    it("should surface supersetGroup on each nested exercise row", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );
      const body = (await response.json()) as any;
      expect(body.data.exercises[0]).toHaveProperty("supersetGroup");
      expect(body.data.exercises[0].supersetGroup).toBeNull();
    });

    it("should return 404 when repository returns null", async () => {
      workoutRepositoryMocks.getById.mockResolvedValue(null);
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/nope", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );
      expect(response.status).toBe(404);
    });

    it("should pass id and userId through to repository", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/workout-xyz", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );
      expect(workoutRepositoryMocks.getById).toHaveBeenCalledWith(
        "workout-xyz",
        "test-user-id",
      );
    });
  });
});
