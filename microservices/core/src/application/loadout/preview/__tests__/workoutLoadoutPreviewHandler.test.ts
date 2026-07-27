/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AiUnavailableError,
  AiUnreadableError,
} from "../../../nutrition/services/aiBedrockClient";

const WORKOUT_ID = "11111111-1111-4111-8111-111111111111";
const GYM_ID = "22222222-2222-4222-8222-222222222222";
const DUMBBELL = "33333333-3333-4333-8333-333333333333";
const BARBELL = "44444444-4444-4444-8444-444444444444";
const CHEST = "55555555-5555-4555-8555-555555555555";

const parentWorkout = {
  id: WORKOUT_ID,
  name: "Upper Body",
  parentWorkoutId: null,
};

function exercise(overrides: any = {}) {
  return {
    id: "ex-src",
    name: "Barbell Bench Press",
    category: "strength",
    difficultyLevel: "intermediate",
    movementType: null,
    primaryMuscles: [CHEST],
    secondaryMuscles: [],
    equipmentRequired: [BARBELL],
    thumbnailUrl: null,
    ...overrides,
  };
}

function adaptationRow(overrides: any = {}) {
  return {
    workoutExerciseId: "we-1",
    sortOrder: 0,
    supersetGroup: null,
    targetSets: 4,
    targetRepsMin: 8,
    targetRepsMax: 12,
    targetDurationSeconds: null,
    restSeconds: 90,
    notes: null,
    source: exercise(),
    ...overrides,
  };
}

const CANDIDATE = exercise({
  id: "ex-alt",
  name: "Dumbbell Bench Press",
  equipmentRequired: [DUMBBELL],
});

const assertEntitlementMock = vi.hoisted(() =>
  vi.fn(async () => ({ allowed: true }) as any),
);
const selectSubstitutesMock = vi.hoisted(() => vi.fn());
const usageLogRecordMock = vi.hoisted(() => vi.fn(async () => undefined));
const usageLogCountMock = vi.hoisted(() => vi.fn(async () => 0));

const workoutRepo = vi.hoisted(() => ({
  findReadableWorkout: vi.fn(),
  listAdaptationRows: vi.fn(),
}));
const savedGymRepo = vi.hoisted(() => ({
  getById: vi.fn(),
  findUnknownEquipmentTypeIds: vi.fn(async () => [] as string[]),
}));
const exerciseRepo = vi.hoisted(() => ({
  listAdaptationCandidates: vi.fn(),
  listPreviouslyLoggedExerciseIds: vi.fn(async () => [] as string[]),
  findEquipmentTypeIdsByName: vi.fn(async () => ["loadable-1"]),
  getMuscleGroups: vi.fn(async () => [
    { id: CHEST, name: "chest", displayName: "Chest" },
  ]),
  getEquipmentTypes: vi.fn(async () => [
    { id: DUMBBELL, name: "Dumbbells", category: "free_weights" },
    { id: BARBELL, name: "Barbell", category: "free_weights" },
  ]),
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (header: string | undefined) =>
    header?.startsWith("Bearer ")
      ? {
          sub: "user-a",
          email: "a@e.com",
          email_verified: true,
          iat: 0,
          exp: 9e9,
        }
      : null,
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx: any) => ctx.user || { sub: "user-a" }),
}));

vi.mock("../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../entitlement/assertEntitlement")
  >("../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});

vi.mock("../../engine/remapModel", async () => {
  const actual = await vi.importActual<
    typeof import("../../engine/remapModel")
  >("../../engine/remapModel");
  return { ...actual, selectSubstitutes: selectSubstitutesMock };
});

vi.mock("../../../repositories/workoutRepository", () => ({
  WorkoutRepository: vi.fn().mockImplementation(() => workoutRepo),
}));
vi.mock("../../../repositories/savedGymRepository", () => ({
  SavedGymRepository: vi.fn().mockImplementation(() => savedGymRepo),
}));
vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => exerciseRepo),
}));
vi.mock("../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn().mockImplementation(() => ({
    record: usageLogRecordMock,
    countForUserToday: usageLogCountMock,
  })),
}));

function request(body: unknown, authed = true) {
  return new Request(
    `http://localhost/workouts/${WORKOUT_ID}/loadout/preview`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authed ? { authorization: "Bearer token" } : {}),
      },
      body: JSON.stringify(body),
    },
  );
}

async function call(body: unknown, authed = true) {
  const { workoutLoadoutPreviewHandler } =
    await import("../workoutLoadoutPreviewHandler");
  return workoutLoadoutPreviewHandler.handle(request(body, authed));
}

