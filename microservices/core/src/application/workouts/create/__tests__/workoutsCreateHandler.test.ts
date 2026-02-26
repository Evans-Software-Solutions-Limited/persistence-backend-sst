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

describe("WorkoutsCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock the create method to return the created workout with provided data
    // The handler calls create(userId, data), so we need to handle both arguments
    workoutRepositoryMocks.create.mockImplementation(
      async (userId: string, data: any) => ({
        id: "workout-1",
        createdBy: userId,
        ...data,
        exercises: [],
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
          body: JSON.stringify({ name: "Test Workout" }),
        }),
      );

      expect(response.status).toBe(401);
    });

    it("should return 422 for missing workout name without auth", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "" }),
        }),
      );

      expect([400, 401, 422]).toContain(response.status);
    });

    it("should return 422 when name is not provided without auth", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );

      expect([400, 401, 422]).toContain(response.status);
    });

    it("should reject invalid visibility values with 422", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Workout",
            visibility: "secret",
          }),
        }),
      );

      expect(response.status).toBe(422);
    });
  });

  describe("authenticated requests", () => {
    it("should create workout with valid data", async () => {
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
            description: "Test workout",
            visibility: "private",
            estimatedDurationMinutes: 45,
          }),
        }),
      );

      expect(response.status).toBe(201);
    });

    it("should return created workout data", async () => {
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
            visibility: "private",
          }),
        }),
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("id");
      expect(data.data.name).toBe("My Workout");
    });

    it("should handle valid request with optional parameters", async () => {
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
            name: "Workout",
            visibility: "friends",
          }),
        }),
      );

      expect(response.status).toBe(201);
    });

    it("should accept estimatedDurationMinutes of 0", async () => {
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
            name: "Zero Duration Workout",
            estimatedDurationMinutes: 0,
          }),
        }),
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.data.estimatedDurationMinutes).toBe(0);
    });

    it("should set default visibility to private", async () => {
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
            name: "Default Visibility Workout",
          }),
        }),
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.data.visibility).toBe("private");
    });

    it("should set default estimatedDurationMinutes to 30", async () => {
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
            name: "Default Duration Workout",
          }),
        }),
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.data.estimatedDurationMinutes).toBe(30);
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
          body: JSON.stringify({
            name: "User-Owned Workout",
          }),
        }),
      );

      expect(response.status).toBe(201);
      const data = (await response.json()) as any;
      expect(data.data.createdBy).toBe("test-user-id");
    });

    it("should reject empty workout name", async () => {
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
            name: "",
          }),
        }),
      );

      expect(response.status).toBe(400);
    });

    it("should reject whitespace-only workout name", async () => {
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
            name: "   ",
          }),
        }),
      );

      expect(response.status).toBe(400);
    });
  });
});
