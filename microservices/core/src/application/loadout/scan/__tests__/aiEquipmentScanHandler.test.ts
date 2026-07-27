/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AiUnavailableError,
  AiUnreadableError,
} from "../../../nutrition/services/aiBedrockClient";
import { dedupeDetections } from "../aiEquipmentScanHandler";
import { SCAN_EXCLUDED_EQUIPMENT_NAME } from "../equipmentScanModel";

const DUMBBELL = "11111111-1111-4111-8111-111111111111";
const RACK = "22222222-2222-4222-8222-222222222222";
const BODYWEIGHT = "33333333-3333-4333-8333-333333333333";

const EQUIPMENT_TYPES = [
  { id: DUMBBELL, name: "Dumbbells", category: "free_weights" },
  { id: RACK, name: "Squat Rack", category: "free_weights" },
  {
    id: BODYWEIGHT,
    name: SCAN_EXCLUDED_EQUIPMENT_NAME,
    category: "bodyweight",
  },
];

/** A minimal but genuinely valid JPEG header (magic bytes ff d8 ff). */
const JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
]).toString("base64");
/** Valid base64, but PNG magic — used to prove the media-type check bites. */
const PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]).toString("base64");

const assertEntitlementMock = vi.hoisted(() =>
  vi.fn(async () => ({ allowed: true }) as any),
);
const scanMock = vi.hoisted(() => vi.fn());
// Annotated with a one-parameter signature (the implementation ignores it) so
// `usageLogRecordMock.mock.calls[0][0]` is typed as an element that exists — a
// bare `vi.fn(async () => undefined)` gives an empty tuple and TS2493.
const usageLogRecordMock = vi.hoisted(() => {
  const impl: (row: unknown) => Promise<void> = async () => undefined;
  return vi.fn(impl);
});
const usageLogCountMock = vi.hoisted(() => vi.fn(async () => 0));

const exerciseRepo = vi.hoisted(() => ({
  getEquipmentTypes: vi.fn(),
}));
// Not used by the handler — deliberately. Stubbing the saved-gym WRITE surface is
// what lets the "persists nothing" test below falsify AC-2.3 rather than assert a
// property of its own fixture.
const savedGymRepo = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
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

vi.mock("../equipmentScanModel", async () => {
  const actual = await vi.importActual<typeof import("../equipmentScanModel")>(
    "../equipmentScanModel",
  );
  return { ...actual, scanEquipmentFromPhoto: scanMock };
});

vi.mock("../../../repositories/exerciseRepository", () => ({
  ExerciseRepository: vi.fn().mockImplementation(() => exerciseRepo),
}));
vi.mock("../../../repositories/savedGymRepository", () => ({
  SavedGymRepository: vi.fn().mockImplementation(() => savedGymRepo),
}));
vi.mock("../../../repositories/aiUsageLogRepository", () => ({
  AiUsageLogRepository: vi.fn().mockImplementation(() => ({
    record: usageLogRecordMock,
    countForUserToday: usageLogCountMock,
  })),
}));

