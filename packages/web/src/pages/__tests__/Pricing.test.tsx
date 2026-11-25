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
  it("renders live individual prices with working get-the-app calls to action", async () => {
    renderPage(<Pricing />);
    const premium = screen.getByTestId("pricing-tier-premium");
    const premiumPlus = screen.getByTestId("pricing-tier-premium_plus");

    expect(await within(premium).findByText("139.99")).toBeDefined();
    expect(await within(premiumPlus).findByText("249.99")).toBeDefined();
    expect(
      within(premium)
        .getByRole("link", { name: "Get the app" })
        .getAttribute("href"),
    ).toBe("/#download");
    expect(
      within(premiumPlus)
        .getByRole("link", { name: "Get the app" })
        .getAttribute("href"),
    ).toBe("/#download");
    expect(screen.queryByText("Coming soon")).toBeNull();
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

  it("keeps Premium+ led by AI, Loadout and Mealprint with no fictional workout feature", () => {
    renderPage(<Pricing />);
    const premiumPlus = screen.getByTestId("pricing-tier-premium_plus");
    expect(within(premiumPlus).getByText(/AI food logging/i)).toBeDefined();
    expect(within(premiumPlus).getByText(/^Loadout:/i)).toBeDefined();
    expect(within(premiumPlus).getByText(/^Mealprint:/i)).toBeDefined();
    expect(
      within(premiumPlus).queryByText(/AI Workout Suggestions/i),
    ).toBeNull();
  });

  // PER-103: the Individuals intro matches the store listings: Premium is
  // workouts and Train Together, Premium+ is every AI feature.
  it("describes Individuals plans as the store listings do", () => {
    renderPage(<Pricing />);
    expect(
      screen.getByText(
        "Free to start. Premium adds unlimited workouts and Train Together with your partners. Premium+ adds every AI feature, including Mealprint and Loadout.",
      ),
    ).toBeDefined();
    expect(screen.queryByText(/full adaptive suite/i)).toBeNull();
  });

  // PER-103: Premium carries no AI, so its card must not promise any.
  it("shows no AI feature on the Premium card", () => {
    renderPage(<Pricing />);
    const premium = screen.getByTestId("pricing-tier-premium");
    expect(within(premium).queryByText(/\bAI\b/)).toBeNull();
    expect(within(premium).getByText("Unlimited workouts")).toBeDefined();
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

  // PER-146: the coach plans page.
  it("opens the Coaches tab directly from ?for=coaches", () => {
    renderPage(<Pricing />, { route: "/pricing?for=coaches" });
    expect(
      screen
        .getByRole("tab", { name: "Coaches" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByTestId("pricing-tier-individual_trainer")).toBeDefined();
    // Only someone sent from /coach gets the explanation.
    expect(screen.queryByText(/coach platform needs a coach plan/i)).toBeNull();
  });

  it("explains the coach plan to someone sent from the coach platform", () => {
    renderPage(<Pricing />, { route: "/pricing?for=coaches&from=coach" });
    const note = screen.getByRole("status");
    expect(note.textContent).toContain("The coach platform needs a coach plan");
    expect(note.textContent).toContain("App Store or Google Play");
    expect(
      within(note)
        .getByRole("link", { name: "sign in again" })
        .getAttribute("href"),
    ).toBe("/coach/login");
    // The line belongs to the coach plans; it goes with the other tabs.
    fireEvent.click(screen.getByRole("tab", { name: "Individuals" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps Individuals as the default for any other ?for", () => {
    renderPage(<Pricing />, { route: "/pricing?for=nonsense" });
    expect(
      screen
        .getByRole("tab", { name: "Individuals" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("links Coach sign in from the nav and the footer", () => {
    renderPage(<Pricing />);
    const links = screen.getAllByRole("link", { name: "Coach sign in" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/coach/login");
    }
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
