import { act, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import App from "@/App";
import {
  initMetaPixel,
  teardownMetaPixel,
  trackPageView,
} from "@/lib/metaPixel";
import { setConsent } from "@/lib/consent";
vi.mock("@/pages/Home", () => ({ default: () => <h1>Marketing home</h1> }));
vi.mock("@/pages/Pricing", () => ({ default: () => <h1>Pricing options</h1> }));
vi.mock("@/pages/OrganisationAdmin", () => ({
  default: () => <h1>Development organisation admin</h1>,
}));
vi.mock("@/redemption/RedeemPage", () => ({
  default: () => <h1>Secure voucher redemption</h1>,
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
  setConsent({ advertising: true });
  renderPage(<App />);
  expect(screen.getByRole("heading", { name: "Marketing home" })).toBeDefined();
  expect(initMetaPixel).toHaveBeenCalledTimes(1);
  expect(trackPageView).toHaveBeenCalledTimes(1);
  act(() => setConsent({ advertising: false }));
  expect(teardownMetaPixel).toHaveBeenCalledTimes(1);
  act(() => setConsent({ advertising: true }));
  expect(initMetaPixel).toHaveBeenCalledTimes(2);
});
it("does not load tracking without prior consent", () => {
  renderPage(<App />);
  expect(initMetaPixel).not.toHaveBeenCalled();
});
it("keeps voucher redemption isolated just like founding access", () => {
  setConsent({ advertising: true });
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
