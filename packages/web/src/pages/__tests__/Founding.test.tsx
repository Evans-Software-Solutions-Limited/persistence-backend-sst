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

  it("renders the configured counter and explains the out-of-band access flow", () => {
    vi.stubEnv("VITE_FOUNDING_SEATS_USED", "37");

    renderPage(<Founding />, { route: "/founding" });

    expect(screen.getByText("37 of 200")).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "How to get a place" }),
    ).toBeDefined();
    expect(
      screen.getByRole("link", {
        name: "admin@evans-software-solutions.com",
      }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "How access is switched on" }),
    ).toBeDefined();
    expect(
      screen.getByText(/redeemed within 90 days of payment/),
    ).toBeDefined();
    expect(screen.queryByRole("link", { name: /^Pay for/ })).toBeNull();
    expect(screen.queryByText("Pay by bank transfer")).toBeNull();
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
