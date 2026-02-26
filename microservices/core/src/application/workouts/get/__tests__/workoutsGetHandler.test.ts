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

describe("WorkoutsGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workoutRepositoryMocks.getById.mockResolvedValue({
      id: "workout-1",
      name: "Test Workout",
      userId: "test-user-id",
      description: null,
      visibility: "private",
      estimatedDurationMinutes: 30,
      exercises: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  describe("unauthenticated requests", () => {
    it("should require authentication to retrieve workout", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/123", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(401);
    });
  });

  describe("authenticated requests", () => {
    it("should return 200 for authenticated user getting their workout", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should return workout data in response", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("id");
    });

    it("should return 404 when workout not found", async () => {
      workoutRepositoryMocks.getById.mockResolvedValue(null);
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/nonexistent-id", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(404);
    });
  });
});
