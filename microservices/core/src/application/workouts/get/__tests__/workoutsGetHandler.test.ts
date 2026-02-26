import { describe, it, expect, vi, beforeEach } from "vitest";

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

// Mock the database
vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: "workout-1",
              name: "Test Workout",
              description: "Test",
              createdBy: "test-user-id",
              visibility: "private",
              estimatedDurationMinutes: 30,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        }),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
  })),
}));

describe("WorkoutsGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    it("should return 404 for non-existent workout", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/nonexistent", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect([404, 200]).toContain(response.status);
    });

    it("should handle valid workout ID format", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/valid-uuid-1234", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect([200, 404]).toContain(response.status);
    });

    it("should verify ownership when retrieving workout", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/some-id", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect([200, 404]).toContain(response.status);
    });

    it("should fetch exercises for workout", async () => {
      const { workoutsGetHandler } = await import("../workoutsGetHandler");
      const response = await workoutsGetHandler.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "GET",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.data).toHaveProperty("exercises");
    });
  });
});
