import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import App from "@/App";
import Founding from "../Founding";

describe("Founding", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    window.sessionStorage.clear();
  });

  it("renders the offer with safe defaults when optional env is absent", () => {
    vi.stubEnv("VITE_FOUNDING_SEATS_USED", "");
    vi.stubEnv("VITE_FOUNDING_BANK_DETAILS", "");
    vi.stubEnv("VITE_FOUNDING_STRIPE_PREMIUM_URL", "");
    vi.stubEnv("VITE_FOUNDING_STRIPE_PREMIUM_PLUS_URL", "");
    vi.stubEnv("VITE_FOUNDING_STRIPE_COACH_URL", "");

    renderPage(<Founding />, { route: "/founding" });

    expect(
      screen.getByRole("heading", {
        name: "I turn 30 this month. 200 founding places.",
      }),
    ).toBeDefined();
    expect(screen.getByText("0 of 200")).toBeDefined();
    expect(screen.queryByText("Pay by bank transfer")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Pay for/ })).toBeNull();
  });

  it("routes /founding to the founding offer rather than the Home catch-all", () => {
    renderPage(<App />, { route: "/founding" });

    expect(
      screen.getByRole("heading", {
        name: "I turn 30 this month. 200 founding places.",
      }),
    ).toBeDefined();
  });

  it("renders the configured counter, bank details and available payment links", () => {
    vi.stubEnv("VITE_FOUNDING_SEATS_USED", "37");
    vi.stubEnv(
      "VITE_FOUNDING_BANK_DETAILS",
      "Account: Persistence\nReference: your email",
    );
    vi.stubEnv(
      "VITE_FOUNDING_STRIPE_PREMIUM_URL",
      "https://buy.stripe.com/premium",
    );
    vi.stubEnv("VITE_FOUNDING_STRIPE_PREMIUM_PLUS_URL", "");
    vi.stubEnv(
      "VITE_FOUNDING_STRIPE_COACH_URL",
      "https://buy.stripe.com/coach",
    );

    renderPage(<Founding />, { route: "/founding" });

    expect(screen.getByText("37 of 200")).toBeDefined();
    expect(screen.getByText(/Account: Persistence/)).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Pay for Premium" })
        .getAttribute("href"),
    ).toBe("https://buy.stripe.com/premium");
    expect(screen.queryByRole("link", { name: "Pay for Premium+" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Pay for Start Up Coach+" })
        .getAttribute("href"),
    ).toBe("https://buy.stripe.com/coach");
  });

  it("falls back to zero for a malformed or fractional seat count", () => {
    vi.stubEnv("VITE_FOUNDING_SEATS_USED", "12 seats");
    const view = renderPage(<Founding />, { route: "/founding" });
    expect(screen.getByText("0 of 200")).toBeDefined();

    view.unmount();
    vi.stubEnv("VITE_FOUNDING_SEATS_USED", "1.5");
    renderPage(<Founding />, { route: "/founding" });
    expect(screen.getByText("0 of 200")).toBeDefined();
  });
});
