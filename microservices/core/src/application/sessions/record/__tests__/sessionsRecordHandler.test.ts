/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionMocks = { recordSession: vi.fn() };
const prMocks = { recordPRsForSession: vi.fn() };
const workoutMocks = { getById: vi.fn() };

// Hoisted so the vi.mock factory below can reference it (factories
// run at module-load time, BEFORE the top-level `const` initialisers).
// Widened verdict type so per-test deny overrides typecheck.
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
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
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

vi.mock("../../../repositories/sessionRepository", () => ({
  SessionRepository: vi.fn().mockImplementation(() => sessionMocks),
}));

vi.mock("../../../repositories/personalRecordsRepository", () => ({
  PersonalRecordsRepository: vi.fn().mockImplementation(() => prMocks),
}));

// Mock WorkoutRepository so the M10.5-sweep-#2 ownership check in the
// handler can resolve. The handler skips the entitlement gate ONLY when
// the referenced workout is owned by the caller — `getById` returns the
// workout if visible (including ownership), else null. Tests dial in
// per-case.
vi.mock("../../../repositories/workoutRepository", () => ({
  WorkoutRepository: vi.fn().mockImplementation(() => workoutMocks),
}));

// Mock the entitlement helper so handler tests don't hit live DB. The
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

const validBody = {
  workoutId: "workout-1",
  name: "Push Day",
  startedAt: "2026-05-04T10:00:00.000Z",
  completedAt: "2026-05-04T11:00:00.000Z",
  status: "completed",
  totalDurationSeconds: 3600,
  userNotes: "felt strong",
  exercises: [
    {
      exerciseId: "ex-1",
      sortOrder: 1,
      supersetGroup: null,
      isSubstituted: false,
      sets: [
        {
          setNumber: 1,
          reps: 5,
          weightKg: 100,
          isCompleted: true,
          completedAt: "2026-05-04T10:05:00.000Z",
        },
      ],
    },
  ],
};

