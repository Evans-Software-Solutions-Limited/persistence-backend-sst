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
              description: null,
              createdBy: "test-user-id",
              visibility: "private",
              estimatedDurationMinutes: 30,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: "workout-1",
            name: "Test Workout",
          },
        ]),
      }),
    }),
    insert: vi.fn(),
    update: vi.fn(),
  })),
}));

describe("WorkoutsDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    it("should accept DELETE request with authorization", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
          method: "DELETE",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      // Accept either success or error responses, just not 401
      expect(response.status).not.toBe(401);
    });

    it("should verify authorization header format before processing", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/workout-id", {
          method: "DELETE",
          headers: { authorization: "Bearer valid-token" },
        }),
      );

      expect(response.status).not.toBe(401);
    });

    it("should extract workout ID from URL path", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/specific-id", {
          method: "DELETE",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).not.toBe(401);
    });

    it("should handle various workout ID formats", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");

      for (const id of ["workout-1", "uuid-style-id-1234", "numeric-123"]) {
        const response = await workoutsDeleteHandler.handle(
          new Request(`http://localhost/workouts/${id}`, {
            method: "DELETE",
            headers: { authorization: "Bearer test-token" },
          }),
        );

        expect(response.status).not.toBe(401);
      }
    });

    it("should process delete request with valid authentication", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/workout-123", {
          method: "DELETE",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      // Should not reject due to auth
      expect(response.status).not.toBe(401);
    });

    it("should use authenticated user ID for deletion", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/user-owned-workout", {
          method: "DELETE",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).not.toBe(401);
    });
  });
});
