/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionTiersRepositoryMocks = {
  listActive: vi.fn(),
};

vi.mock("../../../repositories/subscriptionTiersRepository", () => ({
  SubscriptionTiersRepository: vi
    .fn()
    .mockImplementation(() => subscriptionTiersRepositoryMocks),
}));

function tierRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "tier-uuid",
    tierName: "premium",
    displayName: "Basic",
    description: "Limited workouts",
    priceMonthly: "9.99",
    priceYearly: "95.88",
    currency: "GBP",
    features: { workouts: "limited" },
    workoutLimit: 20,
    aiAccess: true,
    aiWorkoutLimit: 1,
    gymBuddyAccess: false,
    gymBuddyCanCreateWorkouts: false,
    gymBuddyCanSuggestWorkouts: false,
    trainerClientLimit: null,
    isTrainerTier: false,
    analyticsAccess: false,
    exportAccess: false,
    isActive: true,
    stripePriceIdMonthly: "price_basic_monthly",
    stripePriceIdYearly: "price_basic_yearly",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

async function getTiers(withAuth = false) {
  const { subscriptionsTiersHandler } =
    await import("../subscriptionsTiersHandler");
  return subscriptionsTiersHandler.handle(
    new Request("http://localhost/subscription-tiers", {
      method: "GET",
      headers: {
        ...(withAuth ? { authorization: "Bearer test-token" } : {}),
      },
    }),
  );
}

describe("subscriptionsTiersHandler — pure helpers", () => {
  it("decimalToNumber parses decimal strings, passes through numbers, returns null for null", async () => {
    const { __internals } = await import("../subscriptionsTiersHandler");
    expect(__internals.decimalToNumber("9.99")).toBe(9.99);
    expect(__internals.decimalToNumber("0")).toBe(0);
    expect(__internals.decimalToNumber(12.5)).toBe(12.5);
    expect(__internals.decimalToNumber(null)).toBeNull();
    // Non-finite numeric input (e.g. NaN) collapses to null defensively.
    expect(__internals.decimalToNumber(Number.NaN)).toBeNull();
    expect(__internals.decimalToNumber(Number.POSITIVE_INFINITY)).toBeNull();
    // Unparseable string collapses to null.
    expect(__internals.decimalToNumber("not a number")).toBeNull();
  });

  it("requiredDecimal defaults to 0 when underlying value is null/unparseable", async () => {
    const { __internals } = await import("../subscriptionsTiersHandler");
    expect(__internals.requiredDecimal("9.99")).toBe(9.99);
    expect(__internals.requiredDecimal(null)).toBe(0);
    expect(__internals.requiredDecimal("garbage")).toBe(0);
  });

  it("mapTierRowToWire converts decimals to numbers and applies defaults for nullable booleans", async () => {
    const { __internals } = await import("../subscriptionsTiersHandler");
    const wire = __internals.mapTierRowToWire(
      tierRow({
        aiAccess: null,
        gymBuddyAccess: null,
        analyticsAccess: null,
        exportAccess: null,
        isTrainerTier: null,
        currency: null,
        priceYearly: null,
        aiWorkoutLimit: null,
        features: null,
        description: null,
      }) as any,
    );
    expect(wire.priceMonthly).toBe(9.99);
    expect(wire.priceYearly).toBeNull();
    expect(wire.currency).toBe("GBP"); // default
    expect(wire.aiAccess).toBe(false); // null → false
    expect(wire.gymBuddyAccess).toBe(false);
    expect(wire.analyticsAccess).toBe(false);
    expect(wire.exportAccess).toBe(false);
    expect(wire.isTrainerTier).toBe(false);
    expect(wire.aiWorkoutLimit).toBe(0);
    expect(wire.features).toEqual({});
    expect(wire.description).toBeNull();
  });

  it("mapTierRowToWire preserves non-null values for all fields (covers the no-default branches)", async () => {
    const { __internals } = await import("../subscriptionsTiersHandler");
    const wire = __internals.mapTierRowToWire(
      tierRow({
        description: "All-the-fixings tier",
        currency: "USD",
        workoutLimit: 50,
        aiWorkoutLimit: 6,
        trainerClientLimit: 25,
        isTrainerTier: true,
        analyticsAccess: true,
        exportAccess: true,
        stripePriceIdMonthly: "price_m",
        stripePriceIdYearly: "price_y",
        features: { workouts: "unlimited", custom_branding: true },
      }) as any,
    );
    expect(wire.description).toBe("All-the-fixings tier");
    expect(wire.currency).toBe("USD");
    expect(wire.workoutLimit).toBe(50);
    expect(wire.aiWorkoutLimit).toBe(6);
    expect(wire.trainerClientLimit).toBe(25);
    expect(wire.isTrainerTier).toBe(true);
    expect(wire.analyticsAccess).toBe(true);
    expect(wire.exportAccess).toBe(true);
    expect(wire.stripePriceIdMonthly).toBe("price_m");
    expect(wire.stripePriceIdYearly).toBe("price_y");
    expect(wire.features).toEqual({
      workouts: "unlimited",
      custom_branding: true,
    });
  });

  it("mapTierRowToWire treats null nullable-int columns as null on the wire", async () => {
    const { __internals } = await import("../subscriptionsTiersHandler");
    const wire = __internals.mapTierRowToWire(
      tierRow({
        workoutLimit: null,
        trainerClientLimit: null,
        stripePriceIdMonthly: null,
        stripePriceIdYearly: null,
      }) as any,
    );
    expect(wire.workoutLimit).toBeNull();
    expect(wire.trainerClientLimit).toBeNull();
    expect(wire.stripePriceIdMonthly).toBeNull();
    expect(wire.stripePriceIdYearly).toBeNull();
  });
});

describe("subscriptionsTiersHandler — GET /subscription-tiers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the catalog without requiring auth", async () => {
    subscriptionTiersRepositoryMocks.listActive.mockResolvedValueOnce([
      tierRow(),
    ]);
    const res = await getTiers(false);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      tierName: "premium",
      displayName: "Basic",
      priceMonthly: 9.99,
      priceYearly: 95.88,
      currency: "GBP",
      stripePriceIdMonthly: "price_basic_monthly",
    });
  });

  it("returns empty data array with 200 when the catalog is empty (deploy misconfig is not a runtime error)", async () => {
    subscriptionTiersRepositoryMocks.listActive.mockResolvedValueOnce([]);
    const res = await getTiers();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({ data: [] });
  });

  it("maps every row through mapTierRowToWire — multi-tier list", async () => {
    subscriptionTiersRepositoryMocks.listActive.mockResolvedValueOnce([
      tierRow({ tierName: "free", priceMonthly: "0", displayName: "Free" }),
      tierRow({
        tierName: "premium",
        priceMonthly: "9.99",
        displayName: "Basic",
      }),
      tierRow({
        tierName: "premium",
        priceMonthly: "14.99",
        displayName: "Premium",
        aiAccess: true,
        gymBuddyAccess: true,
      }),
    ]);
    const res = await getTiers();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.map((t: any) => t.tierName)).toEqual([
      "free",
      "premium",
      "premium",
    ]);
    expect(body.data[0].priceMonthly).toBe(0);
    expect(body.data[2].aiAccess).toBe(true);
    expect(body.data[2].gymBuddyAccess).toBe(true);
  });
});
