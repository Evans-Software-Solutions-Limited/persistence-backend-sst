/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock repository that can be controlled from tests
const workoutRepositoryMocks = {
  getById: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

// Mock Supabase auth utilities
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

// Mock WorkoutRepository class - this is what the service will instantiate
vi.mock("../../../repositories/workoutRepository", () => ({
  WorkoutRepository: vi.fn().mockImplementation(() => workoutRepositoryMocks),
}));

describe("WorkoutsUpdateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workoutRepositoryMocks.update.mockResolvedValue({
      id: "workout-1",
      name: "Updated Workout",
      userId: "test-user-id",
      description: null,
      visibility: "private",
      estimatedDurationMinutes: 45,
      exercises: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  describe("unauthenticated requests", () => {
    it("should require authentication to update workout", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/123", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated Workout" }),
        }),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("authenticated requests", () => {
    it("should update workout with valid data", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "New Name" }),
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should return updated workout data", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            name: "Updated Workout",
            description: "New description",
            visibility: "public",
            estimatedDurationMinutes: 60,
          }),
        }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("id");
    });

    it("should handle partial updates", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-123", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "Just Update Name" }),
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should return 403 when update fails (not owned by user)", async () => {
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
          body: JSON.stringify({ name: "Unauthorized Update" }),
        }),
      );

      expect(response.status).toBe(403);
    });

    it("should reject empty name", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
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

    it("should accept all visibility values", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");

      for (const visibility of ["private", "friends", "public"]) {
        const response = await workoutsUpdateHandler.handle(
          new Request("http://localhost/workouts/workout-id", {
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

    it("should accept estimatedDurationMinutes update", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ estimatedDurationMinutes: 60 }),
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should handle description update", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ description: "New description" }),
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should reject whitespace-only name", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
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

    it("should update with name and description", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            name: "Updated Name",
            description: "Updated Description",
          }),
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should update with visibility and duration", async () => {
      const { workoutsUpdateHandler } =
        await import("../workoutsUpdateHandler");
      const response = await workoutsUpdateHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            visibility: "friends",
            estimatedDurationMinutes: 90,
          }),
        }),
      );

      expect(response.status).toBe(200);
    });
  });
});
