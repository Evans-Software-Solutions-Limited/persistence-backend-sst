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

describe("WorkoutsDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set default mock to return true (successful delete)
    workoutRepositoryMocks.delete.mockResolvedValue(true);
  });

  describe("unauthenticated requests", () => {
    it("should require authentication to delete", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/123", {
          method: "DELETE",
        }),
      );

      expect(response.status).toBe(401);
    });

    it("should reject without authorization header", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
          method: "DELETE",
        }),
      );

      expect(response.status).toBe(401);
    });

    it("should reject with invalid authorization header format", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
          method: "DELETE",
          headers: { authorization: "InvalidToken" },
        }),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("authenticated requests", () => {
    it("should return 204 when workout deleted successfully", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "DELETE",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(204);
    });

    it("should return 403 when user does not own the workout", async () => {
      workoutRepositoryMocks.delete.mockResolvedValue(false);
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/other-users-workout", {
          method: "DELETE",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(403);
    });
  });
});
