/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_MACROS = {
  kcal: 1200,
  proteinG: 60,
  carbsG: 140,
  fatG: 40,
  confidence: 0.7,
};

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

const estimateRecipeMacrosMock = vi.hoisted(() =>
  vi.fn(async () => VALID_MACROS),
);

const usageLogRecordMock = vi.hoisted(() => vi.fn(async () => undefined));
const usageLogCountMock = vi.hoisted(() => vi.fn(async () => 0));

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

vi.mock("../../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../entitlement/assertEntitlement")
  >("../../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});

vi.mock("../../../services/recipeExtraction", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/recipeExtraction")
  >("../../../services/recipeExtraction");
  return { ...actual, estimateRecipeMacros: estimateRecipeMacrosMock };
});

vi.mock("../../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn().mockImplementation(() => ({
    record: usageLogRecordMock,
    countForUserToday: usageLogCountMock,
  })),
}));

const BODY = {
  name: "Chicken Curry",
  ingredients: ["500g chicken", "1 onion", "2 tbsp curry paste"],
  servings: 4,
};

function authedRequest(body: unknown) {
  return new Request("http://localhost/nutrition/ai/estimate-recipe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("nutritionAiEstimateRecipeHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    estimateRecipeMacrosMock.mockResolvedValue(VALID_MACROS);
    usageLogRecordMock.mockResolvedValue(undefined);
    usageLogCountMock.mockResolvedValue(0);
  });

  it("returns 401 when unauthenticated", async () => {
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    const response = await nutritionAiEstimateRecipeHandler.handle(
      new Request("http://localhost/nutrition/ai/estimate-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(BODY),
      }),
    );
    expect(response.status).toBe(401);
    expect(assertEntitlementMock).not.toHaveBeenCalled();
  });

  it("gates on ai_access for the authenticated user", async () => {
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    await nutritionAiEstimateRecipeHandler.handle(authedRequest(BODY));
    expect(assertEntitlementMock).toHaveBeenCalledWith(
      "test-user-id",
      "ai_access",
    );
  });

  it("returns 402 and does not log or call the model when entitlement denies", async () => {
    assertEntitlementMock.mockResolvedValueOnce({
      allowed: false,
      reason: "tier",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
    });
    const { default: Elysia } = await import("elysia");
    const { coreErrorHandler } =
      await import("../../../../../shared/errorHandler");
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(nutritionAiEstimateRecipeHandler);
    const response = await app.handle(authedRequest(BODY));
    expect(response.status).toBe(402);
    expect(estimateRecipeMacrosMock).not.toHaveBeenCalled();
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("returns 429 ai_daily_limit at the ceiling without calling the model or logging", async () => {
    usageLogCountMock.mockResolvedValueOnce(30); // AI_RECIPE_ESTIMATE_DAILY_LIMIT
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    const response = await nutritionAiEstimateRecipeHandler.handle(
      authedRequest(BODY),
    );
    expect(response.status).toBe(429);
    expect((await response.json()) as any).toEqual({ error: "ai_daily_limit" });
    expect(estimateRecipeMacrosMock).not.toHaveBeenCalled();
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("passes the 'estimate-recipe' endpoint string to the ceiling check", async () => {
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    await nutritionAiEstimateRecipeHandler.handle(authedRequest(BODY));
    expect(usageLogCountMock).toHaveBeenCalledWith(
      "test-user-id",
      "estimate-recipe",
    );
  });

  it("calls estimateRecipeMacros with name, ingredients and servings", async () => {
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    await nutritionAiEstimateRecipeHandler.handle(authedRequest(BODY));
    expect(estimateRecipeMacrosMock).toHaveBeenCalledWith({
      name: "Chicken Curry",
      ingredients: ["500g chicken", "1 onion", "2 tbsp curry paste"],
      servings: 4,
    });
  });

  it("defaults servings to null when omitted", async () => {
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    await nutritionAiEstimateRecipeHandler.handle(
      authedRequest({ name: "Soup", ingredients: ["water"] }),
    );
    expect(estimateRecipeMacrosMock).toHaveBeenCalledWith(
      expect.objectContaining({ servings: null }),
    );
  });

  it("returns 200 with the whole-recipe totals and logs usage", async () => {
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    const response = await nutritionAiEstimateRecipeHandler.handle(
      authedRequest(BODY),
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as any).toEqual({ data: VALID_MACROS });
    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        endpoint: "estimate-recipe",
        responseSizeBytes: expect.any(Number),
        ms: expect.any(Number),
      }),
    );
  });

  it("maps AiUnreadableError to 422 and still logs", async () => {
    const { AiUnreadableError } =
      await import("../../../services/recipeExtraction");
    estimateRecipeMacrosMock.mockRejectedValueOnce(
      new AiUnreadableError("bad shape"),
    );
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    const response = await nutritionAiEstimateRecipeHandler.handle(
      authedRequest(BODY),
    );
    expect(response.status).toBe(422);
    expect((await response.json()) as any).toEqual({ error: "ai_unreadable" });
    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "estimate-recipe" }),
    );
  });

  it("maps AiUnavailableError to 503 and still logs", async () => {
    const { AiUnavailableError } =
      await import("../../../services/recipeExtraction");
    estimateRecipeMacrosMock.mockRejectedValueOnce(
      new AiUnavailableError("provider down"),
    );
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    const response = await nutritionAiEstimateRecipeHandler.handle(
      authedRequest(BODY),
    );
    expect(response.status).toBe(503);
    expect((await response.json()) as any).toEqual({ error: "ai_unavailable" });
    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "estimate-recipe" }),
    );
  });

  it("does not break the 200 response when the usage-log insert fails", async () => {
    usageLogRecordMock.mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    const response = await nutritionAiEstimateRecipeHandler.handle(
      authedRequest(BODY),
    );
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs via String() when the usage-log failure is not an Error", async () => {
    usageLogRecordMock.mockRejectedValueOnce("plain string rejection");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    await nutritionAiEstimateRecipeHandler.handle(authedRequest(BODY));
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("plain string rejection"),
    );
    spy.mockRestore();
  });

  it("rejects an empty name at validation", async () => {
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    const response = await nutritionAiEstimateRecipeHandler.handle(
      authedRequest({ name: "", ingredients: ["x"] }),
    );
    expect(response.status).toBe(422);
    expect(estimateRecipeMacrosMock).not.toHaveBeenCalled();
  });

  it("rejects more than 100 ingredients at validation", async () => {
    const { nutritionAiEstimateRecipeHandler } =
      await import("../nutritionAiEstimateRecipeHandler");
    const response = await nutritionAiEstimateRecipeHandler.handle(
      authedRequest({
        name: "Big",
        ingredients: Array.from({ length: 101 }, (_, i) => `ing ${i}`),
      }),
    );
    expect(response.status).toBe(422);
    expect(estimateRecipeMacrosMock).not.toHaveBeenCalled();
  });

  it("honors AI_RECIPE_ESTIMATE_DAILY_LIMIT when set to a valid positive value", async () => {
    const previous = process.env.AI_RECIPE_ESTIMATE_DAILY_LIMIT;
    process.env.AI_RECIPE_ESTIMATE_DAILY_LIMIT = "2";
    vi.resetModules();
    try {
      usageLogCountMock.mockResolvedValueOnce(2);
      const { nutritionAiEstimateRecipeHandler } =
        await import("../nutritionAiEstimateRecipeHandler");
      const response = await nutritionAiEstimateRecipeHandler.handle(
        authedRequest(BODY),
      );
      expect(response.status).toBe(429);
      expect(estimateRecipeMacrosMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.AI_RECIPE_ESTIMATE_DAILY_LIMIT;
      } else {
        process.env.AI_RECIPE_ESTIMATE_DAILY_LIMIT = previous;
      }
      vi.resetModules();
    }
  });
});
