/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PreferenceValidationError } from "../../../../repositories/nutritionPreferenceRepository";

const prefMocks = { get: vi.fn(), upsert: vi.fn() };
const assertEntitlementMock = vi.hoisted(() => vi.fn());

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

vi.mock("../../../../repositories/nutritionPreferenceRepository", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../repositories/nutritionPreferenceRepository")
  >("../../../../repositories/nutritionPreferenceRepository");
  return {
    ...actual,
    NutritionPreferenceRepository: vi.fn().mockImplementation(() => prefMocks),
  };
});
vi.mock("../../../../entitlement/assertEntitlement", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../entitlement/assertEntitlement")
  >("../../../../entitlement/assertEntitlement");
  return { ...actual, assertEntitlement: assertEntitlementMock };
});

const DEFAULTS = {
  userId: "test-user-id",
  dietaryPatterns: [],
  avoidAllergens: [],
  avoidFoods: [],
  likedFoods: [],
  mealsPerDay: 4,
  effortLevel: "balanced",
  locale: "en-GB",
  updatedAt: null,
  isDefault: true,
};

const VALID_BODY = {
  dietaryPatterns: ["vegetarian"],
  avoidAllergens: ["peanuts"],
  avoidFoods: ["mushrooms"],
  likedFoods: ["greek yogurt"],
  mealsPerDay: 4,
  effortLevel: "balanced",
  locale: "en-GB",
};

function get(auth = true) {
  return new Request("http://localhost/nutrition/preferences", {
    method: "GET",
    headers: auth ? { authorization: "Bearer token" } : {},
  });
}

function put(body: unknown, auth = true) {
  return new Request("http://localhost/nutrition/preferences", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: "Bearer token" } : {}),
    },
  });
}

describe("nutritionPreferencesGetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    prefMocks.get.mockResolvedValue(DEFAULTS);
  });

  it("requires auth", async () => {
    const { nutritionPreferencesGetHandler } =
      await import("../get/nutritionPreferencesGetHandler");
    expect(
      (await nutritionPreferencesGetHandler.handle(get(false))).status,
    ).toBe(401);
  });

  it("402s without exposing retained preferences after entitlement loss", async () => {
    assertEntitlementMock.mockResolvedValue({
      allowed: false,
      reason: "cancelled",
      currentTier: "free",
      upgradeTo: "premium_plus",
      upgradePriceMonthly: 1999,
    });
    const { default: Elysia } = await import("elysia");
    const { coreErrorHandler } =
      await import("../../../../../shared/errorHandler");
    const { nutritionPreferencesGetHandler } =
      await import("../get/nutritionPreferencesGetHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(nutritionPreferencesGetHandler);

    const res = await app.handle(get());

    expect(res.status).toBe(402);
    expect(prefMocks.get).not.toHaveBeenCalled();
  });

  it("returns the caller's preferences, scoped to their own id", async () => {
    const { nutritionPreferencesGetHandler } =
      await import("../get/nutritionPreferencesGetHandler");
    const res = await nutritionPreferencesGetHandler.handle(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: DEFAULTS });
    // No id parameter exists on this route, so the only reachable subject is the
    // JWT's own `sub` — asserted so a future "clientId" convenience param has to
    // come with an authorization check.
    expect(prefMocks.get).toHaveBeenCalledWith("test-user-id");
  });

  it("is 404-free: an absent row returns defaults with a 200 (AC 1.3)", async () => {
    const { nutritionPreferencesGetHandler } =
      await import("../get/nutritionPreferencesGetHandler");
    const res = await nutritionPreferencesGetHandler.handle(get());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.isDefault).toBe(true);
  });
});

describe("nutritionPreferencesSetHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertEntitlementMock.mockResolvedValue({ allowed: true });
    prefMocks.upsert.mockResolvedValue({ ...DEFAULTS, isDefault: false });
  });

  it("requires auth", async () => {
    const { nutritionPreferencesSetHandler } =
      await import("../set/nutritionPreferencesSetHandler");
    expect(
      (await nutritionPreferencesSetHandler.handle(put(VALID_BODY, false)))
        .status,
    ).toBe(401);
  });

  it("upserts for the caller and returns the stored row", async () => {
    const { nutritionPreferencesSetHandler } =
      await import("../set/nutritionPreferencesSetHandler");
    const res = await nutritionPreferencesSetHandler.handle(put(VALID_BODY));
    expect(res.status).toBe(200);
    expect(prefMocks.upsert).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({
        dietaryPatterns: ["vegetarian"],
        avoidAllergens: ["peanuts"],
        mealsPerDay: 4,
      }),
    );
    expect(((await res.json()) as any).data.isDefault).toBe(false);
  });

  // The schema's closed unions are built FROM the vocabulary module, so these
  // reject at the edge with the field named rather than reaching the repository.
  it.each([
    ["dietaryPatterns", { dietaryPatterns: ["carnivore"] }],
    ["avoidAllergens", { avoidAllergens: ["strawberries"] }],
    ["effortLevel", { effortLevel: "extreme" }],
    ["locale", { locale: "fr-FR" }],
    ["mealsPerDay too low", { mealsPerDay: 1 }],
    ["mealsPerDay too high", { mealsPerDay: 7 }],
  ])(
    "rejects an invalid %s before it reaches the repository",
    async (_l, over) => {
      const { nutritionPreferencesSetHandler } =
        await import("../set/nutritionPreferencesSetHandler");
      const res = await nutritionPreferencesSetHandler.handle(
        put({ ...VALID_BODY, ...over }),
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(prefMocks.upsert).not.toHaveBeenCalled();
    },
  );

  it("maps a PreferenceValidationError to a 400 naming the field and value", async () => {
    // Reachable despite the schema for the checks the schema cannot express —
    // the free-text length and count caps.
    prefMocks.upsert.mockRejectedValue(
      new PreferenceValidationError(
        "avoidFoods",
        "42",
        "at most 60 entries are allowed",
      ),
    );
    const { nutritionPreferencesSetHandler } =
      await import("../set/nutritionPreferencesSetHandler");
    const res = await nutritionPreferencesSetHandler.handle(put(VALID_BODY));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "INVALID_PREFERENCE",
      field: "avoidFoods",
      value: "42",
      message: "at most 60 entries are allowed",
    });
  });

  it("does not swallow an unexpected repository error as a 400", async () => {
    // A DB outage must not be reported to the client as "your preferences are
    // invalid" — that sends the user editing data that was fine.
    prefMocks.upsert.mockRejectedValue(new Error("connection terminated"));
    const { nutritionPreferencesSetHandler } =
      await import("../set/nutritionPreferencesSetHandler");
    const res = await nutritionPreferencesSetHandler.handle(put(VALID_BODY));
    expect(res.status).not.toBe(400);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
