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

const updatedWorkout = {
  id: "workout-1",
  name: "Updated Workout",
  description: null,
  createdBy: "test-user-id",
  visibility: "private" as const,
  estimatedDurationMinutes: 45,
  exercises: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("WorkoutsUpdateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workoutRepositoryMocks.update.mockResolvedValue(updatedWorkout);
  });

  describe("unauthenticated requests", () => {
    it("should require authentication", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/123", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "X" }),
        }),
      );
      expect(response.status).toBe(401);
    });
  });

  describe("authenticated metadata updates", () => {
    it("should return 200 single-envelope on success", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "Updated Workout" }),
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body.data.id).toBe("workout-1");
    });

    it("should return 404 when repository returns null (not owner / not found)", async () => {
      workoutRepositoryMocks.update.mockResolvedValue(null);
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/other-users-workout", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "Unauthorized" }),
        }),
      );
      expect(response.status).toBe(404);
    });

    it("should reject empty name with 400", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "" }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it("should reject whitespace-only name with 400", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "   " }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it("should accept all visibility enum values", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      for (const visibility of ["private", "friends", "public"]) {
        const response = await workoutsUpdateHandler.handle(
          new Request("http://localhost/workouts/workout-1", {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              authorization: "Bearer test-token",
            },
            body: JSON.stringify({ visibility }),
          }),
        );
        expect(response.status).toBe(200);
      }
    });

    it("should pass partial metadata fields through to repo", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            name: "X",
            description: "D",
            estimatedDurationMinutes: 60,
          }),
        }),
      );

      expect(workoutRepositoryMocks.update).toHaveBeenCalledWith(
        "workout-1",
        "test-user-id",
        expect.objectContaining({
          name: "X",
          description: "D",
          estimatedDurationMinutes: 60,
        }),
      );
    });
  });

  describe("nested-exercise updates", () => {
    it("should pass exercises array through to repo for full-replacement", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            exercises: [
              {
                exerciseId: "ex-1",
                sortOrder: 0,
                targetRepsMin: 5,
                targetRepsMax: 8,
              },
            ],
          }),
        }),
      );

      expect(workoutRepositoryMocks.update).toHaveBeenCalledWith(
        "workout-1",
        "test-user-id",
        expect.objectContaining({
          exercises: expect.arrayContaining([
            expect.objectContaining({ exerciseId: "ex-1" }),
          ]),
        }),
      );
    });

    it("should accept empty exercises array (full clear)", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ exercises: [] }),
        }),
      );

      expect(workoutRepositoryMocks.update).toHaveBeenCalledWith(
        "workout-1",
        "test-user-id",
        expect.objectContaining({ exercises: [] }),
      );
    });

    it("should return 400 when targetRepsMin > targetRepsMax in any exercise", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            exercises: [
              {
                exerciseId: "ex-1",
                sortOrder: 0,
                targetRepsMin: 12,
                targetRepsMax: 8,
              },
            ],
          }),
        }),
      );
      expect(response.status).toBe(400);
    });
  });
});
