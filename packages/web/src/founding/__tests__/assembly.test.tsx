import { act, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import App from "@/App";
import {
  initMetaPixel,
  teardownMetaPixel,
  trackPageView,
} from "@/lib/metaPixel";
import { initTradedoubler, teardownTradedoubler } from "@/lib/tradedoubler";
import { setConsent } from "@/lib/consent";
vi.mock("@/pages/Home", () => ({ default: () => <h1>Marketing home</h1> }));
vi.mock("@/pages/Pricing", () => ({ default: () => <h1>Pricing options</h1> }));
vi.mock("@/pages/OrganisationAdmin", () => ({
  default: () => <h1>Development organisation admin</h1>,
}));
vi.mock("@/redemption/RedeemPage", () => ({
  default: () => <h1>Secure voucher redemption</h1>,
}));
vi.mock("@/lib/tradedoubler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tradedoubler")>()),
  initTradedoubler: vi.fn(),
  teardownTradedoubler: vi.fn(),
}));
vi.mock("@/lib/metaPixel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/metaPixel")>()),
  initMetaPixel: vi.fn(),
  teardownMetaPixel: vi.fn(),
  trackPageView: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  delete window.fbq;
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});
it("initializes marketing analytics only with consent and reacts to withdrawal and re-consent", () => {
  setConsent({ advertising: true, affiliate: false });
  renderPage(<App />);
  expect(screen.getByRole("heading", { name: "Marketing home" })).toBeDefined();
  expect(initMetaPixel).toHaveBeenCalledTimes(1);
  expect(trackPageView).toHaveBeenCalledTimes(1);
  act(() => setConsent({ advertising: false, affiliate: false }));
  expect(teardownMetaPixel).toHaveBeenCalledTimes(1);
  act(() => setConsent({ advertising: true, affiliate: false }));
  expect(initMetaPixel).toHaveBeenCalledTimes(2);
});
it("does not load tracking without prior consent", () => {
  renderPage(<App />);
  expect(initMetaPixel).not.toHaveBeenCalled();
});
it("keeps voucher redemption isolated just like founding access", () => {
  setConsent({ advertising: true, affiliate: false });
  renderPage(<App />, { route: "/redeem" });
  expect(
    screen.getByRole("heading", { name: "Secure voucher redemption" }),
  ).toBeDefined();
  expect(initMetaPixel).not.toHaveBeenCalled();
  expect(trackPageView).not.toHaveBeenCalled();
});
it("redirects the development-only organisation route to pricing in production", async () => {
  vi.stubEnv("DEV", false);
  renderPage(<App />, { route: "/org-admin" });
  expect(
    await screen.findByRole("heading", { name: "Pricing options" }),
  ).toBeDefined();
  expect(screen.queryByText("Development organisation admin")).toBeNull();
});
it("retains organisation tools during development", () => {
  vi.stubEnv("DEV", true);
  renderPage(<App />, { route: "/org-admin" });
  expect(
    screen.getByRole("heading", { name: "Development organisation admin" }),
  ).toBeDefined();
});
describe("Blue Light Card routes (PER-3)", () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it.each(["/blue-light-card", "/blue-light-card/callback"])(
    "renders the offer page at %s inside the marketing shell",
    async (route) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
      );
      renderPage(<App />, { route });
      expect(
        await screen.findByRole("heading", {
          name: "A thank-you for the people who show up.",
        }),
      ).toBeDefined();
      expect(screen.getByRole("button", { name: "Accept all" })).toBeDefined();
      vi.unstubAllGlobals();
    },
  );

  it("renders the thanks page at /blue-light-card/thanks", () => {
    renderPage(<App />, { route: "/blue-light-card/thanks" });
    expect(
      screen.getByRole("heading", { name: "That checkout wasn't completed." }),
    ).toBeDefined();
  });

  it("bridges affiliate consent to the Tradedoubler tag and tears it down on withdrawal", () => {
    setConsent({ advertising: false, affiliate: true });
    renderPage(<App />);
    expect(initTradedoubler).toHaveBeenCalledTimes(1);
    expect(initMetaPixel).not.toHaveBeenCalled();
    act(() => setConsent({ advertising: false, affiliate: false }));
    expect(teardownTradedoubler).toHaveBeenCalledTimes(1);
    act(() => setConsent({ advertising: false, affiliate: true }));
    expect(initTradedoubler).toHaveBeenCalledTimes(2);
  });

  it("does not load the affiliate tag without prior consent", () => {
    renderPage(<App />);
    expect(initTradedoubler).not.toHaveBeenCalled();
  });
});
