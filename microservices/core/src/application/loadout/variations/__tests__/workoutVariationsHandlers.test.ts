/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const workoutRepositoryMocks = {
  findReadableWorkout: vi.fn(),
  listExerciseIdsForWorkout: vi.fn(),
  listVariations: vi.fn(),
  createVariation: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  createWithExercises: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getQuota: vi.fn(),
};

const exerciseRepositoryMocks = {
  findUnreadableExerciseIds: vi.fn(),
  findEquipmentRequirements: vi.fn(),
};

const savedGymRepositoryMocks = {
  getById: vi.fn(),
  findUnknownEquipmentTypeIds: vi.fn(),
};

// Hoisted so the vi.mock factory can reference it (factories run before
// top-level const initialisers). Widened so per-test deny overrides typecheck.
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
      sub: authHeader.slice("Bearer ".length),
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
  getUser: vi.fn((ctx: any) => ctx.user || { sub: "user-a" }),
}));

vi.mock("../../../repositories/workoutRepository", () => ({
  WorkoutRepository: vi.fn().mockImplementation(() => workoutRepositoryMocks),
}));

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => exerciseRepositoryMocks),
}));

vi.mock("../../../repositories/savedGymRepository", () => ({
  SavedGymRepository: vi.fn().mockImplementation(() => savedGymRepositoryMocks),
}));