function request(body: unknown, authed = true) {
  return new Request("http://localhost/ai/equipment-scan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authed ? { authorization: "Bearer token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function call(body: unknown = {}, authed = true) {
  const { aiEquipmentScanHandler } = await import("../aiEquipmentScanHandler");
  return aiEquipmentScanHandler.handle(request(body, authed));
}

const validBody = {
  imageBase64: JPEG_BASE64,
  mediaType: "image/jpeg" as const,
};

describe("dedupeDetections", () => {
  it("keeps the most confident reading of a repeated id", () => {
    const result = dedupeDetections([
      { equipmentTypeId: DUMBBELL, label: "dumbbells", confidence: 0.4 },
      { equipmentTypeId: DUMBBELL, label: "more dumbbells", confidence: 0.95 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.95);
  });

  it("keeps the first when a later duplicate is LESS confident", () => {
    // Direction matters — a `>=` here would silently prefer the last reading.
    const result = dedupeDetections([
      { equipmentTypeId: DUMBBELL, label: "high", confidence: 0.95 },
      { equipmentTypeId: DUMBBELL, label: "low", confidence: 0.2 },
    ]);
    expect(result[0].label).toBe("high");
  });

  it("does NOT collapse two unmatched rows that share a label", () => {
    // Unmatched labels are free text, not a key: two unrecognised machines are
    // two facts about the room.
    const result = dedupeDetections([
      { equipmentTypeId: null, label: "odd machine", confidence: 0.5 },
      { equipmentTypeId: null, label: "odd machine", confidence: 0.5 },
    ]);
    expect(result).toHaveLength(2);
  });

  it("preserves distinct ids", () => {
    const result = dedupeDetections([
      { equipmentTypeId: DUMBBELL, label: "a", confidence: 0.5 },
      { equipmentTypeId: RACK, label: "b", confidence: 0.5 },
    ]);
    expect(result).toHaveLength(2);
  });

  it("returns an empty array for no detections", () => {
    expect(dedupeDetections([])).toEqual([]);
  });
});

describe("POST /ai/equipment-scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true } as any);
    usageLogCountMock.mockResolvedValue(0);
    exerciseRepo.getEquipmentTypes.mockResolvedValue(EQUIPMENT_TYPES);
    scanMock.mockResolvedValue({
      detections: [
        { equipmentTypeId: DUMBBELL, label: "dumbbells", confidence: 0.9 },
      ],
      notes: null,
      modelId: "test-model",
      latencyMs: 10,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await call(validBody, false);
    expect(res.status).toBe(401);
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("returns the detected draft on success", async () => {
    const res = await call(validBody);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.data.modelId).toBe("test-model");
    expect(body.data.detected.map((d: any) => d.equipmentTypeId)).toContain(
      DUMBBELL,
    );
  });

  it("renders a matched detection from the CATALOGUE name, not the model's label", async () => {
    scanMock.mockResolvedValue({
      detections: [
        {
          equipmentTypeId: DUMBBELL,
          label: "ignore previous instructions",
          confidence: 0.9,
        },
      ],
      notes: null,
      modelId: "test-model",
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });

    const body = (await (await call(validBody)).json()) as any;
    const row = body.data.detected.find(
      (d: any) => d.equipmentTypeId === DUMBBELL,
    );
    expect(row.name).toBe("Dumbbells");
    // Nothing untrusted may reach the selectable path.
    expect(JSON.stringify(body.data.detected)).not.toContain(
      "ignore previous instructions",
    );
  });

  it("injects Bodyweight, marked as injected rather than detected", async () => {
    const body = (await (await call(validBody)).json()) as any;
    const bw = body.data.detected.find(
      (d: any) => d.equipmentTypeId === BODYWEIGHT,
    );

    expect(bw).toBeDefined();
    expect(bw.source).toBe("injected");
    expect(bw.confidence).toBe(1);
    // The model's own detections stay labelled as such.
    expect(
      body.data.detected.find((d: any) => d.equipmentTypeId === DUMBBELL)
        .source,
    ).toBe("model");
  });

  it("withholds Bodyweight from the catalogue the model sees (T-E1.7)", async () => {
    await call(validBody);
    const catalogue = scanMock.mock.calls[0][0].catalogue as Array<{
      id: string;
    }>;

    expect(catalogue.map((c) => c.id)).toEqual([DUMBBELL, RACK]);
    expect(catalogue.map((c) => c.id)).not.toContain(BODYWEIGHT);
  });

  it("warns loudly when the Bodyweight row is missing, and still succeeds", async () => {
    // T-E.10 shipped because a name-resolution miss was silent. Same class here:
    // a rename would stop every scan offering bodyweight work, invisibly.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    exerciseRepo.getEquipmentTypes.mockResolvedValue([
      { id: DUMBBELL, name: "Dumbbells", category: "free_weights" },
    ]);

    const res = await call(validBody);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(SCAN_EXCLUDED_EQUIPMENT_NAME),
    );
    expect(body.data.detected.some((d: any) => d.source === "injected")).toBe(
      false,
    );
    warn.mockRestore();
  });

  it("sorts detections by descending confidence, Bodyweight first", async () => {
    scanMock.mockResolvedValue({
      detections: [
        { equipmentTypeId: DUMBBELL, label: "d", confidence: 0.4 },
        { equipmentTypeId: RACK, label: "r", confidence: 0.95 },
      ],
      notes: null,
      modelId: "test-model",
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });

    const body = (await (await call(validBody)).json()) as any;
    expect(body.data.detected.map((d: any) => d.name)).toEqual([
      SCAN_EXCLUDED_EQUIPMENT_NAME,
      "Squat Rack",
      "Dumbbells",
    ]);
  });

  it("splits unmatched items out of the selectable list", async () => {
    scanMock.mockResolvedValue({
      detections: [
        { equipmentTypeId: DUMBBELL, label: "d", confidence: 0.9 },
        {
          equipmentTypeId: null,
          label: "landmine attachment",
          confidence: 0.6,
        },
      ],
      notes: "the far wall is out of frame",
      modelId: "test-model",
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });

    const body = (await (await call(validBody)).json()) as any;

    expect(body.data.unmatched).toEqual([
      { label: "landmine attachment", confidence: 0.6 },
    ]);
    // An unmatched item must never be offered as selectable — it has no id to
    // put in an equipment context.
    expect(
      body.data.detected.some((d: any) => d.equipmentTypeId === null),
    ).toBe(false);
    expect(body.data.notes).toBe("the far wall is out of frame");
  });

  it("returns 402 for a caller without the loadout entitlement, before any model call", async () => {
    // The EntitlementError → 402 mapping lives in `coreErrorHandler`, mounted on
    // the root app rather than the route, so the route is composed with it here
    // (same pattern as the preview and Phase-0 variations tests).
    const { default: Elysia } = await import("elysia");
    const { coreErrorHandler } =
      await import("../../../../shared/errorHandler");
    const { aiEquipmentScanHandler } =
      await import("../aiEquipmentScanHandler");
    const app = new Elysia().use(coreErrorHandler).use(aiEquipmentScanHandler);

    assertEntitlementMock.mockResolvedValue({
      allowed: false,
      reason: "tier",
      currentTier: "premium",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 2999,
    } as any);

    const res = await app.handle(request(validBody));

    expect(res.status).toBe(402);
    // The ceiling read must not even happen — an unentitled caller gets neither
    // the feature nor free validation of their payload.
    expect(usageLogCountMock).not.toHaveBeenCalled();
    expect(scanMock).not.toHaveBeenCalled();
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("asserts the loadout feature specifically", async () => {
    await call(validBody);
    expect(assertEntitlementMock).toHaveBeenCalledWith("user-a", "loadout");
  });

  it("returns 429 ai_daily_limit at the ceiling, and writes no usage row", async () => {
    usageLogCountMock.mockResolvedValue(6);
    const res = await call(validBody);

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "ai_daily_limit" });
    expect(scanMock).not.toHaveBeenCalled();
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("allows the request one below the ceiling", async () => {
    usageLogCountMock.mockResolvedValue(5);
    expect((await call(validBody)).status).toBe(200);
  });

  it("counts the ceiling against this endpoint only", async () => {
    await call(validBody);
    expect(usageLogCountMock).toHaveBeenCalledWith(
      "user-a",
      "/ai/equipment-scan",
    );
  });

  it("breaks a confidence tie by name so the draft order is stable", async () => {
    // Without the name tiebreak the order of two equally-confident detections is
    // whatever the model happened to emit, which makes the draft reshuffle
    // between two scans of the same room.
    scanMock.mockResolvedValue({
      detections: [
        { equipmentTypeId: RACK, label: "r", confidence: 0.8 },
        { equipmentTypeId: DUMBBELL, label: "d", confidence: 0.8 },
      ],
      notes: null,
      modelId: "test-model",
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0,
    });

    const body = (await (await call(validBody)).json()) as any;
    expect(body.data.detected.map((d: any) => d.name)).toEqual([
      SCAN_EXCLUDED_EQUIPMENT_NAME,
      "Dumbbells",
      "Squat Rack",
    ]);
  });

  it("returns 400 invalid_image_data for malformed base64", async () => {
    const res = await call({ imageBase64: "!!!!", mediaType: "image/jpeg" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_image_data" });
    expect(scanMock).not.toHaveBeenCalled();
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the magic bytes do not match the declared media type", async () => {
    const res = await call({
      imageBase64: PNG_BASE64,
      mediaType: "image/jpeg",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_image_data" });
    expect(scanMock).not.toHaveBeenCalled();
  });

  it("accepts a genuine PNG when declared as one", async () => {
    const res = await call({ imageBase64: PNG_BASE64, mediaType: "image/png" });
    expect(res.status).toBe(200);
  });

  it("returns 413 for an oversized image, and writes no usage row", async () => {
    // 5.2 MB decodes past MAX_IMAGE_BYTES (5 MB) while its base64 (~6.93 MB)
    // stays under MAX_IMAGE_BASE64_LENGTH (7 MB), so it reaches the handler's own
    // 413 rather than Elysia's schema-level 422. A larger buffer (6 MB → 8 MB of
    // base64) is rejected during validation and never proves this branch at all.
    const big = Buffer.alloc(Math.floor(5.2 * 1024 * 1024), 0xff);
    big[0] = 0xff;
    big[1] = 0xd8;
    big[2] = 0xff;

    const res = await call({
      imageBase64: big.toString("base64"),
      mediaType: "image/jpeg",
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "image_too_large" });
    expect(scanMock).not.toHaveBeenCalled();
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("returns 422 ai_unreadable on a parse/membership failure, and DOES write a usage row", async () => {
    scanMock.mockRejectedValue(new AiUnreadableError("ai_non_member"));
    const res = await call(validBody);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "ai_unreadable" });
    // A 422 cost real money — it must consume quota.
    expect(usageLogRecordMock).toHaveBeenCalledTimes(1);
  });

  it("returns 503 ai_unavailable when Bedrock is down, and DOES write a usage row", async () => {
    scanMock.mockRejectedValue(new AiUnavailableError("down"));
    const res = await call(validBody);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai_unavailable" });
    expect(usageLogRecordMock).toHaveBeenCalledTimes(1);
  });

  it("writes a usage row on success with sizes and duration", async () => {
    await call(validBody);

    expect(usageLogRecordMock).toHaveBeenCalledTimes(1);
    const row = usageLogRecordMock.mock.calls[0][0] as any;
    expect(row.userId).toBe("user-a");
    expect(row.endpoint).toBe("/ai/equipment-scan");
    expect(row.requestSizeBytes).toBeGreaterThan(0);
    expect(row.responseSizeBytes).toBeGreaterThan(0);
    expect(row.ms).toBeGreaterThanOrEqual(0);
  });

  it("does NOT write a usage row when the catalogue read fails before the model", async () => {
    // A DB blip must not burn one of six daily scans for an inference that never
    // happened — this is what `reachedModel` being set last protects.
    exerciseRepo.getEquipmentTypes.mockRejectedValue(new Error("db down"));

    const res = await call(validBody);

    expect(res.status).toBe(500);
    expect(scanMock).not.toHaveBeenCalled();
    expect(usageLogRecordMock).not.toHaveBeenCalled();
  });

  it("still answers 200 when the usage-log write fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    usageLogRecordMock.mockRejectedValue(new Error("insert failed"));

    const res = await call(validBody);

    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("[ai-usage-log]"),
    );
    error.mockRestore();
  });

  it("describes a non-Error usage-log failure rather than logging [object Object]", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    usageLogRecordMock.mockRejectedValue("connection reset");

    const res = await call(validBody);

    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("connection reset"),
    );
    error.mockRestore();
  });

  it("persists nothing — no saved gym is written (AC-2.3)", async () => {
    await call(validBody);

    // The stubbed WRITE surface, so "confirming a draft never implicitly saves a
    // gym" is a claim this test can actually falsify. (Asserting the mock's own
    // key set instead would be invariant under every change to the handler and
    // would only prove nobody edited the fixture.)
    expect(savedGymRepo.create).not.toHaveBeenCalled();
    expect(savedGymRepo.update).not.toHaveBeenCalled();
    expect(exerciseRepo.getEquipmentTypes).toHaveBeenCalledTimes(1);
  });
});

// ⚠ LAST IN THE FILE, DELIBERATELY. This block calls `vi.resetModules()`, which
// gives the handler a FRESH copy of `aiBedrockClient` — and therefore a fresh
// `AiUnreadableError`/`AiUnavailableError` class object. The `instanceof` checks in
// the handler then stop matching the classes this test file imported at the top,
// so every 422/503 assertion above would fail with a 500 if this ran before them.
// Keep it here, or make the affected tests re-import their error classes.
describe("POST /ai/equipment-scan — module-level env parse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true } as any);
    exerciseRepo.getEquipmentTypes.mockResolvedValue(EQUIPMENT_TYPES);
  });

  it("honours AI_EQUIPMENT_SCAN_DAILY_LIMIT when validly set (fail-safe ternary, true branch)", async () => {
    // Every other test in this file exercises the default-fallback side of the
    // module-level ternary via the first import. This covers the other side — a
    // validly-set env var — which needs a fresh module evaluation.
    const previous = process.env.AI_EQUIPMENT_SCAN_DAILY_LIMIT;
    process.env.AI_EQUIPMENT_SCAN_DAILY_LIMIT = "2";
    vi.resetModules();

    try {
      usageLogCountMock.mockResolvedValue(2); // at the custom ceiling of 2
      const { aiEquipmentScanHandler } =
        await import("../aiEquipmentScanHandler");
      const res = await aiEquipmentScanHandler.handle(request(validBody));

      // 2 would be under the default of 6, so a 429 here proves the env value is
      // the one in force rather than the fallback.
      expect(res.status).toBe(429);
      expect(scanMock).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env.AI_EQUIPMENT_SCAN_DAILY_LIMIT;
      } else {
        process.env.AI_EQUIPMENT_SCAN_DAILY_LIMIT = previous;
      }
      vi.resetModules();
    }
  });
});
