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
    // Return undefined to let the pipeline continue
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

// Mock WorkoutRepository class - this is what the service will instantiate
vi.mock("../../../repositories/workoutRepository", () => ({
  WorkoutRepository: vi.fn().mockImplementation(() => workoutRepositoryMocks),
}));

describe("WorkoutsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workoutRepositoryMocks.list.mockResolvedValue([
      {
        id: "workout-1",
        name: "Test Workout",
        userId: "test-user-id",
        description: "A test workout",
        visibility: "private",
        estimatedDurationMinutes: 30,
        exercises: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  });

  describe("unauthenticated requests", () => {
    it("should require authentication to list workouts", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(401);
    });

    it("should return 422 for non-numeric limit", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?limit=abc", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(422);
    });

    it("should return 422 for non-numeric offset", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?offset=xyz", {
          method: "GET",
        }),
      );

      expect(response.status).toBe(422);
    });
  });

  describe("authenticated requests", () => {
    it("should return 200 for authenticated user with valid token", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should return array of workouts for authenticated user", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(Array.isArray(data.data)).toBe(true);
    });

    it("should accept pagination parameters", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?limit=10&offset=0", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should accept type parameter with valid values", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?type=mine", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should accept assigned type parameter", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?type=assigned", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should accept default type parameter", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?type=default", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
    });

    it("should handle valid pagination parameters", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?limit=20&offset=10", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
    });
  });
});