// The real EntitlementError is re-exported so the handler's throw still reaches
// the error handler's `instanceof` check and maps to 402.
vi.mock("../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../entitlement/assertEntitlement")
  >("../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const GYM_ID = "22222222-2222-4222-8222-222222222222";
const EQ_1 = "33333333-3333-4333-8333-333333333333";
const EX_1 = "44444444-4444-4444-8444-444444444444";
const EX_ORIGINAL = "77777777-7777-4777-8777-777777777777";

function req(
  path: string,
  init: { method?: string; body?: unknown; as?: string | null } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (init.as !== null) headers.authorization = `Bearer ${init.as ?? "user-a"}`;
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** A readable ROOT parent — `parentWorkoutId: null` is what makes it adaptable. */
const readableRootParent = {
  id: PARENT_ID,
  name: "Full Body",
  createdBy: "user-a",
  visibility: "private",
  parentWorkoutId: null,
};

const validPlan = {
  name: "Full Body · Hotel gym",
  sourceGymId: GYM_ID,
  sourceEquipmentTypeIds: [EQ_1],
  exercises: [
    {
      exerciseId: EX_1,
      sortOrder: 0,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
    },
  ],
};

describe("GET /workouts/:id/variations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workoutRepositoryMocks.findReadableWorkout.mockResolvedValue(
      readableRootParent,
    );
    workoutRepositoryMocks.listVariations.mockResolvedValue([]);
  });

  it("401s without a token", async () => {
    const { workoutVariationsListHandler } =
      await import("../workoutVariationsListHandler");
    const res = await workoutVariationsListHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, { as: null }),
    );
    expect(res.status).toBe(401);
  });

  it("returns the caller's variations of a readable parent", async () => {
    workoutRepositoryMocks.listVariations.mockResolvedValue([
      { id: "var-1", name: "Adapted", swapCount: 2 },
    ]);
    const { workoutVariationsListHandler } =
      await import("../workoutVariationsListHandler");
    const res = await workoutVariationsListHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toHaveLength(1);
    expect(workoutRepositoryMocks.listVariations).toHaveBeenCalledWith(
      PARENT_ID,
      "user-a",
    );
  });

  // ⚠ NO parent read gate here, deliberately. Read access to a parent is
  // REVOCABLE — when a coach ends the relationship (spec-25 deletes the
  // workout_assignments row), the athlete's OWN variations of that workout would
  // otherwise become unreachable from every surface at once: hidden from the
  // library by `parent_workout_id IS NULL`, and 404 here. Gating added nothing,
  // because the response only ever contains rows `created_by = caller`.
  it("still returns the caller's own variations when the parent is no longer readable", async () => {
    workoutRepositoryMocks.findReadableWorkout.mockResolvedValue(null);
    workoutRepositoryMocks.listVariations.mockResolvedValue([
      { id: "var-1", name: "Adapted", swapCount: 1 },
    ]);
    const { workoutVariationsListHandler } =
      await import("../workoutVariationsListHandler");
    const res = await workoutVariationsListHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toHaveLength(1);
    // No parent lookup at all — one fewer query, and no revocable dependency.
    expect(workoutRepositoryMocks.findReadableWorkout).not.toHaveBeenCalled();
  });

  // The ownership filter is the whole isolation story: another user's parent
  // yields an empty list rather than their setups, and an unknown id is
  // indistinguishable from an unreadable one (both 200 []), which discloses less
  // than the old 404-vs-200 split did.
  it("returns an empty list — not another user's setups — for someone else's parent", async () => {
    workoutRepositoryMocks.listVariations.mockResolvedValue([]);
    const { workoutVariationsListHandler } =
      await import("../workoutVariationsListHandler");
    const res = await workoutVariationsListHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, { as: "user-b" }),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toEqual([]);
    expect(workoutRepositoryMocks.listVariations).toHaveBeenCalledWith(
      PARENT_ID,
      "user-b",
    );
  });

  // AC-6.2 / § Data-isolation acceptance: two athletes adapting the SAME
  // coach-assigned parent must not see each other's setups. Both can read the
  // parent, so the ownership filter inside listVariations is the only thing
  // separating them — assert the caller's own id is what reaches it.
  it("scopes to the calling user even when two users share a readable parent", async () => {
    const { workoutVariationsListHandler } =
      await import("../workoutVariationsListHandler");
    await workoutVariationsListHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, { as: "user-b" }),
    );

    expect(workoutRepositoryMocks.listVariations).toHaveBeenCalledWith(
      PARENT_ID,
      "user-b",
    );
  });

  it("is NOT entitlement-gated — reading your own saved setups survives a lapse", async () => {
    assertEntitlementMock.mockResolvedValue({
      allowed: false,
      reason: "tier",
      currentTier: "free",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 29.99,
    });
    const { workoutVariationsListHandler } =
      await import("../workoutVariationsListHandler");
    const res = await workoutVariationsListHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`),
    );

    expect(res.status).toBe(200);
    expect(assertEntitlementMock).not.toHaveBeenCalled();
  });
});

describe("POST /workouts/:id/variations", () => {
  /**
   * Compose the route with the global error handler so an EntitlementError
   * surfaces as 402 with the spec'd snake_case body — that mapping lives in
   * `coreErrorHandler`, not in the route. Mirrors the pattern in
   * `workoutsCreateHandler.test.ts`.
   */
  async function buildAppWithErrorHandler() {
    const { default: Elysia } = await import("elysia");
    const { coreErrorHandler } =
      await import("../../../../shared/errorHandler");
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    return new Elysia()
      .use(coreErrorHandler)
      .use(workoutVariationsCreateHandler);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    workoutRepositoryMocks.findReadableWorkout.mockResolvedValue(
      readableRootParent,
    );
    // Default: the parent carries no rows, so nothing is exempt and every
    // submitted id must pass the catalogue predicate on its own merits.
    workoutRepositoryMocks.listExerciseIdsForWorkout.mockResolvedValue([]);
    exerciseRepositoryMocks.findUnreadableExerciseIds.mockResolvedValue([]);
    // Default: every submitted row needs exactly the kit the plan claims, so
    // containment passes and the existing assertions are unaffected.
    exerciseRepositoryMocks.findEquipmentRequirements.mockResolvedValue(
      new Map([[EX_1, [EQ_1]]]),
    );
    savedGymRepositoryMocks.findUnknownEquipmentTypeIds.mockResolvedValue([]);
    savedGymRepositoryMocks.getById.mockResolvedValue({
      id: GYM_ID,
      name: "Hotel gym",
      equipmentTypeIds: [EQ_1],
    });
    workoutRepositoryMocks.createVariation.mockImplementation(
      async (userId: string, parentId: string, input: any) => ({
        id: "var-1",
        createdBy: userId,
        parentWorkoutId: parentId,
        variationKind: "loadout",
        visibility: "private",
        name: input.name,
        exercises: [],
      }),
    );
  });

  it("401s without a token", async () => {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
        as: null,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("201s and persists the plan under the parent", async () => {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
      }),
    );

    expect(res.status).toBe(201);
    expect(workoutRepositoryMocks.createVariation).toHaveBeenCalledWith(
      "user-a",
      PARENT_ID,
      expect.objectContaining({
        name: "Full Body · Hotel gym",
        sourceGymId: GYM_ID,
        sourceEquipmentTypeIds: [EQ_1],
      }),
    );
  });

  // AC-1.4: the gate is server-side, not a hidden button.
  it("402s for a caller without the loadout entitlement, upgradeTo premium_plus", async () => {
    assertEntitlementMock.mockResolvedValue({
      allowed: false,
      reason: "tier",
      currentTier: "premium",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 29.99,
    });

    // The EntitlementError → 402 mapping lives in coreErrorHandler (mounted on
    // the root app in api.ts), not in the route — so the route must be composed
    // with it to observe the real status and wire body.
    const res = await (
      await buildAppWithErrorHandler()
    ).handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
      }),
    );

    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.upgrade_to).toBe("premium_plus");
    expect(body.upgrade_price_monthly).toBe(29.99);
    expect(body.feature).toBe("loadout");
    // Nothing is written on a denied request.
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  it("asserts the loadout feature specifically, not ai_access", async () => {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
      }),
    );

    expect(assertEntitlementMock).toHaveBeenCalledWith("user-a", "loadout");
  });

  // Guard ORDER: canRead before the entitlement check, so poking at a workout
  // you can't see returns 404 and tells you nothing. A 402 would confirm the
  // workout exists.
  it("404s on an unreadable parent WITHOUT evaluating entitlement", async () => {
    workoutRepositoryMocks.findReadableWorkout.mockResolvedValue(null);
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
        as: "user-b",
      }),
    );

    expect(res.status).toBe(404);
    expect(assertEntitlementMock).not.toHaveBeenCalled();
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  // The security control (design § 7.1): read-visibility on EVERY submitted row,
  // so an adaptation can't smuggle another coach's private exercise into a
  // workout the caller owns and then read its fields back off workout detail.
  it("400s when any submitted exercise is not readable by the caller", async () => {
    exerciseRepositoryMocks.findUnreadableExerciseIds.mockResolvedValue([EX_1]);
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()) as any).toMatchObject({
      code: "EXERCISE_NOT_VISIBLE",
      unreadableExerciseIds: [EX_1],
    });
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  it("re-verifies visibility even on a row flagged isUserOverride", async () => {
    // An override waives EQUIPMENT CONTAINMENT (a quality check the user may
    // deliberately break), never READ-VISIBILITY (the security control) — so an
    // override cannot be used to smuggle in another coach's private exercise.
    //
    // The stub answers HONESTLY against the ids it is actually given, rather
    // than returning a fixed array: a stub that ignored its input would still
    // report the id as unreadable even if the handler had filtered the override
    // row out of the request, making this test unable to fail.
    exerciseRepositoryMocks.findUnreadableExerciseIds.mockImplementation(
      async (_userId: string, ids: string[]) => ids.filter((id) => id === EX_1),
    );

    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: {
          ...validPlan,
          exercises: [{ ...validPlan.exercises[0], isUserOverride: true }],
        },
      }),
    );

    expect(res.status).toBe(400);
    // The override row's id must have been submitted for checking at all.
    expect(
      exerciseRepositoryMocks.findUnreadableExerciseIds,
    ).toHaveBeenCalledWith("user-a", [EX_1]);
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  // THE AC-1.2 CASE. `findReadableWorkout` grants public/friends, but the
  // exercise-catalogue predicate does not — so without the parent exemption,
  // adapting a public template that uses the owner's custom exercises would 400
  // on an exercise the caller is looking at on screen.
  it("201s when an unreadable exercise is CARRIED OVER from the readable parent", async () => {
    // The catalogue says no…
    exerciseRepositoryMocks.findUnreadableExerciseIds.mockResolvedValue([EX_1]);
    // …but the parent workout contains it, and the caller can read that parent.
    workoutRepositoryMocks.listExerciseIdsForWorkout.mockResolvedValue([EX_1]);

    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
      }),
    );

    expect(res.status).toBe(201);
    expect(
      workoutRepositoryMocks.listExerciseIdsForWorkout,
    ).toHaveBeenCalledWith(PARENT_ID);
  });

  // The exemption must be scoped to the parent's OWN rows — a swap the caller
  // can't see is still rejected, which is what stops an adaptation being used to
  // smuggle in another coach's private exercise.
  it("still 400s an unreadable exercise that is NOT in the parent", async () => {
    const OTHER_EX = "55555555-5555-4555-8555-555555555555";
    exerciseRepositoryMocks.findUnreadableExerciseIds.mockResolvedValue([
      OTHER_EX,
    ]);
    workoutRepositoryMocks.listExerciseIdsForWorkout.mockResolvedValue([EX_1]);

    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: {
          ...validPlan,
          exercises: [{ exerciseId: OTHER_EX, sortOrder: 0 }],
        },
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()) as any).toMatchObject({
      code: "EXERCISE_NOT_VISIBLE",
      unreadableExerciseIds: [OTHER_EX],
    });
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  // A variation of a variation would be unreachable from EVERY listing surface:
  // hidden from the library by `parent_workout_id IS NULL`, and absent from
  // listVariations(root) because its parent is the variation, not the root.
  it("400s when the parent is itself a variation, naming the root", async () => {
    const ROOT_ID = "66666666-6666-4666-8666-666666666666";
    workoutRepositoryMocks.findReadableWorkout.mockResolvedValue({
      ...readableRootParent,
      parentWorkoutId: ROOT_ID,
    });

    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()) as any).toMatchObject({
      code: "PARENT_IS_A_VARIATION",
      rootWorkoutId: ROOT_ID,
    });
    // Refused before spending an entitlement read or a write.
    expect(assertEntitlementMock).not.toHaveBeenCalled();
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  // The frozen kit snapshot gets the same validation the saved-gym kit gets:
  // Phase 2 renders it as the kit summary and Phase 4 reads it back as the
  // equipment context, so a bogus id becomes a nameless chip.
  it("400s on an unknown id in sourceEquipmentTypeIds", async () => {
    savedGymRepositoryMocks.findUnknownEquipmentTypeIds.mockResolvedValue([
      EQ_1,
    ]);

    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()) as any).toMatchObject({
      code: "UNKNOWN_EQUIPMENT_TYPE",
      unknownEquipmentTypeIds: [EQ_1],
    });
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  it("dedupes the kit snapshot before storing it", async () => {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: { ...validPlan, sourceEquipmentTypeIds: [EQ_1, EQ_1] },
      }),
    );

    const input = workoutRepositoryMocks.createVariation.mock.calls[0][2];
    expect(input.sourceEquipmentTypeIds).toEqual([EQ_1]);
  });

  // Not cosmetic: listVariations LEFT JOINs saved_gyms to return sourceGymName,
  // so accepting an arbitrary gym id would echo another user's gym NAME back.
  it("400s when sourceGymId belongs to someone else", async () => {
    savedGymRepositoryMocks.getById.mockResolvedValue(null);
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()) as any).toMatchObject({
      code: "UNKNOWN_SAVED_GYM",
    });
    expect(savedGymRepositoryMocks.getById).toHaveBeenCalledWith(
      GYM_ID,
      "user-a",
    );
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  it("skips the gym check entirely for an ad-hoc equipment context", async () => {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: { ...validPlan, sourceGymId: null },
      }),
    );

    expect(res.status).toBe(201);
    expect(savedGymRepositoryMocks.getById).not.toHaveBeenCalled();
  });

  // A variation that inherited a public parent's visibility would land in every
  // OTHER user's browse (the `default` list branch is `visibility = 'public' AND
  // created_by != userId`), carrying this user's gym kit with it. The defence is
  // that `visibility` is not in the body schema at all and the repository
  // hardcodes 'private' — so a client that sends one is ignored, not obeyed.
  it("ignores a client-supplied visibility instead of forwarding it", async () => {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: { ...validPlan, visibility: "public" },
      }),
    );

    expect(res.status).toBe(201);
    const input = workoutRepositoryMocks.createVariation.mock.calls[0][2];
    expect(input).not.toHaveProperty("visibility");
  });

  it("400s on an inverted rep range before doing any work", async () => {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: {
          ...validPlan,
          exercises: [
            {
              exerciseId: EX_1,
              sortOrder: 0,
              targetRepsMin: 12,
              targetRepsMax: 8,
            },
          ],
        },
      }),
    );

    expect(res.status).toBe(400);
    expect(workoutRepositoryMocks.findReadableWorkout).not.toHaveBeenCalled();
  });

  it("400s on a whitespace-only name", async () => {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: { ...validPlan, name: "   " },
      }),
    );

    expect(res.status).toBe(400);
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  it("carries provenance through to the repository (AC-3.3)", async () => {
    const reason = {
      code: "equipment_unavailable",
      missingEquipment: [EQ_1],
      matchedOn: ["chest"],
    };
    // The swapped-OUT exercise must be one the parent actually contained — that
    // is what "substituted from" means, and it is what the handler validates.
    workoutRepositoryMocks.listExerciseIdsForWorkout.mockResolvedValue([
      EX_ORIGINAL,
    ]);

    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: {
          ...validPlan,
          exercises: [
            {
              ...validPlan.exercises[0],
              substitutedFromExerciseId: EX_ORIGINAL,
              substitutionReason: reason,
              isUserOverride: true,
            },
          ],
        },
      }),
    );

    const input = workoutRepositoryMocks.createVariation.mock.calls[0][2];
    expect(input.exercises[0]).toMatchObject({
      substitutedFromExerciseId: EX_ORIGINAL,
      substitutionReason: reason,
      isUserOverride: true,
    });
  });

  // The only id on this request with a FK behind it and no validation before the
  // fix. A client that sends a workout id (or a workout_exercises row id) by
  // mistake would hit Postgres 23503, abort the whole createVariation
  // transaction, and get an opaque 500 — coreErrorHandler maps only 22P02 to 400
  // — losing the user's reviewed adaptation with nothing actionable to show.
  it("400s when substitutedFromExerciseId is not an exercise the parent contained", async () => {
    workoutRepositoryMocks.listExerciseIdsForWorkout.mockResolvedValue([EX_1]);

    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: {
          ...validPlan,
          exercises: [
            // PARENT_ID is a WORKOUT id — exactly the confusion this catches.
            { ...validPlan.exercises[0], substitutedFromExerciseId: PARENT_ID },
          ],
        },
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()) as any).toMatchObject({
      code: "UNKNOWN_SUBSTITUTED_FROM_EXERCISE",
      substitutedFromExerciseIds: [PARENT_ID],
    });
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  it("accepts a KEPT row that carries no substitutedFromExerciseId at all", async () => {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: validPlan,
      }),
    );

    expect(res.status).toBe(201);
  });

  it("accepts an empty plan (every row unresolved) without inventing rows", async () => {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    const res = await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, {
        method: "POST",
        body: { ...validPlan, exercises: [] },
      }),
    );

    expect(res.status).toBe(201);
    const input = workoutRepositoryMocks.createVariation.mock.calls[0][2];
    expect(input.exercises).toEqual([]);
  });

  it("defaults an absent sourceEquipmentTypeIds to []", async () => {
    const body: Record<string, unknown> = { ...validPlan };
    delete body.sourceEquipmentTypeIds;
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    await workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, { method: "POST", body }),
    );

    const input = workoutRepositoryMocks.createVariation.mock.calls[0][2];
    expect(input.sourceEquipmentTypeIds).toEqual([]);
  });
});

