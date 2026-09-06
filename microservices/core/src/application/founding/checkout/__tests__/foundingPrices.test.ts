import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
);
vi.mock("../../../stripe/stripeClient", () => ({
  getStripe: () => ({ prices: { list: listMock } }),
}));

import {
  resolveFoundingPrice,
  __resetFoundingPricesForTests,
} from "../foundingPrices";
import { ALL_FOUNDING_LOOKUP_KEYS } from "../../foundingOffer";

/**
 * The four founding Prices, resolved from Stripe by lookup key.
 *
 * The point of the whole file is that a Price is USED only once it has been
 * checked against the amount the page advertises — so most of what is asserted
 * here is refusal, not resolution.
 */
const PRICES = [
  {
    id: "price_a",
    lookup_key: "founding_premium_6m",
    unit_amount: 3000,
    currency: "gbp",
  },
  {
    id: "price_b",
    lookup_key: "founding_premium_12m",
    unit_amount: 6000,
    currency: "gbp",
  },
  {
    id: "price_c",
    lookup_key: "founding_premium_plus_6m",
    unit_amount: 5000,
    currency: "gbp",
  },
  {
    id: "price_d",
    lookup_key: "founding_premium_plus_12m",
    unit_amount: 10000,
    currency: "gbp",
  },
];

describe("resolveFoundingPrice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetFoundingPricesForTests();
    listMock.mockResolvedValue({ data: PRICES });
  });

  it.each([
    ["premium", 6, "price_a"],
    ["premium", 12, "price_b"],
    ["premium_plus", 6, "price_c"],
    ["premium_plus", 12, "price_d"],
  ] as const)("resolves %s/%im to its Price", async (tier, months, id) => {
    expect(await resolveFoundingPrice(tier, months)).toEqual({
      ok: true,
      priceId: id,
    });
  });

  it("asks Stripe for all four keys at once, active only", async () => {
    await resolveFoundingPrice("premium", 6);
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock.mock.calls[0]![0]).toEqual({
      lookup_keys: ALL_FOUNDING_LOOKUP_KEYS,
      active: true,
      limit: 4,
    });
  });

  it("uses lookup keys that are identical in test and live mode", async () => {
    // The whole reason for keys over ids: `STRIPE_SECRET_KEY` stays the only
    // per-environment value, so staging cannot be pointed at a live Price.
    expect(ALL_FOUNDING_LOOKUP_KEYS).toEqual([
      "founding_premium_6m",
      "founding_premium_12m",
      "founding_premium_plus_6m",
      "founding_premium_plus_12m",
    ]);
  });

  it("resolves the set once and reuses it", async () => {
    await resolveFoundingPrice("premium", 6);
    await resolveFoundingPrice("premium", 12);
    await resolveFoundingPrice("premium_plus", 6);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  describe("refusing a Price it cannot vouch for", () => {
    beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

    it("refuses a Price whose amount has been changed in the dashboard", async () => {
      // The guard that matters. A key re-pointed at a cheaper (or dearer)
      // Price would otherwise change what the page charges with no code change
      // and no warning.
      listMock.mockResolvedValue({
        data: [{ ...PRICES[0]!, unit_amount: 1 }, ...PRICES.slice(1)],
      });
      expect(await resolveFoundingPrice("premium", 6)).toEqual({
        ok: false,
        reason: "unavailable",
      });
    });

    it("refuses a Price in the wrong currency", async () => {
      listMock.mockResolvedValue({
        data: [{ ...PRICES[0]!, currency: "usd" }, ...PRICES.slice(1)],
      });
      expect(await resolveFoundingPrice("premium", 6)).toEqual({
        ok: false,
        reason: "unavailable",
      });
    });

    it("refuses everything when ANY key is missing", async () => {
      // A half-configured account sells three terms and 500s on the fourth.
      // Refusing the set makes the misconfiguration obvious at once.
      listMock.mockResolvedValue({ data: PRICES.slice(1) });
      expect(await resolveFoundingPrice("premium", 12)).toEqual({
        ok: false,
        reason: "unavailable",
      });
    });

    it("refuses when Stripe cannot be reached", async () => {
      listMock.mockRejectedValue(new Error("network"));
      expect(await resolveFoundingPrice("premium", 6)).toEqual({
        ok: false,
        reason: "unavailable",
      });
    });

    it("ignores a Price carrying a lookup key we did not ask for", async () => {
      listMock.mockResolvedValue({
        data: [
          ...PRICES,
          {
            id: "price_x",
            lookup_key: "something_else",
            unit_amount: 1,
            currency: "gbp",
          },
        ],
      });
      expect(await resolveFoundingPrice("premium", 6)).toEqual({
        ok: true,
        priceId: "price_a",
      });
    });

    it("ignores a Price with no lookup key at all", async () => {
      listMock.mockResolvedValue({
        data: [
          {
            id: "price_y",
            lookup_key: null,
            unit_amount: 3000,
            currency: "gbp",
          },
          ...PRICES,
        ],
      });
      expect(await resolveFoundingPrice("premium", 6)).toEqual({
        ok: true,
        priceId: "price_a",
      });
    });

    it("logs the misconfiguration once, not on every checkout", async () => {
      listMock.mockResolvedValue({ data: [] });
      await resolveFoundingPrice("premium", 6);
      await resolveFoundingPrice("premium", 6);
      const lines = (
        console.error as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes("not usable"));
      expect(lines).toHaveLength(1);
    });

    it("does not cache a failure — a key created later works without a redeploy", async () => {
      listMock.mockResolvedValueOnce({ data: [] });
      expect((await resolveFoundingPrice("premium", 6)).ok).toBe(false);
      listMock.mockResolvedValue({ data: PRICES });
      expect(await resolveFoundingPrice("premium", 6)).toEqual({
        ok: true,
        priceId: "price_a",
      });
    });
  });
});
