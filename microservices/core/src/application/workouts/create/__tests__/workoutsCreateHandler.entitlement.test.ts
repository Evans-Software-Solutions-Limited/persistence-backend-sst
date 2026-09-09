/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /workouts × the REAL entitlement gate.
 *
 * The sibling `workoutsCreateHandler.test.ts` mocks `assertEntitlement`
 * wholesale, so it proves the handler renders a 402 body correctly but never
 * once runs the handler and the workout-count query together. That left the
 * headline behaviour of the free-tier cap — "the 4th create is refused" —
 * asserted nowhere: the gate's own suite mocks `getDb`, and the handler's
 * suite mocks the gate.
 *
 * This file closes that seam. Only `getDb`, auth and the repository are
 * mocked; the gate itself is the real module, resolving the tier from the
 * queued rows and comparing against the queued `COUNT(*)`. So a regression
 * that stops the count from being consulted — or that resolves the tier's
 * limit wrongly — fails here even though both existing suites stay green.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

const workoutRepositoryMocks = {
  createWithExercises: vi.fn(),
  findByClientRequestId: vi.fn(async () => null),
  getQuota: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("../../../repositories/workoutRepository", () => ({
  WorkoutRepository: vi.fn().mockImplementation(() => workoutRepositoryMocks),
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) =>
    authHeader?.startsWith("Bearer ")
      ? {
          sub: "user-1",
          email: "test@example.com",
          email_verified: true,
          iat: 0,
          exp: 9999999999,
        }
      : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx: any) => ctx.user ?? { sub: "user-1" }),
}));

import { getDb } from "@persistence/db/client";

/**
 * Drizzle-shaped stub, same contract as the gate's own suite: one queued
 * row-set consumed per `.select()`, in call order. `where()` is both chainable
 * and directly thenable so the `count()` aggregate (no `.limit()`) and the
 * row reads (with one) both resolve.
 */
function makeQueueDb(queue: unknown[][]) {
  const select = vi.fn(() => {
    if (queue.length === 0) {
      throw new Error(
        "test stub exhausted: more SELECTs ran than the test queued.",
      );
    }
    const rows = queue.shift();
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const whereResult = {
      limit,
      orderBy,
      then: (resolve: (value: unknown) => void) => resolve(rows),
    };
    const where = vi.fn().mockReturnValue(whereResult);
    const leftJoin = vi.fn().mockReturnValue({ where });
    return { from: vi.fn().mockReturnValue({ where, leftJoin }) };
  });
  return { select };
}

const PROFILE_USER = [{ role: "user" }];
const FREE_TIER = [{ tierName: "free", workoutLimit: 3, priceMonthly: "0.00" }];
const PREMIUM_TIER = [
  { tierName: "premium", workoutLimit: null, priceMonthly: "16.99" },
];

/** A free user's live sub row, as the gate's join projects it. */
const FREE_SUB = [
  {
    tierName: "free",
    catalogTierName: "free",
    paymentStatus: "active",
    expiresAt: null,
    cancelledAt: null,
    metadata: null,
    workoutLimit: 3,
  },
];

async function buildApp() {
  const { default: Elysia } = await import("elysia");
  const { coreErrorHandler } = await import("../../../../shared/errorHandler");
  const { workoutsCreateHandler } = await import("../workoutsCreateHandler");
  return new Elysia().use(coreErrorHandler).use(workoutsCreateHandler);
}

function postWorkout(name: string) {
  return new Request("http://localhost/workouts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify({ name }),
  });
}

describe("POST /workouts — real entitlement gate against the real count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workoutRepositoryMocks.findByClientRequestId.mockResolvedValue(null);
    workoutRepositoryMocks.createWithExercises.mockImplementation(
      async (userId: string, data: any) => ({
        id: "workout-4",
        createdBy: userId,
        name: data.name,
        description: null,
        visibility: "private",
        estimatedDurationMinutes: 30,
        exercises: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it("402s a free user's 4th create, and never reaches the repository", async () => {
    // 3 owned, limit 3 → `count >= limit` denies. The exact case Brad hit,
    // minus the tier divergence: this is what SHOULD happen at the cap.
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, FREE_SUB, [{ value: 3 }], PREMIUM_TIER]),
    );

    const app = await buildApp();
    const response = await app.handle(postWorkout("Fourth"));

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      code: "ENTITLEMENT_DENIED",
      feature: "create_workout",
      reason: "limit",
      current_tier: "free",
      upgrade_to: "premium",
      upgrade_price_monthly: 16.99,
    });
    // No insert, so the workout-count trigger never fires on a denied request.
    expect(workoutRepositoryMocks.createWithExercises).not.toHaveBeenCalled();
  });

  it("201s a free user's 3rd create — the cap is at-or-over, not near", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([PROFILE_USER, FREE_SUB, [{ value: 2 }]]),
    );

    const app = await buildApp();
    const response = await app.handle(postWorkout("Third"));

    expect(response.status).toBe(201);
    expect(workoutRepositoryMocks.createWithExercises).toHaveBeenCalledTimes(1);
  });

  it("402s an off-catalog tier_name at the free cap instead of treating it as unlimited", async () => {
    // The joined-NULL hole, end to end: `medium_enterprise` was DELETEd from
    // the catalog by 20260526120000_simplify_tier_model.sql, so every tier
    // column comes back null. Read as "unlimited", this request 201s.
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [
          {
            tierName: "medium_enterprise",
            catalogTierName: null,
            paymentStatus: "active",
            expiresAt: null,
            cancelledAt: null,
            metadata: null,
            workoutLimit: null,
          },
        ],
        FREE_TIER,
        [{ value: 3 }],
        PREMIUM_TIER,
      ]),
    );

    const app = await buildApp();
    const response = await app.handle(postWorkout("Orphan tier"));

    expect(response.status).toBe(402);
    expect(workoutRepositoryMocks.createWithExercises).not.toHaveBeenCalled();
  });

  it("402s a lapsed-but-still-'active' paid sub at the free cap", async () => {
    // Staging marcus.whitfield, verified 2026-09-08: a `coach` row whose
    // `expires_at` passed while `payment_status` stayed 'active'. The app
    // reported FREE (3 workouts) off `/subscriptions/me`; this gate resolved
    // coach's NULL limit and allowed the create.
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [
          {
            tierName: "coach",
            catalogTierName: "coach",
            paymentStatus: "active",
            expiresAt: new Date(Date.now() - 86_400_000),
            cancelledAt: null,
            metadata: null,
            workoutLimit: null,
          },
        ],
        FREE_TIER,
        [{ value: 3 }],
        PREMIUM_TIER,
      ]),
    );

    const app = await buildApp();
    const response = await app.handle(postWorkout("Lapsed coach"));

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      code: "ENTITLEMENT_DENIED",
      reason: "expired",
      current_tier: "coach",
    });
    expect(workoutRepositoryMocks.createWithExercises).not.toHaveBeenCalled();
  });

  it("201s an unlimited paid tier no matter how many workouts are owned", async () => {
    (getDb as any).mockReturnValue(
      makeQueueDb([
        PROFILE_USER,
        [
          {
            tierName: "premium",
            catalogTierName: "premium",
            paymentStatus: "active",
            expiresAt: new Date(Date.now() + 86_400_000),
            cancelledAt: null,
            metadata: null,
            workoutLimit: null,
          },
        ],
      ]),
    );

    const app = await buildApp();
    const response = await app.handle(postWorkout("Ninety-ninth"));

    expect(response.status).toBe(201);
    expect(workoutRepositoryMocks.createWithExercises).toHaveBeenCalledTimes(1);
  });
});