// ─── T-1.6 · equipment containment on the save path ───────────────────────────
//
// design § 7.1's asymmetry, which is the point rather than an oversight:
//
//   read-visibility  → EVERY row, no exemption, no override (security)
//   containment      → only rows NOT flagged `isUserOverride`  (quality)
//
// AC-4.2/AC-4.3 let the athlete deliberately keep an incompatible exercise after
// an explicit "doesn't fit your kit" acknowledgement, so verifying containment
// everywhere would reject exactly the case the ACs mandate.

describe("POST /workouts/:id/variations — equipment containment (T-1.6)", () => {
  const EQ_MISSING = "88888888-8888-4888-8888-888888888888";

  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    workoutRepositoryMocks.findReadableWorkout.mockResolvedValue(
      readableRootParent,
    );
    workoutRepositoryMocks.listExerciseIdsForWorkout.mockResolvedValue([]);
    exerciseRepositoryMocks.findUnreadableExerciseIds.mockResolvedValue([]);
    savedGymRepositoryMocks.findUnknownEquipmentTypeIds.mockResolvedValue([]);
    savedGymRepositoryMocks.getById.mockResolvedValue({
      id: GYM_ID,
      name: "Hotel gym",
      equipmentTypeIds: [EQ_1],
    });
    workoutRepositoryMocks.createVariation.mockResolvedValue({ id: "var-1" });
  });

  async function post(body: unknown) {
    const { workoutVariationsCreateHandler } =
      await import("../workoutVariationsCreateHandler");
    return workoutVariationsCreateHandler.handle(
      req(`/workouts/${PARENT_ID}/variations`, { method: "POST", body }),
    );
  }

  it("400s a non-override row needing kit the setup does not have", async () => {
    exerciseRepositoryMocks.findEquipmentRequirements.mockResolvedValue(
      new Map([[EX_1, [EQ_MISSING]]]),
    );

    const res = await post(validPlan);
    const body = (await res.json()) as any;

    expect(res.status).toBe(400);
    expect(body.code).toBe("EQUIPMENT_NOT_AVAILABLE");
    expect(body.incompatibleExerciseIds).toEqual([EX_1]);
    expect(workoutRepositoryMocks.createVariation).not.toHaveBeenCalled();
  });

  it("ACCEPTS the same row when the user flagged it as a deliberate override", async () => {
    // AC-4.3. Without this the review step's "keep it anyway" affordance is
    // unusable.
    exerciseRepositoryMocks.findEquipmentRequirements.mockResolvedValue(
      new Map([[EX_1, [EQ_MISSING]]]),
    );

    const res = await post({
      ...validPlan,
      exercises: [{ ...validPlan.exercises[0], isUserOverride: true }],
    });

    expect(res.status).toBe(201);
    expect(workoutRepositoryMocks.createVariation).toHaveBeenCalled();
  });

  it("only looks up the rows it intends to check", async () => {
    exerciseRepositoryMocks.findEquipmentRequirements.mockResolvedValue(
      new Map(),
    );

    await post({
      ...validPlan,
      exercises: [
        { ...validPlan.exercises[0], exerciseId: EX_1 },
        {
          ...validPlan.exercises[0],
          exerciseId: EX_ORIGINAL,
          sortOrder: 1,
          isUserOverride: true,
        },
      ],
    });

    expect(
      exerciseRepositoryMocks.findEquipmentRequirements,
    ).toHaveBeenCalledWith([EX_1]);
  });

  it("checks against the frozen snapshot in preference to the gym's kit", async () => {
    // The snapshot is what AC-5.2 freezes and what Phase 2 renders, so it is the
    // more specific claim about what this variation was built for.
    savedGymRepositoryMocks.getById.mockResolvedValue({
      id: GYM_ID,
      name: "Hotel gym",
      equipmentTypeIds: [EQ_MISSING],
    });
    exerciseRepositoryMocks.findEquipmentRequirements.mockResolvedValue(
      new Map([[EX_1, [EQ_MISSING]]]),
    );

    // Snapshot says [EQ_1], which does NOT contain EQ_MISSING → rejected, even
    // though the gym's kit would have allowed it.
    const res = await post({ ...validPlan, sourceEquipmentTypeIds: [EQ_1] });

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe("EQUIPMENT_NOT_AVAILABLE");
  });

  it("falls back to the gym's kit when no snapshot was sent", async () => {
    savedGymRepositoryMocks.getById.mockResolvedValue({
      id: GYM_ID,
      name: "Hotel gym",
      equipmentTypeIds: [EQ_1],
    });
    exerciseRepositoryMocks.findEquipmentRequirements.mockResolvedValue(
      new Map([[EX_1, [EQ_MISSING]]]),
    );

    const body: Record<string, unknown> = { ...validPlan };
    delete body.sourceEquipmentTypeIds;

    const res = await post(body);

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe("EQUIPMENT_NOT_AVAILABLE");
  });

  it("skips containment entirely when there is no context to check against", async () => {
    // No gym and no snapshot: nothing to compare with, so the check is skipped
    // rather than failing every row that needs any equipment.
    exerciseRepositoryMocks.findEquipmentRequirements.mockResolvedValue(
      new Map([[EX_1, [EQ_MISSING]]]),
    );

    const res = await post({
      name: validPlan.name,
      exercises: validPlan.exercises,
    });

    expect(res.status).toBe(201);
    expect(
      exerciseRepositoryMocks.findEquipmentRequirements,
    ).not.toHaveBeenCalled();
  });

  it("passes a bodyweight row in every context", async () => {
    exerciseRepositoryMocks.findEquipmentRequirements.mockResolvedValue(
      new Map([[EX_1, []]]),
    );

    expect((await post(validPlan)).status).toBe(201);
  });

  it("treats a row that lost its exercise as requiring nothing", async () => {
    // Absent from the map means the exercise vanished between preview and save.
    // Reporting that as a containment failure would misdescribe the cause; the FK
    // is the honest error.
    exerciseRepositoryMocks.findEquipmentRequirements.mockResolvedValue(
      new Map(),
    );

    expect((await post(validPlan)).status).toBe(201);
  });

  it("runs AFTER visibility, so a hidden exercise cannot be laundered by an override", async () => {
    // The override flag is a client-supplied claim. It may skip the QUALITY
    // check; it must never skip the SECURITY one.
    exerciseRepositoryMocks.findUnreadableExerciseIds.mockResolvedValue([EX_1]);
    exerciseRepositoryMocks.findEquipmentRequirements.mockResolvedValue(
      new Map([[EX_1, []]]),
    );

    const res = await post({
      ...validPlan,
      exercises: [{ ...validPlan.exercises[0], isUserOverride: true }],
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toBe("EXERCISE_NOT_VISIBLE");
  });
});
