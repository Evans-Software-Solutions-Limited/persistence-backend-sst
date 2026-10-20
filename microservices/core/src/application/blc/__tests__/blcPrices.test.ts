import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);
vi.mock("../../stripe/stripeClient", () => ({
  getStripe: () => ({ prices: { list: listMock } }),
}));

import {
  BlcPriceError,
  __resetBlcPricesForTests,
  resolveBlcPrice,
} from "../blcPrices";
import { ALL_BLC_LOOKUP_KEYS, blcBillingCycle } from "../blcOffer";

/**
 * The four BLC Prices, resolved from Stripe by lookup key. As with the
 * founding resolver, most of what is asserted is REFUSAL: a Price is only used
 * once its amount, currency and billing interval match the catalogue.
 */
const PRICES = [
  {
    id: "price_pm",
    lookup_key: "web_premium_monthly",
    unit_amount: 1699,
    currency: "gbp",
    recurring: { interval: "month" },
  },
  {
    id: "price_pa",
    lookup_key: "web_premium_annual",
    unit_amount: 13999,
    currency: "gbp",
    recurring: { interval: "year" },
  },
  {
    id: "price_ppm",
    lookup_key: "web_premium_plus_monthly",
    unit_amount: 2999,
    currency: "gbp",
    recurring: { interval: "month" },
  },
  {
    id: "price_ppa",
    lookup_key: "web_premium_plus_annual",
    unit_amount: 24999,
    currency: "gbp",
    recurring: { interval: "year" },
  },
];

describe("resolveBlcPrice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetBlcPricesForTests();
    listMock.mockResolvedValue({ data: PRICES });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([
    ["premium", "monthly", "price_pm"],
    ["premium", "annual", "price_pa"],
    ["premium_plus", "monthly", "price_ppm"],
    ["premium_plus", "annual", "price_ppa"],
  ] as const)("resolves %s/%s to its Price", async (tier, cadence, id) => {
    expect(await resolveBlcPrice(tier, cadence)).toBe(id);
  });

  it("asks Stripe for all four keys at once, active only", async () => {
    await resolveBlcPrice("premium", "monthly");
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock.mock.calls[0]![0]).toEqual({
      lookup_keys: ALL_BLC_LOOKUP_KEYS,
      active: true,
      limit: 4,
    });
  });

  it("uses the agreed lookup keys, identical in test and live mode", () => {
    expect(ALL_BLC_LOOKUP_KEYS).toEqual([
      "web_premium_monthly",
      "web_premium_annual",
      "web_premium_plus_monthly",
      "web_premium_plus_annual",
    ]);
  });

  it("stores the web's 'annual' as the column's 'yearly'", () => {
    expect(blcBillingCycle("annual")).toBe("yearly");
    expect(blcBillingCycle("monthly")).toBe("monthly");
  });

  it("resolves the set once and reuses it", async () => {
    await resolveBlcPrice("premium", "monthly");
    await resolveBlcPrice("premium", "annual");
    await resolveBlcPrice("premium_plus", "annual");
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  describe("refusing a Price it cannot vouch for", () => {
    it("refuses a Price whose amount has been changed in the dashboard", async () => {
      listMock.mockResolvedValue({
        data: [{ ...PRICES[0]!, unit_amount: 1 }, ...PRICES.slice(1)],
      });
      await expect(resolveBlcPrice("premium", "monthly")).rejects.toThrow(
        BlcPriceError,
      );
    });

    it("refuses a Price in the wrong currency", async () => {
      listMock.mockResolvedValue({
        data: [{ ...PRICES[0]!, currency: "usd" }, ...PRICES.slice(1)],
      });
      await expect(resolveBlcPrice("premium", "monthly")).rejects.toThrow(
        BlcPriceError,
      );
    });

    it("refuses a monthly key re-pointed at an annual Price", async () => {
      // An amount check alone would pass this only by coincidence.
      listMock.mockResolvedValue({
        data: [
          { ...PRICES[0]!, recurring: { interval: "year" } },
          ...PRICES.slice(1),
        ],
      });
      await expect(resolveBlcPrice("premium", "monthly")).rejects.toThrow(
        BlcPriceError,
      );
    });

    it("refuses a one-off Price with no recurrence at all", async () => {
      listMock.mockResolvedValue({
        data: [{ ...PRICES[0]!, recurring: null }, ...PRICES.slice(1)],
      });
      await expect(resolveBlcPrice("premium", "monthly")).rejects.toThrow(
        BlcPriceError,
      );
    });

    it("refuses everything when ANY key is missing, and logs once", async () => {
      listMock.mockResolvedValue({ data: PRICES.slice(1) });
      await expect(resolveBlcPrice("premium", "annual")).rejects.toThrow(
        BlcPriceError,
      );
      await expect(resolveBlcPrice("premium", "annual")).rejects.toThrow(
        BlcPriceError,
      );
      const notUsable = vi
        .mocked(console.error)
        .mock.calls.filter((c) => String(c[0]).includes("not usable"));
      expect(notUsable).toHaveLength(1);
    });

    it("ignores Prices with no key or a key outside the catalogue", async () => {
      listMock.mockResolvedValue({
        data: [
          { id: "price_x", lookup_key: null, unit_amount: 1 },
          { id: "price_y", lookup_key: "founding_premium_6m", unit_amount: 1 },
          ...PRICES,
        ],
      });
      expect(await resolveBlcPrice("premium", "monthly")).toBe("price_pm");
    });

    it("refuses when Stripe cannot be reached, and retries next time", async () => {
      listMock.mockRejectedValueOnce(new Error("network"));
      await expect(resolveBlcPrice("premium", "monthly")).rejects.toThrow(
        BlcPriceError,
      );
      expect(await resolveBlcPrice("premium", "monthly")).toBe("price_pm");
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });
});