describe("sessionsRecordHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish allow-all default after clearAllMocks (which blanks
    // the impl). Tests that need a deny verdict override per-call via
    // mockResolvedValueOnce.
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    // Default to "workout owned by the calling user" so existing tests
    // using validBody (workoutId: "workout-1") continue to skip the gate.
    // Per-test overrides via mockResolvedValueOnce.
    workoutMocks.getById.mockResolvedValue({
      id: "workout-1",
      createdBy: "test-user-id",
      name: "Push Day",
    });
    sessionMocks.recordSession.mockResolvedValue({
      id: "server-session-1",
      userId: "test-user-id",
      workoutId: "workout-1",
      name: "Push Day",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      exercises: [
        {
          id: "server-ex-1",
          sessionId: "server-session-1",
          exerciseId: "ex-1",
          sortOrder: 1,
          supersetGroup: null,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [
            {
              id: "server-set-1",
              sessionExerciseId: "server-ex-1",
              setNumber: 1,
              reps: 5,
              weightKg: "100.00",
              isCompleted: true,
              isPersonalRecord: false,
              completedAt: new Date(),
            },
          ],
        },
      ],
      // Augmented fields surfaced to the mobile Summary screen — the
      // handler is a thin pass-through, so these flow into `data:
      // recorded` unchanged.
      personalRecords: [],
      workoutsThisMonth: 0,
    });
    // `recordPRsForSession` now returns the list of surfaced PRs; the
    // handler wires it through as a thin closure into recordSession.
    prMocks.recordPRsForSession.mockResolvedValue([]);
  });

  it("requires authentication", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    const response = await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 201 with the recorded session on success", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    const response = await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validBody),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { id: string } };
    expect(body.data.id).toBe("server-session-1");
  });

  it("forwards the userId from JWT (never the body) to recordSession", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...validBody,
          // Attempt to spoof userId in the body — handler must ignore
          // the body field entirely and use the JWT-derived sub.
          userId: "ATTACKER-SPOOFED-USER",
        }),
      }),
    );
    expect(sessionMocks.recordSession).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ name: "Push Day" }),
      expect.any(Function),
    );
  });

  it("rejects payloads with empty exercises array (minItems: 1)", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    const response = await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...validBody, exercises: [] }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("rejects payloads with an unknown status value via the body schema", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    const response = await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...validBody, status: "in_progress" }),
      }),
    );
    // Bulk-record only accepts terminal statuses (completed | cancelled);
    // a session that's still in-progress shouldn't be flushed yet.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("threads the PR-detection function so the repo runs it inside its tx", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validBody),
      }),
    );
    // The third arg to recordSession is the injected PR-detection
    // callback. Calling it should invoke prMocks.recordPRsForSession.
    const passedCallback = sessionMocks.recordSession.mock.calls[0]?.[2];
    expect(typeof passedCallback).toBe("function");
    const fakeTx = { fake: "tx" };
    await passedCallback("test-user-id", "server-session-1", fakeTx);
    expect(prMocks.recordPRsForSession).toHaveBeenCalledWith(
      "test-user-id",
      "server-session-1",
      fakeTx,
    );
  });

  it("accepts a status: cancelled payload (discard flow)", async () => {
    const { sessionsRecordHandler } = await import("../sessionsRecordHandler");
    const response = await sessionsRecordHandler.handle(
      new Request("http://localhost/sessions/record", {
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...validBody,
          status: "cancelled",
          completedAt: null,
        }),
      }),
    );
    expect(response.status).toBe(201);
  });

  // ─── Entitlement gate (M10.5) ─────────────────────────────────────
  //
  // Gate runs ONLY for fresh-workout sessions — i.e. those without a
  // `workoutId` reference. Re-recording against an existing template
  // doesn't consume a new workout-limit slot.
  //
  // Spec: specs/11-payments-subscriptions/requirements.md AC 9.4
  describe("entitlement gate", () => {
    async function buildAppWithErrorHandler() {
      const { default: Elysia } = await import("elysia");
      const { coreErrorHandler } =
        await import("../../../../shared/errorHandler");
      const { sessionsRecordHandler } =
        await import("../sessionsRecordHandler");
      return new Elysia().use(coreErrorHandler).use(sessionsRecordHandler);
    }

    // Same exercises payload, but no workoutId — ad-hoc / fresh-workout
    // session. The handler runs the gate in this case.
    const freshBody = {
      name: "Ad-hoc squat session",
      startedAt: validBody.startedAt,
      completedAt: validBody.completedAt,
      status: validBody.status,
      exercises: validBody.exercises,
    };

    it("calls assertEntitlement when workoutId is omitted (fresh workout)", async () => {
      const { sessionsRecordHandler } =
        await import("../sessionsRecordHandler");
      await sessionsRecordHandler.handle(
        new Request("http://localhost/sessions/record", {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(freshBody),
        }),
      );
      expect(assertEntitlementMock).toHaveBeenCalledWith(
        "test-user-id",
        "create_workout",
      );
    });

    it("calls assertEntitlement when workoutId is explicitly null", async () => {
      const { sessionsRecordHandler } =
        await import("../sessionsRecordHandler");
      await sessionsRecordHandler.handle(
        new Request("http://localhost/sessions/record", {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...freshBody, workoutId: null }),
        }),
      );
      expect(assertEntitlementMock).toHaveBeenCalledWith(
        "test-user-id",
        "create_workout",
      );
    });

    it("SKIPS the gate when workoutId is set AND owned by the caller (recording against own template)", async () => {
      // validBody has workoutId: "workout-1". Default mock returns the
      // workout with `createdBy: "test-user-id"` — owned by the caller.
      // The user paid the workout-count slot when they created the
      // template, so no new gate call.
      const { sessionsRecordHandler } =
        await import("../sessionsRecordHandler");
      const response = await sessionsRecordHandler.handle(
        new Request("http://localhost/sessions/record", {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(201);
      expect(assertEntitlementMock).not.toHaveBeenCalled();
    });

    it("RUNS the gate when workoutId is set but the workout is owned by ANOTHER user (Inspector Brad PR #72 high-severity find — sweep #2)", async () => {
      // Regression: previously, ANY non-null workoutId bypassed the
      // gate — a free-tier user at cap could send some-other-user's
      // workout UUID (a public/shared workout) and the session insert
      // would land without an entitlement check. The FK on
      // workout_sessions.workout_id is uncorrelated with user_id, so
      // foreign workoutIds succeed at insert time.
      //
      // After the fix: the handler asserts ownership via
      // WorkoutRepository.getById + createdBy === userId. A workout
      // visible to the user (e.g., a public template) but owned by
      // someone else does NOT skip the gate.
      workoutMocks.getById.mockResolvedValueOnce({
        id: "workout-shared-public",
        createdBy: "different-user-id", // NOT the caller
        name: "Public workout",
      });

      const { sessionsRecordHandler } =
        await import("../sessionsRecordHandler");
      await sessionsRecordHandler.handle(
        new Request("http://localhost/sessions/record", {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...validBody,
            workoutId: "workout-shared-public",
          }),
        }),
      );

      expect(assertEntitlementMock).toHaveBeenCalledWith(
        "test-user-id",
        "create_workout",
      );
    });

    it("RUNS the gate when workoutId references a workout that doesn't exist or isn't visible (getById returns null)", async () => {
      // Same vector as above but for the "user discovered a UUID
      // that doesn't exist or that they can't see" case. getById
      // returns null on either condition — the gate still runs.
      workoutMocks.getById.mockResolvedValueOnce(null);

      const { sessionsRecordHandler } =
        await import("../sessionsRecordHandler");
      await sessionsRecordHandler.handle(
        new Request("http://localhost/sessions/record", {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...validBody,
            workoutId: "workout-unknown-uuid",
          }),
        }),
      );

      expect(assertEntitlementMock).toHaveBeenCalledWith(
        "test-user-id",
        "create_workout",
      );
    });

    it("returns 402 with the spec body when assertEntitlement denies on a fresh workout", async () => {
      assertEntitlementMock.mockResolvedValueOnce({
        allowed: false,
        reason: "limit",
        currentTier: "free",
        upgradeTo: "premium",
        upgradePriceMonthly: 7.99,
      });

      const app = await buildAppWithErrorHandler();
      const response = await app.handle(
        new Request("http://localhost/sessions/record", {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(freshBody),
        }),
      );
      expect(response.status).toBe(402);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        code: "ENTITLEMENT_DENIED",
        feature: "create_workout",
        reason: "limit",
        current_tier: "free",
        upgrade_to: "premium",
        upgrade_price_monthly: 7.99,
      });
    });

    it("does NOT call recordSession when the gate denies", async () => {
      assertEntitlementMock.mockResolvedValueOnce({
        allowed: false,
        reason: "limit",
        currentTier: "free",
        upgradeTo: "premium",
        upgradePriceMonthly: 7.99,
      });
      const app = await buildAppWithErrorHandler();
      await app.handle(
        new Request("http://localhost/sessions/record", {
          method: "POST",
          headers: {
            authorization: "Bearer token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(freshBody),
        }),
      );
      expect(sessionMocks.recordSession).not.toHaveBeenCalled();
    });
  });
});
