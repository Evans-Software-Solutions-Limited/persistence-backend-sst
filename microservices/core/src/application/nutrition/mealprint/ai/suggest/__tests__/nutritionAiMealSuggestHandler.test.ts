/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const entryMocks = { listByDate: vi.fn() };
const targetMocks = { get: vi.fn() };
const prefMocks = { get: vi.fn() };
const usageMocks = { countForUserToday: vi.fn(), record: vi.fn() };
const candidateMocks = {
  listCuratedCandidates: vi.fn(),
  listOwnFoodCandidates: vi.fn(),
  listOwnRecipeCandidates: vi.fn(),
  listOwnMealCandidates: vi.fn(),
};
const assertEntitlementMock = vi.fn();
const composeSuggestionsMock = vi.fn();

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (h: string | undefined) =>
    !h || !h.startsWith("Bearer ")
      ? null
      : { sub: "test-user-id", email: "t@e.com", iat: 0, exp: 9999999999 },
  ),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "test-user-id" }),
}));

vi.mock("../../../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../entitlement/assertEntitlement")
  >("../../../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});

vi.mock("../../../../../repositories/nutritionEntryRepository", () => ({
  NutritionEntryRepository: vi.fn().mockImplementation(() => entryMocks),
}));
vi.mock("../../../../../repositories/nutritionTargetRepository", () => ({
  NutritionTargetRepository: vi.fn().mockImplementation(() => targetMocks),
}));
vi.mock("../../../../../repositories/nutritionPreferenceRepository", () => ({
  NutritionPreferenceRepository: vi.fn().mockImplementation(() => prefMocks),
}));
vi.mock("../../../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn().mockImplementation(() => usageMocks),
}));
vi.mock(
  "../../../../../repositories/mealprintCandidateRepository",
  async () => {
    const actual = await vi.importActual<
      typeof import("../../../../../repositories/mealprintCandidateRepository")
    >("../../../../../repositories/mealprintCandidateRepository");
    return {
      ...actual,
      MealprintCandidateRepository: vi
        .fn()
        .mockImplementation(() => candidateMocks),
    };
  },
);
vi.mock("../../suggestModel", async () => {
  const actual =
    await vi.importActual<typeof import("../../suggestModel")>(
      "../../suggestModel",
    );
  return { ...actual, composeSuggestions: composeSuggestionsMock };
});

const TARGET = {
  userId: "test-user-id",
  dailyKcal: 2200,
  proteinG: 170,
  carbsG: 240,
  fatG: 70,
  waterCups: 8,
  preset: "maintain",
  setByUserId: null,
  setByName: null,
  updatedAt: null,
};

const PREFS = {
  userId: "test-user-id",
  dietaryPatterns: [] as string[],
  avoidAllergens: [] as string[],
  avoidFoods: [] as string[],
  likedFoods: [] as string[],
  mealsPerDay: 4,
  effortLevel: "balanced" as const,
  locale: "en-GB",
  updatedAt: null,
  isDefault: true,
};

const CANDIDATE = {
  kind: "food" as const,
  id: "yog",
  name: "Greek Yogurt",
  kcal: 170,
  proteinG: 17,
  carbsG: 7,
  fatG: 1,
  servingLabel: "170 g",
  allergenTags: [] as string[] | null,
  categoryTags: [] as string[] | null,
  isOwn: false,
};

