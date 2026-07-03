/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_ESTIMATE = {
  foods: [
    {
      name: "Grilled chicken breast",
      quantity: 1,
      unit: "piece",
      estimatedGrams: 150,
      kcal: 250,
      proteinG: 45,
      carbsG: 0,
      fatG: 6,
      confidence: 0.85,
    },
  ],
  overallConfidence: 0.8,
  notes: "",
};

// Minimal valid JPEG magic bytes (FF D8 FF) + padding, base64-encoded.
const VALID_JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00,
]).toString("base64");
// Minimal valid PNG magic bytes (89 50 4E 47) + padding, base64-encoded.
const VALID_PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00,
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

const estimateFromPhotoMock = vi.hoisted(() =>
  vi.fn(async () => VALID_ESTIMATE),
);

const usageLogRecordMock = vi.hoisted(() => vi.fn(async () => undefined));

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
    estimateFromPhoto: estimateFromPhotoMock,
  };
});

vi.mock("../../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn().mockImplementation(() => ({
    record: usageLogRecordMock,
  })),
}));

function authedRequest(body: unknown) {
  return new Request("http://localhost/nutrition/ai/estimate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("nutritionAiEstimateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    estimateFromPhotoMock.mockResolvedValue(VALID_ESTIMATE);
    usageLogRecordMock.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const response = await nutritionAiEstimateHandler.handle(
      new Request("http://localhost/nutrition/ai/estimate", {
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
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    await nutritionAiEstimateHandler.handle(
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
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(nutritionAiEstimateHandler);

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
    expect(estimateFromPhotoMock).not.toHaveBeenCalled();
  });

  it("writes a usage-log row on a 402 deny", async () => {
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
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(nutritionAiEstimateHandler);

    await app.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        endpoint: "/nutrition/ai/estimate",
        responseSizeBytes: null, // thrown before a response body was built
      }),
    );
  });

  it("returns 413 image_too_large when the decoded image exceeds 5MB", async () => {
    // 5MB + 1 byte of raw data, base64-encoded.
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff).toString(
      "base64",
    );
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const response = await nutritionAiEstimateHandler.handle(
      authedRequest({ imageBase64: oversized, mediaType: "image/jpeg" }),
    );

    expect(response.status).toBe(413);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "image_too_large" });
    expect(estimateFromPhotoMock).not.toHaveBeenCalled();
  });

  it("writes a usage-log row on a 413 reject", async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff).toString(
      "base64",
    );
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    await nutritionAiEstimateHandler.handle(
      authedRequest({ imageBase64: oversized, mediaType: "image/jpeg" }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/nutrition/ai/estimate" }),
    );
  });

  it("returns 400 invalid_image_data when the magic bytes don't match the declared mediaType", async () => {
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const response = await nutritionAiEstimateHandler.handle(
      authedRequest({
        imageBase64: INVALID_MAGIC_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "invalid_image_data" });
    expect(estimateFromPhotoMock).not.toHaveBeenCalled();
  });

  it("returns 422 ai_unreadable when the adapter throws AiUnreadableError", async () => {
    const { AiUnreadableError } =
      await import("../../../services/aiEstimation");
    estimateFromPhotoMock.mockRejectedValueOnce(
      new AiUnreadableError("model refused"),
    );

    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const response = await nutritionAiEstimateHandler.handle(
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
      await import("../../../services/aiEstimation");
    estimateFromPhotoMock.mockRejectedValueOnce(
      new AiUnreadableError("model refused"),
    );

    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    await nutritionAiEstimateHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/nutrition/ai/estimate",
        responseSizeBytes: expect.any(Number),
      }),
    );
  });

  it("returns 503 ai_unavailable when the adapter throws AiUnavailableError", async () => {
    const { AiUnavailableError } =
      await import("../../../services/aiEstimation");
    estimateFromPhotoMock.mockRejectedValueOnce(
      new AiUnavailableError("provider down"),
    );

    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const response = await nutritionAiEstimateHandler.handle(
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
      await import("../../../services/aiEstimation");
    estimateFromPhotoMock.mockRejectedValueOnce(
      new AiUnavailableError("provider down"),
    );

    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    await nutritionAiEstimateHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "/nutrition/ai/estimate" }),
    );
  });

  it("returns 200 with the estimate on the happy path", async () => {
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const response = await nutritionAiEstimateHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
        mealType: "lunch",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: VALID_ESTIMATE });
    expect(estimateFromPhotoMock).toHaveBeenCalledWith({
      imageBase64: VALID_JPEG_BASE64,
      mediaType: "image/jpeg",
      mealType: "lunch",
    });
  });

  it("accepts a valid PNG payload (magic-byte check covers both media types)", async () => {
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const response = await nutritionAiEstimateHandler.handle(
      authedRequest({
        imageBase64: VALID_PNG_BASE64,
        mediaType: "image/png",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: VALID_ESTIMATE });
  });

  it("returns 400 invalid_image_data when the base64 string decodes to zero bytes", async () => {
    // Passes t.String({ minLength: 1 }) (non-empty string) but decodes to
    // an empty Buffer — covers decodeBase64's "empty result" guard, which
    // is otherwise unreachable via the empty-string case (that's caught
    // by Elysia's own schema validation before the handler body runs).
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const response = await nutritionAiEstimateHandler.handle(
      authedRequest({ imageBase64: " ", mediaType: "image/jpeg" }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body).toEqual({ error: "invalid_image_data" });
    expect(estimateFromPhotoMock).not.toHaveBeenCalled();
  });

  it("writes a usage-log row on the 200 happy path", async () => {
    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    await nutritionAiEstimateHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(usageLogRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        endpoint: "/nutrition/ai/estimate",
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

    const { nutritionAiEstimateHandler } =
      await import("../nutritionAiEstimateHandler");
    const response = await nutritionAiEstimateHandler.handle(
      authedRequest({
        imageBase64: VALID_JPEG_BASE64,
        mediaType: "image/jpeg",
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body).toEqual({ data: VALID_ESTIMATE });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
