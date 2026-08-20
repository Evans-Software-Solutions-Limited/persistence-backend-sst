import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import Home from "../Home";
import { playStore } from "@/marketing/config";

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

  it("renders the App Store CTA as a live link now the store is live", () => {
    renderPage(<Home />);
    // Store went live 15 Aug 2026 (appStore.available flipped in config): the
    // hero CTA is now a real <a> to the storefront-agnostic App Store url, not
    // the old non-linking "Coming to the App Store" placeholder.
    expect(screen.queryByText("Coming to the App Store")).toBeNull();
    const cta = screen.getByText("Get it on the App Store").closest("a");
    expect(cta).not.toBeNull();
    expect(cta?.getAttribute("href")).toBe(
      "https://apps.apple.com/app/apple-store/id6755091280",
    );
  });

  it("does NOT ship the excluded founding / fake-stat content", () => {
    // The launch waitlist + coach enquiry forms ARE shipped now (Brad approved
    // lead capture 2026-08-08, reversing the earlier hard-exclusion). What stays
    // excluded is the founding-discount framing and any invented proof stats.
    const { container } = renderPage(<Home />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/founding/i);
    expect(text).not.toMatch(/92%/);
    expect(text).not.toMatch(/early access/i);
  });

  it("ships the Android notify list and coach enquiry capture forms", () => {
    // ⚠ The email form here is gated on `!playStore.available` — it is the
    // Android notify list, and it retires itself when Play goes live. Asserting
    // a flat count of 2 would turn Android launch day into "Home broke", which
    // is why the expected count is derived from the flag rather than hardcoded.
    // The deliberate tripwires for that flip live in config.test.ts and
    // edgeRedirect.test.ts, which say so in their names; this test is not one.
    const expectedForms = playStore.available ? 1 : 2;
    const { container } = renderPage(<Home />);
    expect(container.querySelectorAll("form.lead-form").length).toBe(
      expectedForms,
    );
    expect(screen.getByText("Register your interest")).toBeDefined();
    if (!playStore.available) {
      expect(screen.getByText("Notify me at launch")).toBeDefined();
    }
    // Every form carries a required marketing-consent checkbox (UK-GDPR).
    expect(
      container.querySelectorAll('.lead-consent input[type="checkbox"]'),
    ).toHaveLength(expectedForms);
  });
});