function post(
  body: unknown = { shape: "either", date: "2026-08-03" },
  auth = true,
) {
  return new Request("http://localhost/nutrition/ai/meal-suggest", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

/**
 * The handler mounted behind `coreErrorHandler`, because the `EntitlementError`
 * → **402** mapping lives in that error handler and not in the route. Testing the
 * route in isolation would report a 500 for a deny and quietly assert nothing
 * about the paywall's actual status code (the `workoutsCreateHandler` suite makes
 * the same point).
 */
async function handler() {
  const { default: Elysia } = await import("elysia");
  const { coreErrorHandler } =
    await import("../../../../../../shared/errorHandler");
  const mod = await import("../nutritionAiMealSuggestHandler");
  return new Elysia()
    .use(coreErrorHandler)
    .use(mod.nutritionAiMealSuggestHandler);
}

describe("nutritionAiMealSuggestHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    usageMocks.countForUserToday.mockResolvedValue(0);
    usageMocks.record.mockResolvedValue(undefined);
    entryMocks.listByDate.mockResolvedValue([]);
    targetMocks.get.mockResolvedValue(TARGET);
    prefMocks.get.mockResolvedValue(PREFS);
    candidateMocks.listCuratedCandidates.mockResolvedValue([CANDIDATE]);
    candidateMocks.listOwnFoodCandidates.mockResolvedValue([]);
    candidateMocks.listOwnRecipeCandidates.mockResolvedValue([]);
    candidateMocks.listOwnMealCandidates.mockResolvedValue([]);
    composeSuggestionsMock.mockResolvedValue({
      suggestions: [
        {
          name: "Yogurt bowl",
          reason: "fits your protein",
          items: [{ candidateId: "yog", servings: 2 }],
        },
      ],
      usage: {
        modelId: "test-model",
        latencyMs: 900,
        inputTokens: 3000,
        outputTokens: 400,
      },
    });
  });

  it("requires auth", async () => {
    const h = await handler();
    expect((await h.handle(post(undefined, false))).status).toBe(401);
  });

  // ── Guard order ───────────────────────────────────────────────────────────

  it("402s an unentitled caller BEFORE any read or inference", async () => {
    assertEntitlementMock.mockResolvedValue({
      allowed: false,
      reason: "tier",
      currentTier: "premium",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 29.99,
    });

    const h = await handler();
    const res = await h.handle(post());
    expect(res.status).toBe(402);
    // The paywall is above the reads: an unentitled caller gets neither the
    // feature nor free use of the pipeline's queries.
    expect(usageMocks.countForUserToday).not.toHaveBeenCalled();
    expect(targetMocks.get).not.toHaveBeenCalled();
    expect(composeSuggestionsMock).not.toHaveBeenCalled();
    // No usage row: nothing reached the model.
    expect(usageMocks.record).not.toHaveBeenCalled();
  });

  it("429s at the daily ceiling, without an inference or a usage row", async () => {
    usageMocks.countForUserToday.mockResolvedValue(20);
    const h = await handler();
    const res = await h.handle(post());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "ai_daily_limit" });
    expect(composeSuggestionsMock).not.toHaveBeenCalled();
    expect(usageMocks.record).not.toHaveBeenCalled();
  });

  it("gates on meal_ai, not ai_access", async () => {
    // `ai_access` is true on every paid tier, so gating on it would hand Mealprint
    // to £12.99 Premium — the hard-gate decision (no taster) would be a no-op.
    const h = await handler();
    await h.handle(post());
    expect(assertEntitlementMock).toHaveBeenCalledWith(
      "test-user-id",
      "meal_ai",
    );
  });

  // ── The 200-with-emptyReason decisions ────────────────────────────────────

  it("returns 200 + no_targets when the user has no Fuel targets", async () => {
    targetMocks.get.mockResolvedValue(null);
    const h = await handler();
    const res = await h.handle(post());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.emptyReason).toBe("no_targets");
    expect(body.data.suggestions).toEqual([]);
    // Not a failure — a state the client can explain precisely — and it must not
    // consume the daily ceiling.
    expect(usageMocks.record).not.toHaveBeenCalled();
  });

  it("returns 200 + budget_exhausted when almost nothing is left", async () => {
    entryMocks.listByDate.mockResolvedValue([
      { kcal: 2180, proteinG: 165, carbsG: 235, fatG: 68, mealSlot: "dinner" },
    ]);
    const h = await handler();
    const res = await h.handle(post());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.emptyReason).toBe(
      "budget_exhausted",
    );
    expect(composeSuggestionsMock).not.toHaveBeenCalled();
  });

  it("returns 200 + no_candidates when the pool filters to nothing", async () => {
    // ⚠ The EXPECTED early state while the `foods` tag backfill is outstanding, so
    // it must be a legible answer rather than a generic error.
    candidateMocks.listCuratedCandidates.mockResolvedValue([]);
    const h = await handler();
    const res = await h.handle(post());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.emptyReason).toBe("no_candidates");
    expect(composeSuggestionsMock).not.toHaveBeenCalled();
    expect(usageMocks.record).not.toHaveBeenCalled();
  });

  it("excludes an unsafe candidate before the model ever sees it", async () => {
    prefMocks.get.mockResolvedValue({
      ...PREFS,
      avoidAllergens: ["peanuts"],
    });
    candidateMocks.listCuratedCandidates.mockResolvedValue([
      {
        ...CANDIDATE,
        id: "pb",
        name: "Peanut Butter",
        allergenTags: ["en:peanuts"],
      },
      CANDIDATE,
    ]);

    const h = await handler();
    await h.handle(post());
    const offered = composeSuggestionsMock.mock.calls[0][0].candidates;
    expect(offered.map((c: any) => c.id)).toEqual(["yog"]);
  });

  it("passes the requested allergen constraint down to the SQL layer", async () => {
    prefMocks.get.mockResolvedValue({ ...PREFS, avoidAllergens: ["milk"] });
    const h = await handler();
    await h.handle(post());
    const args = candidateMocks.listCuratedCandidates.mock.calls[0][0];
    expect(args.requireKnownAllergens).toBe(true);
    expect(args.forbiddenAllergenTags).toContain("en:milk");
  });

  it("does not require known allergens when no chip is set", async () => {
    const h = await handler();
    await h.handle(post());
    const args = candidateMocks.listCuratedCandidates.mock.calls[0][0];
    expect(args.requireKnownAllergens).toBe(false);
    expect(args.forbiddenAllergenTags).toEqual([]);
  });

  // ── Success ───────────────────────────────────────────────────────────────

  it("returns verified suggestions with server-computed macros", async () => {
    const h = await handler();
    const res = await h.handle(post());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.emptyReason).toBeNull();
    expect(body.data.suggestions).toHaveLength(1);
    // 2 × the row's 170 kcal — recomputed here, never taken from the model.
    expect(body.data.suggestions[0].kcal).toBe(340);
    expect(body.data.remaining.kcal).toBe(2200);
  });

  it("writes exactly one usage row for a successful inference", async () => {
    const h = await handler();
    await h.handle(post());
    expect(usageMocks.record).toHaveBeenCalledTimes(1);
    expect(usageMocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        endpoint: "/nutrition/ai/meal-suggest",
      }),
    );
  });

  it("verifies against the EXACT list handed to the model", async () => {
    // A wider list at verification time would let a filtered-out food back in
    // through the model's selection.
    const h = await handler();
    await h.handle(post());
    const offered = composeSuggestionsMock.mock.calls[0][0].candidates;
    expect(offered).toHaveLength(1);
  });

  // ── Failures ──────────────────────────────────────────────────────────────

  it("422s when every suggestion fails verification, and still bills the inference", async () => {
    // An inference happened, so the ceiling IS consumed — unlike the pre-model
    // empty states above. Retrying is the sensible client action.
    composeSuggestionsMock.mockResolvedValue({
      suggestions: [
        {
          name: "Too big",
          reason: "r",
          items: [{ candidateId: "yog", servings: 6 }],
        },
      ],
      usage: {
        modelId: "test-model",
        latencyMs: 900,
        inputTokens: 3000,
        outputTokens: 400,
      },
    });
    entryMocks.listByDate.mockResolvedValue([
      { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60, mealSlot: "dinner" },
    ]);

    const h = await handler();
    const res = await h.handle(post());
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "ai_unreadable" });
    expect(usageMocks.record).toHaveBeenCalledTimes(1);
  });

  it("503s on a model outage — no deterministic fallback", async () => {
    // Shipping mechanically-assembled output under a Premium+ badge is worse
    // product than a visible outage (the Loadout precedent).
    const { AiUnavailableError } =
      await import("../../../../services/aiBedrockClient");
    composeSuggestionsMock.mockRejectedValue(
      new AiUnavailableError("bedrock down"),
    );
    const h = await handler();
    const res = await h.handle(post());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai_unavailable" });
  });

  it("422s on an unreadable model response", async () => {
    const { AiUnreadableError } =
      await import("../../../../services/aiBedrockClient");
    composeSuggestionsMock.mockRejectedValue(
      new AiUnreadableError("ai_non_member_candidate_id: ghost"),
    );
    const h = await handler();
    expect((await h.handle(post())).status).toBe(422);
  });

  it("does not fail the response when the usage-log write fails", async () => {
    usageMocks.record.mockRejectedValue(new Error("pooler gone"));
    const h = await handler();
    expect((await h.handle(post())).status).toBe(200);
  });

  // ── Body validation ───────────────────────────────────────────────────────

  it.each([
    ["missing date", { shape: "either" }],
    ["malformed date", { shape: "either", date: "03-08-2026" }],
    ["unknown shape", { shape: "brunch", date: "2026-08-03" }],
    [
      "over-long steer",
      { shape: "either", date: "2026-08-03", steer: "x".repeat(500) },
    ],
  ])("rejects %s", async (_label, body) => {
    const h = await handler();
    const res = await h.handle(post(body));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(composeSuggestionsMock).not.toHaveBeenCalled();
  });

  it("accepts an optional steer", async () => {
    const h = await handler();
    const res = await h.handle(
      post({ shape: "snack", date: "2026-08-03", steer: "something sweet" }),
    );
    expect(res.status).toBe(200);
    expect(composeSuggestionsMock.mock.calls[0][0].steer).toBe(
      "something sweet",
    );
  });
});
