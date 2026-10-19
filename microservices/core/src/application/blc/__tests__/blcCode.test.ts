import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);
vi.mock("../../stripe/stripeClient", () => ({
  getStripe: () => ({ promotionCodes: { list: listMock } }),
}));

import { resolveBlcPromotionCode } from "../blcCode";

const COUPON = "blc_coupon_20";

function promo(over: Record<string, unknown> = {}) {
  return {
    id: "promo_1",
    code: "BLC-TEST",
    active: true,
    expires_at: null,
    max_redemptions: null,
    times_redeemed: 0,
    promotion: {
      type: "coupon",
      coupon: { id: COUPON, valid: true },
    },
    ...over,
  };
}

/**
 * Every refusal is the same `null`: the route says `invalid_code` whether the
 * code is unknown, used up, expired or on the wrong coupon, so nobody can
 * probe which codes exist.
 */
describe("resolveBlcPromotionCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BLC_STRIPE_COUPON_ID", COUPON);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    listMock.mockResolvedValue({ data: [promo()] });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("accepts an active code on the BLC coupon and returns Stripe's spelling", async () => {
    expect(await resolveBlcPromotionCode("  blc-test ")).toEqual({
      id: "promo_1",
      code: "BLC-TEST",
    });
    // Trimmed only — Stripe's lookup is case-insensitive, and dashes are part
    // of the code as created.
    expect(listMock).toHaveBeenCalledWith({
      code: "blc-test",
      active: true,
      limit: 1,
    });
  });

  it("accepts a coupon referenced by id rather than expanded", async () => {
    listMock.mockResolvedValue({
      data: [promo({ promotion: { type: "coupon", coupon: COUPON } })],
    });
    expect(await resolveBlcPromotionCode("BLC-TEST")).not.toBeNull();
  });

  it("reads a top-level coupon from an older API version's payload", async () => {
    listMock.mockResolvedValue({
      data: [
        promo({ promotion: undefined, coupon: { id: COUPON, valid: true } }),
      ],
    });
    expect(await resolveBlcPromotionCode("BLC-TEST")).not.toBeNull();
  });

  it("still honours a code that has redemptions left", async () => {
    listMock.mockResolvedValue({
      data: [promo({ max_redemptions: 5, times_redeemed: 4 })],
    });
    expect(await resolveBlcPromotionCode("BLC-TEST")).not.toBeNull();
  });

  it("still honours a code that expires later today", async () => {
    listMock.mockResolvedValue({
      data: [promo({ expires_at: Math.floor(Date.now() / 1000) + 3600 })],
    });
    expect(await resolveBlcPromotionCode("BLC-TEST")).not.toBeNull();
  });

  describe("refuses, neutrally", () => {
    it("an unknown code", async () => {
      listMock.mockResolvedValue({ data: [] });
      expect(await resolveBlcPromotionCode("NOPE")).toBeNull();
    });

    it("an empty code without asking Stripe", async () => {
      expect(await resolveBlcPromotionCode("   ")).toBeNull();
      expect(listMock).not.toHaveBeenCalled();
    });

    it("an inactive code", async () => {
      listMock.mockResolvedValue({ data: [promo({ active: false })] });
      expect(await resolveBlcPromotionCode("BLC-TEST")).toBeNull();
    });

    it("a code on some OTHER coupon — the whole point of the check", async () => {
      listMock.mockResolvedValue({
        data: [
          promo({
            promotion: { type: "coupon", coupon: { id: "other", valid: true } },
          }),
        ],
      });
      expect(await resolveBlcPromotionCode("BLC-TEST")).toBeNull();
    });

    it("a code whose coupon is no longer valid", async () => {
      listMock.mockResolvedValue({
        data: [
          promo({
            promotion: { type: "coupon", coupon: { id: COUPON, valid: false } },
          }),
        ],
      });
      expect(await resolveBlcPromotionCode("BLC-TEST")).toBeNull();
    });

    it("a code with no coupon at all", async () => {
      listMock.mockResolvedValue({
        data: [promo({ promotion: { type: "coupon", coupon: null } })],
      });
      expect(await resolveBlcPromotionCode("BLC-TEST")).toBeNull();
    });

    it("an expired code", async () => {
      listMock.mockResolvedValue({
        data: [promo({ expires_at: Math.floor(Date.now() / 1000) - 1 })],
      });
      expect(await resolveBlcPromotionCode("BLC-TEST")).toBeNull();
    });

    it("a code that has hit its redemption cap", async () => {
      listMock.mockResolvedValue({
        data: [promo({ max_redemptions: 1, times_redeemed: 1 })],
      });
      expect(await resolveBlcPromotionCode("BLC-TEST")).toBeNull();
    });

    it("everything, when the BLC coupon is not configured on this stage", async () => {
      vi.stubEnv("BLC_STRIPE_COUPON_ID", "");
      expect(await resolveBlcPromotionCode("BLC-TEST")).toBeNull();
      expect(listMock).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("BLC_STRIPE_COUPON_ID"),
      );
    });
  });
});
