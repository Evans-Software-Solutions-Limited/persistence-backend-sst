/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const assertEntitlementMock = vi.hoisted(() => vi.fn());

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
vi.mock("../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../entitlement/assertEntitlement")
  >("../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});

describe("WorkoutsDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    workoutRepositoryMocks.delete.mockResolvedValue(true);
  });

  describe("unauthenticated requests", () => {
    it("should require authentication", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/123", { method: "DELETE" }),
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

    it("should reject invalid authorization header", async () => {
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
    it("402s before deleting a retained adapted workout after entitlement loss", async () => {
      workoutRepositoryMocks.getById.mockResolvedValue({
        id: "workout-1",
        variationKind: "loadout",
      });
      assertEntitlementMock.mockResolvedValue({
        allowed: false,
        reason: "expired",
        currentTier: "free",
        upgradeTo: "premium_plus",
        upgradePriceMonthly: 1999,
      });
      const { default: Elysia } = await import("elysia");
      const { coreErrorHandler } =
        await import("../../../../shared/errorHandler");
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const app = new Elysia().use(coreErrorHandler).use(workoutsDeleteHandler);

      const response = await app.handle(
        new Request("http://localhost/workouts/workout-1", {
          method: "DELETE",
          headers: { authorization: "Bearer test-token" },
        }),
      );

      expect(response.status).toBe(402);
      expect(workoutRepositoryMocks.delete).not.toHaveBeenCalled();
    });
    it("should return 204 on successful delete", async () => {
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

    it("should return 404 when repo returns false (not found / not owner)", async () => {
      workoutRepositoryMocks.delete.mockResolvedValue(false);
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      const response = await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/other-users-workout", {
          method: "DELETE",
          headers: { authorization: "Bearer test-token" },
        }),
      );
      expect(response.status).toBe(404);
    });

    it("should pass id and userId through to repo", async () => {
      const { workoutsDeleteHandler } =
        await import("../workoutsDeleteHandler");
      await workoutsDeleteHandler.handle(
        new Request("http://localhost/workouts/workout-xyz", {
          method: "DELETE",
          headers: { authorization: "Bearer test-token" },
        }),
      );
      expect(workoutRepositoryMocks.delete).toHaveBeenCalledWith(
        "workout-xyz",
        "test-user-id",
      );
    });
  });
});
