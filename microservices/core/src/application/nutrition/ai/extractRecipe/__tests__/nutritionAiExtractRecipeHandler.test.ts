/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_RECIPE = {
  title: "Weeknight Chicken Traybake",
  servings: 4,
  timeMinutes: 45,
  ingredients: [{ name: "chicken thighs", quantity: 8, unit: "piece" }],
  steps: ["Preheat the oven to 200C.", "Roast for 40 minutes."],
  confidence: 0.9,
  notes: null,
};

// Minimal valid JPEG magic bytes (FF D8 FF) + padding, base64-encoded.
const VALID_JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00,
]).toString("base64");
// Full 8-byte PNG signature (89 50 4E 47 0D 0A 1A 0A) + padding, base64-encoded.
const VALID_PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]).toString("base64");
const INVALID_MAGIC_BASE64 = Buffer.from([0x00, 0x01, 0x02]).toString("base64");

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

const extractRecipeFromPhotoMock = vi.hoisted(() =>
  vi.fn(async () => VALID_RECIPE),
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

vi.mock("../../../services/recipeExtraction", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/recipeExtraction")
  >("../../../services/recipeExtraction");
  return {
    ...actual,
    extractRecipeFromPhoto: extractRecipeFromPhotoMock,
  };
});

vi.mock("../../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn().mockImplementation(() => ({
    record: usageLogRecordMock,
    countForUserToday: usageLogCountMock,
  })),
}));

