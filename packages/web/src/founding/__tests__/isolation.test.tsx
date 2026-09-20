import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import App from "@/App";
import { initMetaPixel, trackPageView } from "@/lib/metaPixel";
import { setConsent } from "@/lib/consent";
vi.mock("../auth", () => ({
  currentAccount: vi.fn(async () => null),
  completeCallback: vi.fn(async () => null),
  callbackCampaign: vi.fn(() => null),
  callbackPlan: vi.fn(() => null),
}));
vi.mock("@/lib/metaPixel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/metaPixel")>()),
  initMetaPixel: vi.fn(),
  trackPageView: vi.fn(),
}));
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
it.each(["/founding/access", "/founding/access/callback"])(
  "does not initialize marketing scripts or page tracking on %s",
  async (route) => {
    window.history.replaceState(null, "", route);
    setConsent({ advertising: true });
    renderPage(<App />, { route });
    await screen.findByRole("heading", { name: "Sign in to Persistence" });
    expect(initMetaPixel).not.toHaveBeenCalled();
    expect(trackPageView).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Manage cookies" })).toBeNull();
  },
);
