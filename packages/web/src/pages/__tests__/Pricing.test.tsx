import { fireEvent, screen, within } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Pricing from "../Pricing";

describe("Pricing", () => {
  it("renders individual prices from the catalog and disables IAP calls to action", () => {
    renderPage(<Pricing />);
    const premium = screen.getByTestId("pricing-tier-premium");
    const premiumPlus = screen.getByTestId("pricing-tier-premium_plus");

    expect(within(premium).getByText("139.99")).toBeDefined();
    expect(within(premiumPlus).getByText("249.99")).toBeDefined();
    expect(
      within(premium).getByText("Coming soon").getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("derives savings per tier when cadence changes", () => {
    renderPage(<Pricing />);
    expect(
      within(screen.getByTestId("pricing-tier-premium")).getByText(/save 31%/i),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: "Coaches" }));
    expect(
      within(screen.getByTestId("pricing-tier-individual_trainer")).getByText(
        /save 30%/i,
      ),
    ).toBeDefined();
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
