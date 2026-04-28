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

describe("WorkoutsCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workoutRepositoryMocks.createWithExercises.mockImplementation(
      async (userId: string, data: any) => ({
        id: "workout-1",
        createdBy: userId,
        name: data.name,
        description: data.description ?? null,
        visibility: data.visibility ?? "private",
        estimatedDurationMinutes: data.estimatedDurationMinutes ?? 30,
        exercises: (data.exercises ?? []).map((ex: any, idx: number) => ({
          id: `we-${idx}`,
          ...ex,
          supersetGroup: ex.supersetGroup ?? null,
          targetSets: ex.targetSets ?? null,
          targetRepsMin: ex.targetRepsMin ?? 1,
          targetRepsMax: ex.targetRepsMax ?? 1,
          targetDurationSeconds: ex.targetDurationSeconds ?? null,
          restSeconds: ex.restSeconds ?? 90,
          notes: ex.notes ?? null,
          exercise: null,
        })),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  describe("unauthenticated requests", () => {
    it("should require authentication", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Test" }),
        }),
      );
      expect(response.status).toBe(401);
    });

    it("should reject invalid visibility values with 422", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "X", visibility: "secret" }),
        }),
      );
      expect(response.status).toBe(422);
    });
  });

  describe("authenticated metadata-only requests", () => {
    it("should create with valid data and return 201 single-envelope", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            name: "My Workout",
            description: "Test",
            visibility: "private",
            estimatedDurationMinutes: 45,
          }),
        }),
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as any;
      expect(body.data.id).toBe("workout-1");
      expect(body.data.name).toBe("My Workout");
    });

    it("should default visibility to private and duration to 30", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "Defaults" }),
        }),
      );
      const body = (await response.json()) as any;
      expect(body.data.visibility).toBe("private");
      expect(body.data.estimatedDurationMinutes).toBe(30);
    });

    it("should set createdBy to authenticated user", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "X" }),
        }),
      );
      const body = (await response.json()) as any;
      expect(body.data.createdBy).toBe("test-user-id");
    });

    it("should reject empty workout name with 400", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "" }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it("should reject whitespace-only workout name with 400", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "   " }),
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("nested-exercise requests", () => {
    it("should pass nested exercises to createWithExercises", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            name: "With Exercises",
            exercises: [
              {
                exerciseId: "ex-1",
                sortOrder: 0,
                supersetGroup: 1,
                targetSets: 4,
                targetRepsMin: 8,
                targetRepsMax: 12,
              },
              {
                exerciseId: "ex-2",
                sortOrder: 1,
                supersetGroup: 1,
                targetSets: 4,
                targetRepsMin: 8,
                targetRepsMax: 12,
              },
            ],
          }),
        }),
      );

      expect(workoutRepositoryMocks.createWithExercises).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({
          name: "With Exercises",
          exercises: expect.arrayContaining([
            expect.objectContaining({
              exerciseId: "ex-1",
              supersetGroup: 1,
            }),
            expect.objectContaining({
              exerciseId: "ex-2",
              supersetGroup: 1,
            }),
          ]),
        }),
      );
    });

    it("should return 400 when targetRepsMin > targetRepsMax", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            name: "Invalid",
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

    it("should default exercises to [] when omitted", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "No exercises" }),
        }),
      );

      expect(workoutRepositoryMocks.createWithExercises).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ exercises: [] }),
      );
    });
  });
});
