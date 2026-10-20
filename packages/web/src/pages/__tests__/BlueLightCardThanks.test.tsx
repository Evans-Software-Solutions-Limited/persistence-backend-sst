import { act, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import BlueLightCardThanks from "../BlueLightCardThanks";
import * as metaPixel from "@/lib/metaPixel";
import * as tradedoubler from "@/lib/tradedoubler";
import { setConsent } from "@/lib/consent";

const PENDING_HEADING = "Payment received. Setting up your access…";

const COMPLETED = {
  status: "completed",
  accessReady: true,
  tier: "premium",
  cadence: "annual",
  emailMasked: "me•••@example.test",
  eventId: "evt-blc-1",
  amountMinor: 11199,
  currency: "GBP",
};

function stubStatus(data: Record<string, unknown>, status = 200) {
  const mock = vi.fn(
    async () => new Response(JSON.stringify({ data }), { status }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function render(sessionId = "cs_test_1") {
  return renderPage(<BlueLightCardThanks />, {
    route: `/blue-light-card/thanks?session_id=${sessionId}`,
  });
}

describe("BlueLightCardThanks", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("confirms the payment, shows the plan, the masked address and the app CTAs", async () => {
    stubStatus(COMPLETED);
    const mock = vi.mocked(fetch);
    render();
    expect(
      await screen.findByRole("heading", { name: "You're in." }),
    ).toBeDefined();
    expect(screen.getByText("Plan").nextElementSibling?.textContent).toBe(
      "Premium, annual, £111.99/yr",
    );
    expect(screen.getByText("me•••@example.test")).toBeDefined();
    expect(
      screen.getByText("Sign in with the same account you used just now."),
    ).toBeDefined();
    expect(screen.queryByText(PENDING_HEADING)).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open Persistence" }),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: /App Store/ }).getAttribute("href"),
    ).toMatch(/^https:\/\/apps\.apple\.com\//);
    expect(
      screen
        .getByRole("link", { name: "Get it on Google Play" })
        .getAttribute("href"),
    ).toMatch(/^https:\/\/play\.google\.com\//);
    expect(
      screen.queryByRole("link", { name: "Back to the offer" }),
    ).toBeNull();
    expect(String(mock.mock.calls[0][0])).toMatch(
      /\/blc\/checkout\/cs_test_1\/status$/,
    );
  });

  it("does not claim access merely because payment completed", async () => {
    stubStatus({ ...COMPLETED, accessReady: false });
    render();
    expect(await screen.findByText(PENDING_HEADING)).toBeDefined();
    expect(screen.getByText("This usually takes a few seconds.")).toBeDefined();
    expect(screen.getByRole("img", { name: "Working" })).toBeDefined();
    expect(screen.queryByText("You're in.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Persistence" })).toBeNull();
    expect(screen.queryByText(/do not pay again/)).toBeNull();
  });

  it("tells a paid buyer not to pay again once it has stopped waiting for access", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubStatus({ ...COMPLETED, accessReady: false });
      render();
      await screen.findByText(PENDING_HEADING);
      expect(screen.queryByText(/do not pay again/)).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(screen.getByText(/do not pay again/)).toBeDefined();
      expect(screen.getByText(PENDING_HEADING)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an unrecognised tier as the server names it rather than guessing", async () => {
    stubStatus({ ...COMPLETED, tier: "coach_pro", cadence: "monthly" });
    render();
    await screen.findByRole("heading", { name: "You're in." });
    expect(screen.getByText("Plan").nextElementSibling?.textContent).toBe(
      "coach_pro, monthly, £111.99/mo",
    );
  });

  it("fires Purchase with the SERVER's event id and the BLC plan id, once", async () => {
    const spy = vi.spyOn(metaPixel, "trackPurchase");
    stubStatus(COMPLETED);
    render();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(
      "evt-blc-1",
      111.99,
      "GBP",
      "blc_premium_annual",
    );
  });

  it("fires the Tradedoubler sale once with the session id as the order number", async () => {
    const spy = vi.spyOn(tradedoubler, "trackTradedoublerSale");
    stubStatus({ ...COMPLETED, accessReady: false });
    render();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith({
      transactionId: "cs_test_1",
      orderValue: 111.99,
      voucher: "",
      currency: "GBP",
    });
    // Polling while access is not ready must not re-fire it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reports no sale from the browser without affiliate consent, even with the ids configured", async () => {
    vi.stubEnv("VITE_TRADEDOUBLER_ORG_ID", "org-1");
    vi.stubEnv("VITE_TRADEDOUBLER_PROGRAM_ID", "prog-1");
    vi.stubEnv("VITE_TRADEDOUBLER_SALE_EVENT_ID", "event-1");
    setConsent({ advertising: true, affiliate: false });
    const sale = vi.spyOn(tradedoubler, "trackTradedoublerSale");
    stubStatus(COMPLETED);
    render();
    await screen.findByRole("heading", { name: "You're in." });
    // The page asks; the library refuses — nothing reaches the network.
    await waitFor(() => expect(sale).toHaveBeenCalledTimes(1));
    expect(window.tdconv).toBeUndefined();
    expect(document.querySelector('script[src*="tradedoubler"]')).toBeNull();
  });

  it("mounts the landing tag on the thanks page too", () => {
    const capture = vi.spyOn(tradedoubler, "captureTduid");
    const init = vi.spyOn(tradedoubler, "initTradedoubler");
    stubStatus(COMPLETED);
    render();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("still reports the sale, but no Purchase, when the server has no event id", async () => {
    const purchase = vi.spyOn(metaPixel, "trackPurchase");
    const sale = vi.spyOn(tradedoubler, "trackTradedoublerSale");
    stubStatus({ ...COMPLETED, eventId: null });
    render();
    await screen.findByRole("heading", { name: "You're in." });
    await waitFor(() => expect(sale).toHaveBeenCalledTimes(1));
    expect(purchase).not.toHaveBeenCalled();
  });

  it("fires nothing while the webhook has not landed, and keeps polling", async () => {
    const purchase = vi.spyOn(metaPixel, "trackPurchase");
    const sale = vi.spyOn(tradedoubler, "trackTradedoublerSale");
    stubStatus({ ...COMPLETED, status: "open" });
    render();
    expect(await screen.findByText(PENDING_HEADING)).toBeDefined();
    expect(purchase).not.toHaveBeenCalled();
    expect(sale).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0);
  });

  it("stops polling an open checkout once the window has passed", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0) // openedAt
      .mockReturnValue(10 * 60_000);
    stubStatus({ ...COMPLETED, status: "open" });
    render();
    await screen.findByText(PENDING_HEADING);
    const calls = vi.mocked(fetch).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
  });

  it("says an expired checkout did not complete", async () => {
    stubStatus({ ...COMPLETED, status: "expired" });
    render();
    expect(
      await screen.findByText("That checkout wasn't completed."),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Nothing was charged. Your Blue Light Card code still works.",
      ),
    ).toBeDefined();
    expect(screen.queryByRole("link", { name: "Open Persistence" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Back to the offer" })
        .getAttribute("href"),
    ).toBe("/blue-light-card");
  });

  it("does not tell a paying buyer nothing was charged when OUR api is down", async () => {
    stubStatus({}, 404);
    render();
    expect(
      await screen.findByText(/can't confirm your payment just yet/i),
    ).toBeDefined();
    expect(screen.queryByText(/nothing was charged/i)).toBeNull();
    expect(screen.queryByText("You're in.")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Back to the offer" }),
    ).toBeDefined();
  });

  it("retries a transient failure but not an unknown session", async () => {
    const mock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", mock);
    render();
    await screen.findByText(/can't confirm your payment just yet/i, undefined, {
      timeout: 10_000,
    });
    expect(mock.mock.calls.length).toBeGreaterThan(1);
  }, 15_000);

  it("does not spin forever when there is no session id at all", () => {
    const mock = stubStatus(COMPLETED);
    renderPage(<BlueLightCardThanks />, { route: "/blue-light-card/thanks" });
    expect(screen.getByText("That checkout wasn't completed.")).toBeDefined();
    expect(screen.queryByRole("img", { name: "Working" })).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it("takes the session id out of the address bar before the pixel fires", async () => {
    window.history.replaceState(
      null,
      "",
      "/blue-light-card/thanks?session_id=cs_test_1",
    );
    stubStatus(COMPLETED);
    render();
    expect(window.location.search).not.toContain("session_id");
    await screen.findByRole("heading", { name: "You're in." });
  });

  it("is noindex", () => {
    stubStatus(COMPLETED);
    render();
    expect(
      document.head
        .querySelector('meta[name="robots"]')
        ?.getAttribute("content"),
    ).toBe("noindex, nofollow");
  });
});
