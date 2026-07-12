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

// Hoisted so the vi.mock factory below can reference it (factories run
// at module-load time, BEFORE the top-level `const` initialisers). The
// generic widens the resolved-value type so per-test deny overrides
// (`{ allowed: false, reason: ..., ... }`) typecheck cleanly.
const assertEntitlementMock = vi.hoisted(() =>
  vi.fn<
    (
      userId: string,
      feature: string,
    ) => Promise<
      | { allowed: true }
      | {
          allowed: false;
          reason: "tier" | "limit" | "cancelled" | "expired";
          currentTier: string;
          upgradeTo: string | null;
          upgradePriceMonthly: number | null;
        }
    >
  >(async () => ({ allowed: true })),
);

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

// Mock the entitlement helper so the handler tests don't hit live DB.
// Default behaviour is allow-all; deny tests override per case. The
// real EntitlementError class is re-exported so the handler's
// `throw new EntitlementError(...)` reaches the error handler's
// `instanceof EntitlementError` check.
vi.mock("../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../entitlement/assertEntitlement")
  >("../../../entitlement/assertEntitlement");
  return {
    ...actual,
    assertEntitlement: assertEntitlementMock,
  };
});

describe("WorkoutsCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish allow-all default (clearAllMocks blanks the impl,
    // but the helper's signature contract is "always return a verdict"
    // — without a default impl the handler would receive undefined).
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    workoutRepositoryMocks.createWithExercises.mockImplementation(
      async (userId: string, data: any) => ({
        id: "workout-1",
        createdBy: userId,
        name: data.name,
        description: data.description ?? null,
        visibility: data.visibility ?? "private",
        estimatedDurationMinutes: data.estimatedDurationMinutes ?? 30,
        exercises: (data.exercises ?? []).map((ex: any, idx: number) => ({
          id: `we-${idx}`,
          ...ex,
          supersetGroup: ex.supersetGroup ?? null,
          targetSets: ex.targetSets ?? null,
          targetRepsMin: ex.targetRepsMin ?? 1,
          targetRepsMax: ex.targetRepsMax ?? 1,
          targetDurationSeconds: ex.targetDurationSeconds ?? null,
          restSeconds: ex.restSeconds ?? 90,
          notes: ex.notes ?? null,
          exercise: null,
        })),
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
          body: JSON.stringify({ name: "Test" }),
        }),
      );
      expect(response.status).toBe(401);
    });

    it("should reject invalid visibility values with 422", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "X", visibility: "secret" }),
        }),
      );
      expect(response.status).toBe(422);
    });
  });

  describe("authenticated metadata-only requests", () => {
    it("should create with valid data and return 201 single-envelope", async () => {
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
            description: "Test",
            visibility: "private",
            estimatedDurationMinutes: 45,
          }),
        }),
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as any;
      expect(body.data.id).toBe("workout-1");
      expect(body.data.name).toBe("My Workout");
    });

    it("should default visibility to private and duration to 30", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "Defaults" }),
        }),
      );
      const body = (await response.json()) as any;
      expect(body.data.visibility).toBe("private");
      expect(body.data.estimatedDurationMinutes).toBe(30);
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
          body: JSON.stringify({ name: "X" }),
        }),
      );
      const body = (await response.json()) as any;
      expect(body.data.createdBy).toBe("test-user-id");
    });

    it("should reject empty workout name with 400", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "" }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it("should reject whitespace-only workout name with 400", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "   " }),
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe("nested-exercise requests", () => {
    it("should pass nested exercises to createWithExercises", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            name: "With Exercises",
            exercises: [
              {
                exerciseId: "ex-1",
                sortOrder: 0,
                supersetGroup: 1,
                targetSets: 4,
                targetRepsMin: 8,
                targetRepsMax: 12,
              },
              {
                exerciseId: "ex-2",
                sortOrder: 1,
                supersetGroup: 1,
                targetSets: 4,
                targetRepsMin: 8,
                targetRepsMax: 12,
              },
            ],
          }),
        }),
      );

      expect(workoutRepositoryMocks.createWithExercises).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({
          name: "With Exercises",
          exercises: expect.arrayContaining([
            expect.objectContaining({
              exerciseId: "ex-1",
              supersetGroup: 1,
            }),
            expect.objectContaining({
              exerciseId: "ex-2",
              supersetGroup: 1,
            }),
          ]),
        }),
      );
    });

    it("should return 400 when targetRepsMin > targetRepsMax", async () => {
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
            name: "Invalid",
            exercises: [
              {
                exerciseId: "ex-1",
                sortOrder: 0,
                targetRepsMin: 12,
                targetRepsMax: 8,
              },
            ],
          }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it("should return 400 when targetRepsMin is provided alone and exceeds the default max=1", async () => {
      // Regression: pre-fix, the validator only fired when BOTH bounds
      // were explicit. A payload with `targetRepsMin: 5` (no max) skipped
      // the check, then the repository defaulted max to 1 and stored
      // min=5/max=1 — violating the invariant.
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
            name: "Asymmetric",
            exercises: [{ exerciseId: "ex-1", sortOrder: 0, targetRepsMin: 5 }],
          }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it("should return 400 when targetRepsMax is provided alone below the default min=1", async () => {
      // Mirror of the above: max=0 with default min=1 still violates min ≤ max.
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
            name: "Asymmetric",
            exercises: [{ exerciseId: "ex-1", sortOrder: 0, targetRepsMax: 0 }],
          }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it("should accept omitted reps bounds (both default to 1)", async () => {
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
            name: "Defaults",
            exercises: [{ exerciseId: "ex-1", sortOrder: 0 }],
          }),
        }),
      );
      expect(response.status).toBe(201);
    });

    it("should default exercises to [] when omitted", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "No exercises" }),
        }),
      );

      expect(workoutRepositoryMocks.createWithExercises).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ exercises: [] }),
      );
    });

    it("defaults show_in_owner_library to true when omitted (athlete path)", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "Personal" }),
        }),
      );

      expect(workoutRepositoryMocks.createWithExercises).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ showInOwnerLibrary: true }),
      );
    });

    it("forwards show_in_owner_library=false from the coach-authoring flow", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            name: "For client",
            showInOwnerLibrary: false,
          }),
        }),
      );

      expect(workoutRepositoryMocks.createWithExercises).toHaveBeenCalledWith(
        "test-user-id",
        expect.objectContaining({ showInOwnerLibrary: false }),
      );
    });
  });

  // ─── Entitlement gate (M10.5) ─────────────────────────────────────
  //
  // The handler calls assertEntitlement(userId, "create_workout") AFTER
  // input validation, BEFORE createWithExercises. Tests below verify:
  //
  //   1. Allow path → 201 + repo invoked with userId
  //   2. Deny path through coreErrorHandler → 402 with spec body
  //   3. Deny path → repo NOT invoked (no DB insert, no trigger fire)
  //   4. Invalid input still returns 400 (gate runs AFTER validation)
  //
  // Spec: specs/11-payments-subscriptions/requirements.md AC 9.3
  describe("entitlement gate", () => {
    async function buildAppWithErrorHandler() {
      // Compose the route with the global error handler so deny
      // verdicts surface as 402 with the spec'd snake_case body — that
      // mapping lives in coreErrorHandler, not the route itself.
      const { default: Elysia } = await import("elysia");
      const { coreErrorHandler } =
        await import("../../../../shared/errorHandler");
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      return new Elysia().use(coreErrorHandler).use(workoutsCreateHandler);
    }

    it("calls assertEntitlement with the authenticated userId + create_workout", async () => {
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "Allowed" }),
        }),
      );

      expect(assertEntitlementMock).toHaveBeenCalledWith(
        "test-user-id",
        "create_workout",
      );
    });

    it("returns 402 with the spec snake_case body when assertEntitlement denies for 'limit'", async () => {
      assertEntitlementMock.mockResolvedValueOnce({
        allowed: false,
        reason: "limit",
        currentTier: "free",
        upgradeTo: "premium",
        upgradePriceMonthly: 7.99,
      });

      const app = await buildAppWithErrorHandler();
      const response = await app.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "Over Limit" }),
        }),
      );

      expect(response.status).toBe(402);
      const body = (await response.json()) as Record<string, unknown>;
      // EXACT field names — mobile parses these verbatim.
      expect(body).toMatchObject({
        code: "ENTITLEMENT_DENIED",
        error: "Subscription does not include this feature",
        feature: "create_workout",
        reason: "limit",
        current_tier: "free",
        upgrade_to: "premium",
        upgrade_price_monthly: 7.99,
      });
    });

    it("does NOT invoke the repository when the gate denies", async () => {
      assertEntitlementMock.mockResolvedValueOnce({
        allowed: false,
        reason: "cancelled",
        currentTier: "premium",
        upgradeTo: null,
        upgradePriceMonthly: null,
      });

      const app = await buildAppWithErrorHandler();
      await app.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "Cancelled User" }),
        }),
      );

      expect(workoutRepositoryMocks.createWithExercises).not.toHaveBeenCalled();
    });

    it("still returns 400 for invalid input even when entitlement would allow (validation runs first)", async () => {
      // Sanity check on ordering — gate runs AFTER validation, so an
      // invalid payload should still surface 400 (more informative)
      // rather than 402.
      const { workoutsCreateHandler } =
        await import("../workoutsCreateHandler");
      const response = await workoutsCreateHandler.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "   " }),
        }),
      );
      expect(response.status).toBe(400);
      expect(assertEntitlementMock).not.toHaveBeenCalled();
    });

    it("returns 201 (premium-equivalent) when assertEntitlement allows", async () => {
      // Default impl is allow-all, so this is the happy path — but
      // make it explicit alongside the deny tests so the contract is
      // visible.
      assertEntitlementMock.mockResolvedValueOnce({ allowed: true });

      const app = await buildAppWithErrorHandler();
      const response = await app.handle(
        new Request("http://localhost/workouts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: "Bearer test-token",
          },
          body: JSON.stringify({ name: "Premium user" }),
        }),
      );
      expect(response.status).toBe(201);
    });
  });
});
