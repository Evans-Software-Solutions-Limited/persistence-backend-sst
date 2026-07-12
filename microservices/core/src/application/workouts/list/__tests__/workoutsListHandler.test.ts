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

const baseWorkout = {
  id: "workout-1",
  name: "Test Workout",
  description: null,
  createdBy: "test-user-id",
  visibility: "private" as const,
  estimatedDurationMinutes: 30,
  createdAt: new Date(),
  updatedAt: new Date(),
  exercises: [],
};

describe("WorkoutsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workoutRepositoryMocks.list.mockResolvedValue({
      workouts: [baseWorkout],
      total: 1,
      quota: { used: 1, limit: 50 },
    });
  });

  describe("unauthenticated requests", () => {
    it("should require authentication to list workouts", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts", { method: "GET" }),
      );
      expect(response.status).toBe(401);
    });

    it("should return 422 for non-numeric limit", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?limit=abc", { method: "GET" }),
      );
      expect(response.status).toBe(422);
    });

    it("should return 422 for non-numeric offset", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?offset=xyz", { method: "GET" }),
      );
      expect(response.status).toBe(422);
    });
  });

  describe("authenticated requests", () => {
    it("should return 200 + double-envelope { data, meta } for type=mine", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
      expect(body.meta.quota).toEqual({ used: 1, limit: 50 });
    });

    it("should pass type, limit, offset through to repository", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      await workoutsListHandler.handle(
        new Request(
          "http://localhost/workouts?type=assigned&limit=5&offset=10",
          {
            method: "GET",
            headers: { authorization: "Bearer test-token" },
          },
        ),
      );

      expect(workoutRepositoryMocks.list).toHaveBeenCalledWith("test-user-id", {
        type: "assigned",
        limit: 5,
        offset: 10,
        ownerLibraryOnly: false,
      });
    });

    it("passes ownerLibraryOnly through to the repository when set", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      await workoutsListHandler.handle(
        new Request(
          "http://localhost/workouts?type=mine&ownerLibraryOnly=true",
          {
            method: "GET",
            headers: { authorization: "Bearer test-token" },
          },
        ),
      );

      expect(workoutRepositoryMocks.list).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ type: "mine", ownerLibraryOnly: true }),
      );
    });

    it("defaults ownerLibraryOnly to false when the param is absent", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      await workoutsListHandler.handle(
        new Request("http://localhost/workouts?type=mine", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(workoutRepositoryMocks.list).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ ownerLibraryOnly: false }),
      );
    });

    it("should default to type=mine when type is omitted", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      await workoutsListHandler.handle(
        new Request("http://localhost/workouts", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(workoutRepositoryMocks.list).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ type: "mine" }),
      );
    });

    it("should omit meta.quota in envelope when type=default", async () => {
      workoutRepositoryMocks.list.mockResolvedValue({
        workouts: [],
        total: 0,
        // no quota
      });
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?type=default", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      const body = (await response.json()) as any;
      expect(body.meta.quota).toBeUndefined();
      expect(body.meta.pagination.total).toBe(0);
    });

    it("should omit meta.quota when type=assigned", async () => {
      workoutRepositoryMocks.list.mockResolvedValue({
        workouts: [],
        total: 0,
      });
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?type=assigned", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      const body = (await response.json()) as any;
      expect(body.meta.quota).toBeUndefined();
    });

    it("should reject invalid type values with 422", async () => {
      const { workoutsListHandler } = await import("../workoutsListHandler");
      const response = await workoutsListHandler.handle(
        new Request("http://localhost/workouts?type=bogus", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );
      expect(response.status).toBe(422);
    });
  });
});
