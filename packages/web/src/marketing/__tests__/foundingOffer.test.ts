import {
  FOUNDING_OFFER_CLOSES,
  FOUNDING_PLANS,
  formatPrice,
  foundingOfferIsOpen,
} from "../foundingOffer";

describe("the founding plan table", () => {
  it("offers each tier at both terms, and nothing else", () => {
    expect(FOUNDING_PLANS.map((p) => `${p.tier}/${p.months}`).sort()).toEqual([
      "premium/12",
      "premium/6",
      "premium_plus/12",
      "premium_plus/6",
    ]);
  });

  it("mirrors the prices in the 2026-09-05 amendment", () => {
    // Display only — Stripe's Price decides what is charged. This guards the
    // page against advertising a figure the Prices no longer match.
    expect(
      Object.fromEntries(
        FOUNDING_PLANS.map((p) => [`${p.tier}/${p.months}`, p.priceMinor]),
      ),
    ).toEqual({
      "premium/6": 3000,
      "premium/12": 6000,
      "premium_plus/6": 5000,
      "premium_plus/12": 10000,
    });
  });

  it("does not sell the coach tier on the web", () => {
    // Coach access is admin/enquiry only; a coach button here would sell a
    // seat out of a pool the page never shows.
    expect(FOUNDING_PLANS.some((p) => String(p.tier).includes("coach"))).toBe(
      false,
    );
  });
});

describe("formatPrice", () => {
  it("drops the pence on a round amount", () => {
    expect(formatPrice(3000)).toBe("£30");
    expect(formatPrice(10000)).toBe("£100");
  });

  it("keeps the pence when there are any", () => {
    expect(formatPrice(2999)).toBe("£29.99");
  });
});

describe("foundingOfferIsOpen", () => {
  it("is open a second before the close", () => {
    expect(
      foundingOfferIsOpen(new Date(FOUNDING_OFFER_CLOSES.getTime() - 1000)),
    ).toBe(true);
  });

  it("is open on the closing second itself", () => {
    expect(foundingOfferIsOpen(FOUNDING_OFFER_CLOSES)).toBe(true);
  });

  it("is closed a second after", () => {
    expect(
      foundingOfferIsOpen(new Date(FOUNDING_OFFER_CLOSES.getTime() + 1000)),
    ).toBe(false);
  });

  it("reads the clock when given no time", () => {
    expect(typeof foundingOfferIsOpen()).toBe("boolean");
  });

  it("closes at 30 September 2026, 23:59:59 British Summer Time", () => {
    // An absolute instant with an explicit offset, so the cut-off is the same
    // for a buyer in Sydney as for one in Nottingham.
    expect(FOUNDING_OFFER_CLOSES.toISOString()).toBe(
      "2026-09-30T22:59:59.000Z",
    );
  });
});