function authedRequest(body: unknown) {
  return new Request("http://localhost/nutrition/ai/extract-recipe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("nutritionAiExtractRecipeHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    extractRecipeFromPhotoMock.mockResolvedValue(VALID_RECIPE);
    usageLogRecordMock.mockResolvedValue(undefined);
    usageLogCountMock.mockResolvedValue(0);
  });

  it("returns 401 when unauthenticated", async () => {
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      new Request("http://localhost/nutrition/ai/extract-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: VALID_JPEG_BASE64,
          mediaType: "image/jpeg",
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(assertEntitlementMock).not.toHaveBeenCalled();
  });

  it("calls assertEntitlement with the authenticated userId + ai_access", async () => {
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
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
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(nutritionAiExtractRecipeHandler);

    const response = await app.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

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
    expect(extractRecipeFromPhotoMock).not.toHaveBeenCalled();
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
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(nutritionAiExtractRecipeHandler);

    await app.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("returns 413 image_too_large when the decoded image exceeds 5MB", async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff).toString(
      "base64",
    );
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({ imageBase64: oversized, mediaType: "image/jpeg" }),
    );

    expect(response.status).toBe(413);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "image_too_large" });
    expect(extractRecipeFromPhotoMock).not.toHaveBeenCalled();
  });

  it("does NOT write a usage-log row on a 413 reject (pre-model rejection)", async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff).toString(
      "base64",
    );
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    await nutritionAiExtractRecipeHandler.handle(
      authedRequest({ imageBase64: oversized, mediaType: "image/jpeg" }),
    );

    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("returns 429 ai_daily_limit at the recipe ceiling without calling the model or logging", async () => {
    usageLogCountMock.mockResolvedValueOnce(12); // AI_RECIPE_DAILY_LIMIT
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(429);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "ai_daily_limit" });
    expect(extractRecipeFromPhotoMock).not.toHaveBeenCalled();
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("passes the endpoint string 'extract-recipe' to the ceiling check", async () => {
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(usageLogCountMock).toHaveBeenCalledWith(
      "test-user-id",
      "extract-recipe",
    );
  });

  it("proceeds normally one call under the recipe ceiling", async () => {
    usageLogCountMock.mockResolvedValueOnce(11);
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(200);
    expect(extractRecipeFromPhotoMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 invalid_image_data when the magic bytes don't match the declared mediaType", async () => {
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: INVALID_MAGIC_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "invalid_image_data" });
    expect(extractRecipeFromPhotoMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_image_data when the base64 string decodes to zero bytes", async () => {
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({ imageBase64: " ", mediaType: "image/jpeg" }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "invalid_image_data" });
    expect(extractRecipeFromPhotoMock).not.toHaveBeenCalled();
  });

  it("returns 422 ai_unreadable when the adapter throws AiUnreadableError", async () => {
    const { AiUnreadableError } =
      await import("../../../services/recipeExtraction");
    extractRecipeFromPhotoMock.mockRejectedValueOnce(
      new AiUnreadableError("model refused"),
    );

    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "ai_unreadable" });
  });

  it("writes a usage-log row on a 422 failure", async () => {
    const { AiUnreadableError } =
      await import("../../../services/recipeExtraction");
    extractRecipeFromPhotoMock.mockRejectedValueOnce(
      new AiUnreadableError("model refused"),
    );

    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "extract-recipe",
        responseSizeBytes: expect.any(Number),
      }),
    );
  });

  it("returns 503 ai_unavailable when the adapter throws AiUnavailableError", async () => {
    const { AiUnavailableError } =
      await import("../../../services/recipeExtraction");
    extractRecipeFromPhotoMock.mockRejectedValueOnce(
      new AiUnavailableError("provider down"),
    );

    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "ai_unavailable" });
  });

  it("writes a usage-log row on a 503 failure", async () => {
    const { AiUnavailableError } =
      await import("../../../services/recipeExtraction");
    extractRecipeFromPhotoMock.mockRejectedValueOnce(
      new AiUnavailableError("provider down"),
    );

    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "extract-recipe" }),
    );
  });

  it("returns 200 with the extracted recipe on the happy path", async () => {
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: VALID_RECIPE });
    expect(extractRecipeFromPhotoMock).toHaveBeenCalledWith({
      imageBase64: VALID_JPEG_BASE64,
      mediaType: "image/jpeg",
    });
  });

  it("accepts a valid PNG payload (magic-byte check covers both media types)", async () => {
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({ imageBase64: VALID_PNG_BASE64, mediaType: "image/png" }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: VALID_RECIPE });
  });

  it("writes a usage-log row on the 200 happy path", async () => {
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        endpoint: "extract-recipe",
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

    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: VALID_RECIPE });
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

    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("plain string rejection"),
    );

    consoleErrorSpy.mockRestore();
  });

  it("rejects an imageBase64 exceeding the schema maxLength at validation, before any decode", async () => {
    const { nutritionAiExtractRecipeHandler } =
      await import("../nutritionAiExtractRecipeHandler");
    const response = await nutritionAiExtractRecipeHandler.handle(
      authedRequest({
        imageBase64: "A".repeat(7 * 1024 * 1024 + 1),
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(422);
    expect(extractRecipeFromPhotoMock).not.toHaveBeenCalled();
  });

  it("honors AI_RECIPE_DAILY_LIMIT when set to a valid positive value (module-level fail-safe ternary, true branch)", async () => {
    // The default-fallback (env unset/invalid → 12) branch is already
    // exercised by every other test in this file via the module's first
    // import. This test covers the OTHER side of that ternary — a
    // validly-set env var — which requires a fresh module evaluation.
    const previous = process.env.AI_RECIPE_DAILY_LIMIT;
    process.env.AI_RECIPE_DAILY_LIMIT = "2";
    vi.resetModules();

    try {
      usageLogCountMock.mockResolvedValueOnce(2); // at the custom ceiling of 2
      const { nutritionAiExtractRecipeHandler } =
        await import("../nutritionAiExtractRecipeHandler");
      const response = await nutritionAiExtractRecipeHandler.handle(
        authedRequest({
          imageBase64: VALID_JPEG_BASE64,
          mediaType: "image/jpeg",
        }),
      );

      expect(response.status).toBe(429);
      expect(extractRecipeFromPhotoMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.AI_RECIPE_DAILY_LIMIT;
      } else {
        process.env.AI_RECIPE_DAILY_LIMIT = previous;
      }
      vi.resetModules();
    }
  });
});