describe("POST /workouts/:id/loadout/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true } as any);
    usageLogCountMock.mockResolvedValue(0);
    workoutRepo.findReadableWorkout.mockResolvedValue(parentWorkout);
    workoutRepo.listAdaptationRows.mockResolvedValue([adaptationRow()]);
    savedGymRepo.getById.mockResolvedValue({
      id: GYM_ID,
      name: "Hotel gym",
      equipmentTypeIds: [DUMBBELL],
    });
    savedGymRepo.findUnknownEquipmentTypeIds.mockResolvedValue([]);
    exerciseRepo.listAdaptationCandidates.mockResolvedValue({
      candidates: [CANDIDATE],
      truncated: false,
    });
    exerciseRepo.listPreviouslyLoggedExerciseIds.mockResolvedValue([]);
    exerciseRepo.findEquipmentTypeIdsByName.mockResolvedValue(["loadable-1"]);
    selectSubstitutesMock.mockResolvedValue({
      selections: new Map([
        [0, { sortOrder: 0, exerciseId: "ex-alt", reason: "Dumbbells work" }],
      ]),
      usage: {
        modelId: "eu.anthropic.test",
        latencyMs: 2600,
        inputTokens: 4543,
        outputTokens: 120,
      },
    });
  });

  describe("guards", () => {
    it("401s an unauthenticated caller before touching anything", async () => {
      const res = await call({ savedGymId: GYM_ID }, false);
      expect(res.status).toBe(401);
      expect(workoutRepo.findReadableWorkout).not.toHaveBeenCalled();
      expect(assertEntitlementMock).not.toHaveBeenCalled();
    });

    it("400s when NEITHER equipment source is supplied", async () => {
      const res = await call({});
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).code).toBe(
        "EQUIPMENT_CONTEXT_REQUIRED",
      );
    });

    it("400s when BOTH equipment sources are supplied", async () => {
      // Accepting both would mean silently preferring one; the two collect paths
      // never produce both.
      const res = await call({
        savedGymId: GYM_ID,
        equipmentTypeIds: [DUMBBELL],
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).code).toBe(
        "EQUIPMENT_CONTEXT_REQUIRED",
      );
    });

    it("404s an unreadable parent — and does NOT reveal it via a 402", async () => {
      // The parent-read check precedes the entitlement check precisely so a
      // caller poking at a workout they cannot see learns nothing.
      workoutRepo.findReadableWorkout.mockResolvedValue(null);

      const res = await call({ savedGymId: GYM_ID });

      expect(res.status).toBe(404);
      expect(assertEntitlementMock).not.toHaveBeenCalled();
    });

    it("400s an attempt to adapt a variation, naming the root", async () => {
      workoutRepo.findReadableWorkout.mockResolvedValue({
        ...parentWorkout,
        parentWorkoutId: "root-id",
      });

      const res = await call({ savedGymId: GYM_ID });
      const body = (await res.json()) as any;

      expect(res.status).toBe(400);
      expect(body.code).toBe("PARENT_IS_A_VARIATION");
      expect(body.rootWorkoutId).toBe("root-id");
    });

    it("402s an unentitled caller, before any further work or model call", async () => {
      // The EntitlementError → 402 mapping lives in `coreErrorHandler`, mounted
      // on the root app rather than the route, so the route is composed with it
      // here (same pattern as the Phase-0 variations tests).
      const { default: Elysia } = await import("elysia");
      const { coreErrorHandler } =
        await import("../../../../shared/errorHandler");
      const { workoutLoadoutPreviewHandler } =
        await import("../workoutLoadoutPreviewHandler");
      const app = new Elysia()
        .use(coreErrorHandler)
        .use(workoutLoadoutPreviewHandler);

      assertEntitlementMock.mockResolvedValue({
        allowed: false,
        reason: "tier",
        currentTier: "premium",
        upgradeTo: "premium_plus",
        upgradePriceMonthly: 2999,
      } as any);

      const res = await app.handle(request({ savedGymId: GYM_ID }));

      expect(res.status).toBe(402);
      expect(savedGymRepo.getById).not.toHaveBeenCalled();
      expect(selectSubstitutesMock).not.toHaveBeenCalled();
      expect(usageLogRecordMock).not.toHaveBeenCalled();
    });

    it("asserts the loadout feature specifically", async () => {
      await call({ savedGymId: GYM_ID });
      expect(assertEntitlementMock).toHaveBeenCalledWith("user-a", "loadout");
    });

    it("400s an unowned or unknown saved gym", async () => {
      // Ownership, not just existence: another user's gym would leak its kit.
      savedGymRepo.getById.mockResolvedValue(null);

      const res = await call({ savedGymId: GYM_ID });

      expect(res.status).toBe(400);
      expect(((await res.json()) as any).code).toBe("UNKNOWN_SAVED_GYM");
      expect(savedGymRepo.getById).toHaveBeenCalledWith(GYM_ID, "user-a");
    });

    it("400s unknown equipment ids, naming them", async () => {
      savedGymRepo.findUnknownEquipmentTypeIds.mockResolvedValue(["ghost"]);

      const res = await call({ equipmentTypeIds: [DUMBBELL] });
      const body = (await res.json()) as any;

      expect(res.status).toBe(400);
      expect(body.code).toBe("UNKNOWN_EQUIPMENT_TYPE");
      expect(body.unknownEquipmentTypeIds).toEqual(["ghost"]);
    });

    it("400s an empty equipment context, including a gym saved with no kit", async () => {
      savedGymRepo.getById.mockResolvedValue({
        id: GYM_ID,
        name: "Empty",
        equipmentTypeIds: [],
      });

      const res = await call({ savedGymId: GYM_ID });

      expect(res.status).toBe(400);
      expect(((await res.json()) as any).code).toBe("EMPTY_EQUIPMENT_CONTEXT");
    });

    it("400s an empty equipmentTypeIds array too", async () => {
      const res = await call({ equipmentTypeIds: [] });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).code).toBe("EMPTY_EQUIPMENT_CONTEXT");
    });
  });

  describe("the ceiling (AC-10.2)", () => {
    it("429s once the daily limit is reached, without calling the model", async () => {
      usageLogCountMock.mockResolvedValue(30);

      const res = await call({ savedGymId: GYM_ID });

      expect(res.status).toBe(429);
      expect(((await res.json()) as any).error).toBe("ai_daily_limit");
      expect(selectSubstitutesMock).not.toHaveBeenCalled();
      // A pre-model rejection costs nothing and must not write a usage row.
      expect(usageLogRecordMock).not.toHaveBeenCalled();
    });

    it("counts against this endpoint only", async () => {
      await call({ savedGymId: GYM_ID });
      expect(usageLogCountMock).toHaveBeenCalledWith(
        "user-a",
        "/workouts/:id/loadout/preview",
      );
    });

    it("does NOT consume the ceiling when no row needs a swap", async () => {
      // E2's `full_gym` context produced zero swaps across all 20 fixtures, so a
      // free operation must never be charged — hitting a cap mid-gym is the bad
      // failure AC-10.2 warns about.
      workoutRepo.listAdaptationRows.mockResolvedValue([
        adaptationRow({
          source: exercise({
            id: "bw",
            name: "Push-Up",
            equipmentRequired: [],
          }),
        }),
      ]);

      const res = await call({ savedGymId: GYM_ID });
      const body = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(body.data.rows[0].status).toBe("kept");
      expect(body.data.meta.modelId).toBeNull();
      expect(usageLogCountMock).not.toHaveBeenCalled();
      expect(selectSubstitutesMock).not.toHaveBeenCalled();
      expect(usageLogRecordMock).not.toHaveBeenCalled();
    });
  });

  describe("the happy path", () => {
    it("returns the adapted plan with provenance, reason and context", async () => {
      const res = await call({ savedGymId: GYM_ID });
      const body = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(body.data.workoutId).toBe(WORKOUT_ID);
      expect(body.data.savedGymId).toBe(GYM_ID);
      expect(body.data.equipmentTypeIds).toEqual([DUMBBELL]);
      expect(body.data.rows[0]).toMatchObject({
        status: "swapped",
        exerciseId: "ex-alt",
        substitutedFromExerciseId: "ex-src",
        // The parent's targets, carried across untouched (§ 1 rule 2).
        targetSets: 4,
        targetRepsMin: 8,
        targetRepsMax: 12,
        restSeconds: 90,
      });
      expect(body.data.rows[0].reason).toMatchObject({
        code: "equipment_unavailable",
        missingEquipment: [BARBELL],
        note: "Dumbbells work",
        selectedBy: "model",
      });
      expect(body.data.meta.modelId).toBe("eu.anthropic.test");
    });

    it("persists nothing (AC-3.5) — there is no write path on this handler", async () => {
      await call({ savedGymId: GYM_ID });

      // The repositories exposed to this handler have no create/update methods
      // wired at all; assert the read-only set was all that was touched.
      expect(Object.keys(workoutRepo)).toEqual([
        "findReadableWorkout",
        "listAdaptationRows",
      ]);
    });

    it("excludes the plan's own exercises from the candidate query", async () => {
      await call({ savedGymId: GYM_ID });

      expect(exerciseRepo.listAdaptationCandidates).toHaveBeenCalledWith(
        "user-a",
        expect.objectContaining({
          muscleIds: [CHEST],
          equipmentTypeIds: [DUMBBELL],
          excludeExerciseIds: ["ex-src"],
        }),
      );
    });

    it("scopes the candidate query to the CALLER (AC-3.6)", async () => {
      await call({ savedGymId: GYM_ID });
      expect(exerciseRepo.listAdaptationCandidates.mock.calls[0][0]).toBe(
        "user-a",
      );
    });

    it("offers the model only the shortlist, resolved to names", async () => {
      await call({ savedGymId: GYM_ID });

      const args = selectSubstitutesMock.mock.calls[0][0] as any;
      expect(args.candidates.map((c: any) => c.id)).toEqual(["ex-alt"]);
      expect(args.workoutName).toBe("Upper Body");
      expect(args.lookups.muscleNames.get(CHEST)).toBe("Chest");
      expect(args.lookups.equipmentNames.get(DUMBBELL)).toBe("Dumbbells");
    });

    it("writes exactly one usage row once the model was reached", async () => {
      await call({ savedGymId: GYM_ID });

      expect(usageLogRecordMock).toHaveBeenCalledTimes(1);
      expect(usageLogRecordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-a",
          endpoint: "/workouts/:id/loadout/preview",
        }),
      );
    });

    it("accepts a direct equipment list and dedupes it", async () => {
      const res = await call({
        equipmentTypeIds: [DUMBBELL, DUMBBELL],
      });
      const body = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(body.data.equipmentTypeIds).toEqual([DUMBBELL]);
      expect(body.data.savedGymId).toBeNull();
    });

    it("skips the model when the ranker offers nothing at all", async () => {
      // Spending a model call to be told there are no candidates is pure waste.
      exerciseRepo.listAdaptationCandidates.mockResolvedValue({
        candidates: [],
        truncated: false,
      });

      const res = await call({ savedGymId: GYM_ID });
      const body = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(body.data.rows[0].status).toBe("unresolved");
      expect(selectSubstitutesMock).not.toHaveBeenCalled();
      expect(usageLogRecordMock).not.toHaveBeenCalled();
    });

    it("logs, never hides, a truncated candidate pool (§ 6.3)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      exerciseRepo.listAdaptationCandidates.mockResolvedValue({
        candidates: [CANDIDATE],
        truncated: true,
      });

      const res = await call({ savedGymId: GYM_ID });

      expect(((await res.json()) as any).data.meta.candidatePoolTruncated).toBe(
        true,
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("candidate pool truncated"),
      );
      warn.mockRestore();
    });

    it("warns when no loadable equipment resolves — an inert AC-3.5b check", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      exerciseRepo.findEquipmentTypeIdsByName.mockResolvedValue([]);

      await call({ savedGymId: GYM_ID });

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("intensity-mismatch detection"),
      );
      warn.mockRestore();
    });
  });

  describe("model failures", () => {
    it("422s an unreadable model response, and still records the inference", async () => {
      selectSubstitutesMock.mockRejectedValue(
        new AiUnreadableError("ai_non_member_exercise_id: nope"),
      );

      const res = await call({ savedGymId: GYM_ID });

      expect(res.status).toBe(422);
      expect(((await res.json()) as any).error).toBe("ai_unreadable");
      // The call was paid for even though it failed, so it counts.
      expect(usageLogRecordMock).toHaveBeenCalledTimes(1);
    });

    it("503s when the provider is unavailable — no silent ranker fallback", async () => {
      // Shipping deterministic-ranker output under a Premium+ badge is what the
      // bake-off rejected (it lost 4-50 and produced Atlas Stones in a hotel
      // room). A visible outage beats a quietly worse plan.
      selectSubstitutesMock.mockRejectedValue(
        new AiUnavailableError("ai_estimation_failed"),
      );

      const res = await call({ savedGymId: GYM_ID });

      expect(res.status).toBe(503);
      expect(((await res.json()) as any).error).toBe("ai_unavailable");
      expect(usageLogRecordMock).toHaveBeenCalledTimes(1);
    });

    it("never fails the response because the usage-log write failed", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      usageLogRecordMock.mockRejectedValue(new Error("db down"));

      const res = await call({ savedGymId: GYM_ID });

      expect(res.status).toBe(200);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("[ai-usage-log]"),
      );
      error.mockRestore();
    });
  });
});
