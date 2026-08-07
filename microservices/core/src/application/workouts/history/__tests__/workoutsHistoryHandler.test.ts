/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const assertEntitlementMock = vi.hoisted(() => vi.fn());

const workoutRepositoryMocks = {
  getById: vi.fn(),
  getHistory: vi.fn(),
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

const sampleHistory = {
  completedCount: 12,
  lastCompletedAt: "2026-03-21T10:00:00.000Z",
  avgDurationSeconds: 2640,
  lastSession: {
    completedAt: "2026-03-21T10:00:00.000Z",
    totalVolumeKg: 6240,
    durationSeconds: 2820,
  },
};

describe("WorkoutsHistoryHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    workoutRepositoryMocks.getById.mockResolvedValue({
      id: "wo-1",
      variationKind: null,
    });
    workoutRepositoryMocks.getHistory.mockResolvedValue(sampleHistory);
  });

  it("requires authentication", async () => {
    const { workoutsHistoryHandler } =
      await import("../workoutsHistoryHandler");
    const response = await workoutsHistoryHandler.handle(
      new Request("http://localhost/workouts/wo-1/history", { method: "GET" }),
    );
    expect(response.status).toBe(401);
    expect(workoutRepositoryMocks.getHistory).not.toHaveBeenCalled();
  });

  it("returns the history envelope for a readable workout", async () => {
    const { workoutsHistoryHandler } =
      await import("../workoutsHistoryHandler");
    const response = await workoutsHistoryHandler.handle(
      new Request("http://localhost/workouts/wo-1/history", {
        method: "GET",
        headers: { authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: sampleHistory });
    expect(workoutRepositoryMocks.getHistory).toHaveBeenCalledWith(
      "wo-1",
      "test-user-id",
    );
  });

  it("402s before exposing an adapted workout's history after entitlement loss", async () => {
    workoutRepositoryMocks.getById.mockResolvedValue({
      id: "wo-1",
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
    const { workoutsHistoryHandler } =
      await import("../workoutsHistoryHandler");
    const app = new Elysia().use(coreErrorHandler).use(workoutsHistoryHandler);

    const response = await app.handle(
      new Request("http://localhost/workouts/wo-1/history", {
        headers: { authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(402);
    expect(workoutRepositoryMocks.getHistory).not.toHaveBeenCalled();
  });

  it("returns 404 when the repo returns null (not found / not readable)", async () => {
    workoutRepositoryMocks.getById.mockResolvedValue(null);
    workoutRepositoryMocks.getHistory.mockResolvedValue(null);
    const { workoutsHistoryHandler } =
      await import("../workoutsHistoryHandler");
    const response = await workoutsHistoryHandler.handle(
      new Request("http://localhost/workouts/wo-x/history", {
        method: "GET",
        headers: { authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as any;
    expect(body.error).toBe("Workout not found");
  });

  it("passes the empty-state history straight through (never done)", async () => {
    const empty = {
      completedCount: 0,
      lastCompletedAt: null,
      avgDurationSeconds: null,
      lastSession: null,
    };
    workoutRepositoryMocks.getHistory.mockResolvedValue(empty);
    const { workoutsHistoryHandler } =
      await import("../workoutsHistoryHandler");
    const response = await workoutsHistoryHandler.handle(
      new Request("http://localhost/workouts/wo-1/history", {
        method: "GET",
        headers: { authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: empty });
  });
});
