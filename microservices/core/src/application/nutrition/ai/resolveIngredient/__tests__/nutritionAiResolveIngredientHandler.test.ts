/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_FOOD = {
  id: "food-1",
  name: "chicken thigh",
  brand: null,
  barcode: null,
  kcal: 209,
  proteinG: 26,
  carbsG: 0,
  fatG: 11,
  servingSize: 100,
  servingUnit: "g",
  source: "ai_recognized",
  createdBy: "test-user-id",
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

const resolveIngredientFoodMock = vi.hoisted(() =>
  vi.fn(async () => ({ food: VALID_FOOD, source: "ai" as const })),
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
  return {
    ...actual,
    assertEntitlement: assertEntitlementMock,
  };
});

vi.mock("../../../services/resolveIngredientFood", () => ({
  resolveIngredientFood: resolveIngredientFoodMock,
}));

vi.mock("../../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn().mockImplementation(() => ({
    record: usageLogRecordMock,
    countForUserToday: usageLogCountMock,
  })),
}));

function authedRequest(body: unknown) {
  return new Request("http://localhost/nutrition/ai/resolve-ingredient", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("nutritionAiResolveIngredientHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    resolveIngredientFoodMock.mockResolvedValue({
      food: VALID_FOOD,
      source: "ai",
    });
    usageLogRecordMock.mockResolvedValue(undefined);
    usageLogCountMock.mockResolvedValue(0);
  });

  it("returns 401 when unauthenticated", async () => {
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const response = await nutritionAiResolveIngredientHandler.handle(
      new Request("http://localhost/nutrition/ai/resolve-ingredient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "chicken thigh" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(assertEntitlementMock).not.toHaveBeenCalled();
  });

  it("calls assertEntitlement with the authenticated userId + ai_access", async () => {
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(assertEntitlementMock).toHaveBeenCalledWith(
      "test-user-id",
      "ai_access",
    );
  });

  it("returns 402 with the shipped snake_case body when assertEntitlement denies", async () => {
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
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(nutritionAiResolveIngredientHandler);

    const response = await app.handle(authedRequest({ name: "chicken thigh" }));

    expect(response.status).toBe(402);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      code: "ENTITLEMENT_DENIED",
      feature: "ai_access",
      reason: "tier",
      current_tier: "free",
      upgrade_to: "premium",
      upgrade_price_monthly: 12.99,
    });
    expect(resolveIngredientFoodMock).not.toHaveBeenCalled();
  });

  it("does NOT write a usage-log row on a 402 deny (pre-model rejection)", async () => {
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
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(nutritionAiResolveIngredientHandler);

    await app.handle(authedRequest({ name: "chicken thigh" }));

    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("returns 429 ai_daily_limit at the resolve ceiling without calling resolveIngredientFood or logging", async () => {
    usageLogCountMock.mockResolvedValueOnce(60); // AI_RESOLVE_DAILY_LIMIT
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const response = await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(response.status).toBe(429);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "ai_daily_limit" });
    expect(resolveIngredientFoodMock).not.toHaveBeenCalled();
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("passes the endpoint string 'resolve-ingredient' to the ceiling check", async () => {
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(usageLogCountMock).toHaveBeenCalledWith(
      "test-user-id",
      "resolve-ingredient",
    );
  });

  it("proceeds normally one call under the resolve ceiling", async () => {
    usageLogCountMock.mockResolvedValueOnce(59);
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const response = await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(response.status).toBe(200);
    expect(resolveIngredientFoodMock).toHaveBeenCalledTimes(1);
  });

  it("calls resolveIngredientFood with the name, userId, and the FoodRepository from context", async () => {
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(resolveIngredientFoodMock).toHaveBeenCalledWith(
      "chicken thigh",
      "test-user-id",
      expect.objectContaining({ foodRepo: expect.anything() }),
    );
  });

  it("returns 422 ai_unreadable when resolveIngredientFood throws AiUnreadableError", async () => {
    const { AiUnreadableError } =
      await import("../../../services/recipeExtraction");
    resolveIngredientFoodMock.mockRejectedValueOnce(
      new AiUnreadableError("model refused"),
    );

    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const response = await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "ai_unreadable" });
  });

  it("writes a usage-log row on a 422 failure", async () => {
    const { AiUnreadableError } =
      await import("../../../services/recipeExtraction");
    resolveIngredientFoodMock.mockRejectedValueOnce(
      new AiUnreadableError("model refused"),
    );

    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "resolve-ingredient",
        responseSizeBytes: expect.any(Number),
      }),
    );
  });

  it("returns 503 ai_unavailable when resolveIngredientFood throws AiUnavailableError", async () => {
    const { AiUnavailableError } =
      await import("../../../services/recipeExtraction");
    resolveIngredientFoodMock.mockRejectedValueOnce(
      new AiUnavailableError("provider down"),
    );

    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const response = await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "ai_unavailable" });
  });

  it("writes a usage-log row on a 503 failure", async () => {
    const { AiUnavailableError } =
      await import("../../../services/recipeExtraction");
    resolveIngredientFoodMock.mockRejectedValueOnce(
      new AiUnavailableError("provider down"),
    );

    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "resolve-ingredient" }),
    );
  });

  it("returns 200 with the resolved food on the happy path", async () => {
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const response = await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: VALID_FOOD });
  });

  it("writes a usage-log row on the 200 happy path", async () => {
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        endpoint: "resolve-ingredient",
        responseSizeBytes: expect.any(Number),
        ms: expect.any(Number),
      }),
    );
  });

  it("does not break the 200 response when the usage-log insert fails", async () => {
    usageLogRecordMock.mockRejectedValueOnce(new Error("db unavailable"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const response = await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: VALID_FOOD });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("logs via String() (not .message) when the usage-log failure is not an Error instance", async () => {
    // Covers the `logError instanceof Error ? ... : String(logError)`
    // false branch — a rejection with a non-Error value (e.g. a thrown
    // string) rather than the Error instance used by every other test.
    usageLogRecordMock.mockRejectedValueOnce("plain string rejection");
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const response = await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "chicken thigh" }),
    );

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("plain string rejection"),
    );

    consoleErrorSpy.mockRestore();
  });

  it("rejects an empty name at validation", async () => {
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const response = await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "" }),
    );

    expect(response.status).toBe(422);
    expect(resolveIngredientFoodMock).not.toHaveBeenCalled();
  });

  it("rejects a name exceeding maxLength 200 at validation", async () => {
    const { nutritionAiResolveIngredientHandler } =
      await import("../nutritionAiResolveIngredientHandler");
    const response = await nutritionAiResolveIngredientHandler.handle(
      authedRequest({ name: "a".repeat(201) }),
    );

    expect(response.status).toBe(422);
    expect(resolveIngredientFoodMock).not.toHaveBeenCalled();
  });

  it("honors AI_RESOLVE_DAILY_LIMIT when set to a valid positive value (module-level fail-safe ternary, true branch)", async () => {
    // The default-fallback (env unset/invalid → 60) branch is already
    // exercised by every other test in this file via the module's first
    // import. This test covers the OTHER side of that ternary — a
    // validly-set env var — which requires a fresh module evaluation.
    const previous = process.env.AI_RESOLVE_DAILY_LIMIT;
    process.env.AI_RESOLVE_DAILY_LIMIT = "3";
    vi.resetModules();

    try {
      usageLogCountMock.mockResolvedValueOnce(3); // at the custom ceiling of 3
      const { nutritionAiResolveIngredientHandler } =
        await import("../nutritionAiResolveIngredientHandler");
      const response = await nutritionAiResolveIngredientHandler.handle(
        authedRequest({ name: "chicken thigh" }),
      );

      expect(response.status).toBe(429);
      expect(resolveIngredientFoodMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.AI_RESOLVE_DAILY_LIMIT;
      } else {
        process.env.AI_RESOLVE_DAILY_LIMIT = previous;
      }
      vi.resetModules();
    }
  });
});
