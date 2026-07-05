/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ESTIMATE = {
  foods: [
    {
      name: "Porridge with banana",
      quantity: 1,
      unit: "bowl",
      estimatedGrams: 300,
      kcal: 320,
      proteinG: 10,
      carbsG: 55,
      fatG: 6,
      confidence: 0.6,
    },
  ],
  overallConfidence: 0.6,
  notes: "Assumed a medium bowl since no size was given.",
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

const estimateFromTextMock = vi.hoisted(() =>
  vi.fn(async () => VALID_ESTIMATE),
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

vi.mock("../../../services/aiEstimation", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/aiEstimation")
  >("../../../services/aiEstimation");
  return {
    ...actual,
    estimateFromText: estimateFromTextMock,
  };
});

vi.mock("../../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn().mockImplementation(() => ({
    record: usageLogRecordMock,
    countForUserToday: usageLogCountMock,
  })),
}));

function authedRequest(body: unknown) {
  return new Request("http://localhost/nutrition/ai/estimate-text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("nutritionAiEstimateTextHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    estimateFromTextMock.mockResolvedValue(VALID_ESTIMATE);
    usageLogRecordMock.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    const response = await nutritionAiEstimateTextHandler.handle(
      new Request("http://localhost/nutrition/ai/estimate-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "a bowl of porridge" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(assertEntitlementMock).not.toHaveBeenCalled();
  });

  it("calls assertEntitlement with the authenticated userId + ai_access", async () => {
    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a bowl of porridge" }),
    );

    expect(assertEntitlementMock).toHaveBeenCalledWith(
      "test-user-id",
      "ai_access",
    );
  });

  it("returns 402 with the shipped snake_case body when assertEntitlement denies", async () => {
    assertEntitlementMock.mockResolvedValueOnce({
      allowed: false,
      reason: "cancelled",
      currentTier: "premium",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });

    const { default: Elysia } = await import("elysia");
    const { coreErrorHandler } =
      await import("../../../../../shared/errorHandler");
    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(nutritionAiEstimateTextHandler);

    const response = await app.handle(
      authedRequest({ description: "a bowl of porridge" }),
    );

    expect(response.status).toBe(402);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      code: "ENTITLEMENT_DENIED",
      feature: "ai_access",
      reason: "cancelled",
      current_tier: "premium",
      upgrade_to: null,
      upgrade_price_monthly: null,
    });
    expect(estimateFromTextMock).not.toHaveBeenCalled();
  });

  it("does NOT write a usage-log row on a 402 deny (pre-model rejection)", async () => {
    assertEntitlementMock.mockResolvedValueOnce({
      allowed: false,
      reason: "cancelled",
      currentTier: "premium",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });

    const { default: Elysia } = await import("elysia");
    const { coreErrorHandler } =
      await import("../../../../../shared/errorHandler");
    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(nutritionAiEstimateTextHandler);

    await app.handle(authedRequest({ description: "a bowl of porridge" }));

    // Pre-model rejections cost nothing and must not consume the daily
    // ceiling — no row is written (cross-cuts § 4.3 Revised 2026-07-05).
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("returns 429 ai_daily_limit at the text ceiling without calling the model or logging", async () => {
    usageLogCountMock.mockResolvedValueOnce(30); // AI_TEXT_DAILY_LIMIT
    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    const response = await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a bowl of porridge" }),
    );

    expect(response.status).toBe(429);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "ai_daily_limit" });
    expect(estimateFromTextMock).not.toHaveBeenCalled();
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("proceeds normally one call under the text ceiling", async () => {
    usageLogCountMock.mockResolvedValueOnce(29);
    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    const response = await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a bowl of porridge" }),
    );

    expect(response.status).toBe(200);
    expect(estimateFromTextMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a description over 1000 chars with Elysia's own 422 validation", async () => {
    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    const response = await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a".repeat(1001) }),
    );
    // Elysia's schema validation fires before the handler body runs, so
    // this never reaches our adapter or entitlement mock.
    expect(response.status).not.toBe(200);
    expect(estimateFromTextMock).not.toHaveBeenCalled();
  });

  it("returns 422 ai_unreadable when the adapter throws AiUnreadableError", async () => {
    const { AiUnreadableError } =
      await import("../../../services/aiEstimation");
    estimateFromTextMock.mockRejectedValueOnce(
      new AiUnreadableError("model refused"),
    );

    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    const response = await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a bowl of porridge" }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "ai_unreadable" });
  });

  it("writes a usage-log row on a 422 failure", async () => {
    const { AiUnreadableError } =
      await import("../../../services/aiEstimation");
    estimateFromTextMock.mockRejectedValueOnce(
      new AiUnreadableError("model refused"),
    );

    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a bowl of porridge" }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/nutrition/ai/estimate-text" }),
    );
  });

  it("returns 503 ai_unavailable when the adapter throws AiUnavailableError", async () => {
    const { AiUnavailableError } =
      await import("../../../services/aiEstimation");
    estimateFromTextMock.mockRejectedValueOnce(
      new AiUnavailableError("provider down"),
    );

    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    const response = await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a bowl of porridge" }),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "ai_unavailable" });
  });

  it("writes a usage-log row on a 503 failure", async () => {
    const { AiUnavailableError } =
      await import("../../../services/aiEstimation");
    estimateFromTextMock.mockRejectedValueOnce(
      new AiUnavailableError("provider down"),
    );

    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a bowl of porridge" }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/nutrition/ai/estimate-text" }),
    );
  });

  it("returns 200 with the estimate on the happy path", async () => {
    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    const response = await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a bowl of porridge with banana" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: VALID_ESTIMATE });
    expect(estimateFromTextMock).toHaveBeenCalledWith({
      description: "a bowl of porridge with banana",
    });
  });

  it("writes a usage-log row on the 200 happy path", async () => {
    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a bowl of porridge" }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        endpoint: "/nutrition/ai/estimate-text",
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

    const { nutritionAiEstimateTextHandler } =
      await import("../nutritionAiEstimateTextHandler");
    const response = await nutritionAiEstimateTextHandler.handle(
      authedRequest({ description: "a bowl of porridge" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: VALID_ESTIMATE });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
