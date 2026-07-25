import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Home from "../Home";

describe("Home", () => {
  it("renders the hero and core sections", () => {
    renderPage(<Home />);
    expect(screen.getByText("Track everything.")).toBeDefined();
    expect(screen.getByText("One loop.")).toBeDefined();
    expect(screen.getByText("Same programme.")).toBeDefined();
    // Feature brands are Loadout + Mealprint (renamed from AnyGym/AnyMeal
    // 2026-07-24) — the old names must not resurface anywhere in the rendered
    // document (copy, ids, classes, hrefs). index.html's static head is
    // outside this render and is guarded by review, not this test.
    const text = document.documentElement.innerHTML;
    expect(text).not.toMatch(
      /\banygym\b|\bany gym\b|\banymeal\b|\bany meal\b/i,
    );
    expect(screen.getByText("Loadout · Premium+")).toBeDefined();
    expect(screen.getByText("Mealprint · Premium+")).toBeDefined();
  });

  it("renders the Mealprint section with plan mock and Premium+ link", () => {
    renderPage(<Home />);
    expect(screen.getByText("on your plate.")).toBeDefined();
    expect(screen.getByText("Mealprint plans")).toBeDefined();
    expect(screen.getByText(/Greek yogurt & berry bowl/)).toBeDefined();
    // The section CTA links to pricing.
    const cta = screen.getByText(/See plans & pricing/).closest("a");
    expect(cta?.getAttribute("href")).toBe("/pricing#athletes");
  });

  it("shows the App Store CTA as a non-linking 'coming soon' state", () => {
    renderPage(<Home />);
    const cta = screen.getByText("Coming to the App Store");
    expect(cta).toBeDefined();
    expect(cta.closest("a")).toBeNull();
  });

  it("does NOT ship the excluded waitlist / founding content", () => {
    const { container } = renderPage(<Home />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/waitlist/i);
    expect(text).not.toMatch(/founding/i);
    expect(text).not.toMatch(/92%/);
    expect(text).not.toMatch(/early access/i);
    expect(container.querySelector("form")).toBeNull();
  });
});
