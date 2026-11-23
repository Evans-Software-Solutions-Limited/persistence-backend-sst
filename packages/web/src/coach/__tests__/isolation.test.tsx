import { afterEach, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import App from "@/App";
import { initMetaPixel, trackPageView } from "@/lib/metaPixel";
import { initTradedoubler } from "@/lib/tradedoubler";
import { setConsent } from "@/lib/consent";

vi.mock("@/lib/metaPixel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/metaPixel")>()),
  initMetaPixel: vi.fn(),
  trackPageView: vi.fn(),
}));
vi.mock("@/lib/tradedoubler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tradedoubler")>()),
  initTradedoubler: vi.fn(),
}));

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

/**
 * Inspector Brad on #549: the magic-link callback carries the coach's tokens
 * in the URL, so no marketing script or page tracking may run on /coach.
 */
it.each(["/coach/login", "/coach/callback#error_description=Expired"])(
  "does not initialize marketing scripts or page tracking on %s",
  async (route) => {
    window.history.replaceState(null, "", route);
    setConsent({ advertising: true, affiliate: true });
    renderPage(<App />, { route });
    await screen.findByText(/Sign in|Expired/);
    expect(initMetaPixel).not.toHaveBeenCalled();
    expect(trackPageView).not.toHaveBeenCalled();
    expect(initTradedoubler).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Manage cookies" })).toBeNull();
  },
);
