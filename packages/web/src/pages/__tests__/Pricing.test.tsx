import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { renderPage } from "@/test-utils";
import Pricing from "../Pricing";

const LIVE_TIERS = [
  ["free", 0, null],
  ["premium", 16.99, 139.99],
  ["premium_plus", 29.99, 249.99],
  ["individual_trainer", 18.99, 159.99],
  ["start_up_coach_plus", 34.99, 289.99],
  ["coach", 59.99, 499.99],
  ["coach_pro", 99.99, 839.99],
] as const;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: LIVE_TIERS.map(([tierName, priceMonthly, priceYearly]) => ({
          tierName,
          priceMonthly,
          priceYearly,
        })),
      }),
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Pricing", () => {
  it("renders individual prices from the live API and disables web IAP calls to action", async () => {
    renderPage(<Pricing />);
    const premium = screen.getByTestId("pricing-tier-premium");
    const premiumPlus = screen.getByTestId("pricing-tier-premium_plus");

    expect(await within(premium).findByText("139.99")).toBeDefined();
    expect(await within(premiumPlus).findByText("249.99")).toBeDefined();
    expect(
      within(premium).getByText("Coming soon").getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("derives savings per tier from live prices when cadence changes", async () => {
    renderPage(<Pricing />);
    expect(
      await within(screen.getByTestId("pricing-tier-premium")).findByText(
        /save 31%/i,
      ),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: "Coaches" }));
    expect(
      await within(
        screen.getByTestId("pricing-tier-individual_trainer"),
      ).findByText(/save 30%/i),
    ).toBeDefined();
  });

  it("does not fall back to a build-time IAP amount when live pricing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    renderPage(<Pricing />);

    expect(
      await within(screen.getByTestId("pricing-tier-premium")).findByText(
        "Unavailable",
      ),
    ).toBeDefined();
    expect(screen.queryByText("139.99")).toBeNull();
  });

  it("keeps Premium+ led by Loadout and Mealprint with no fictional workout feature", () => {
    renderPage(<Pricing />);
    const premiumPlus = screen.getByTestId("pricing-tier-premium_plus");
    expect(within(premiumPlus).getByText(/Loadout —/i)).toBeDefined();
    expect(within(premiumPlus).getByText(/Mealprint —/i)).toBeDefined();
    expect(
      within(premiumPlus).queryByText(/AI Workout Suggestions/i),
    ).toBeNull();
  });

  it("renders the coach entry fork and makes the suite explicit on every card", () => {
    renderPage(<Pricing />);
    fireEvent.click(screen.getByRole("tab", { name: "Coaches" }));

    expect(
      within(screen.getByTestId("pricing-tier-individual_trainer")).getByText(
        "Start Up Coach",
      ),
    ).toBeDefined();
    expect(
      within(screen.getByTestId("pricing-tier-start_up_coach_plus")).getByText(
        "Start Up Coach +",
      ),
    ).toBeDefined();
    expect(screen.getAllByText("Adaptive suite not included")).toHaveLength(1);
    expect(screen.getAllByText("Loadout + Mealprint included")).toHaveLength(3);
  });

  it("renders web-only organisation tiers with live web calls to action", () => {
    renderPage(<Pricing />);
    fireEvent.click(screen.getByRole("tab", { name: "Organisations" }));

    expect(screen.getByTestId("pricing-tier-studio")).toBeDefined();
    expect(screen.getByTestId("pricing-tier-studio_pro")).toBeDefined();
    expect(screen.getByTestId("pricing-tier-enterprise")).toBeDefined();
    expect(screen.getAllByRole("link", { name: "Start trial" })).toHaveLength(
      2,
    );
    expect(screen.getByRole("link", { name: "Talk to us" })).toBeDefined();
  });

  it("never renders VAT caveats or competitor names", () => {
    const { container } = renderPage(<Pricing />);
    fireEvent.click(screen.getByRole("tab", { name: "Organisations" }));
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bVAT\b|excl\.|incl\./i);
    expect(text).not.toMatch(/Trainerize|MyFitnessPal/i);
  });
});
