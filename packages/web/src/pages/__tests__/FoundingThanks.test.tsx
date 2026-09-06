import { screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import FoundingThanks from "../FoundingThanks";
import * as metaPixel from "@/lib/metaPixel";

const COMPLETED = {
  status: "completed",
  holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  tier: "premium",
  months: 6,
  emailMasked: "bu•••@example.test",
  eventId: "evt-checkout-1",
  amountMinor: 3000,
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
  return renderPage(<FoundingThanks />, {
    route: `/founding/thanks?session_id=${sessionId}`,
  });
}

describe("FoundingThanks", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("confirms the payment and points at the invite email", async () => {
    stubStatus(COMPLETED);
    render();
    expect(await screen.findByText(/payment received/i)).toBeDefined();
    expect(screen.getByText(/check your email/i)).toBeDefined();
  });

  it("shows only the masked address it was given", async () => {
    // The session id is in the URL, so the page must not reveal who paid to
    // anyone holding that link.
    stubStatus(COMPLETED);
    const { container } = render();
    expect(await screen.findByText("bu•••@example.test")).toBeDefined();
    expect(container.textContent).not.toContain("buyer@example.test");
  });

  it("fires Purchase with the SERVER's event id, once", async () => {
    // Minting a new id here would send Meta two unlinked purchases for one
    // sale and double the conversion the ads optimise on.
    const spy = vi.spyOn(metaPixel, "trackPurchase");
    stubStatus(COMPLETED);
    render();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith("evt-checkout-1", 30, "GBP");
  });

  it("fires no Purchase while the webhook has not landed", async () => {
    const spy = vi.spyOn(metaPixel, "trackPurchase");
    stubStatus({ ...COMPLETED, status: "open" });
    render();
    expect(await screen.findByText(/finishing up/i)).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("fires no Purchase when the server has no event id to dedupe on", async () => {
    const spy = vi.spyOn(metaPixel, "trackPurchase");
    stubStatus({ ...COMPLETED, eventId: null });
    render();
    await screen.findByText(/payment received/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps polling only while the answer can still change", async () => {
    stubStatus({ ...COMPLETED, status: "open" });
    render();
    await screen.findByText(/finishing up/i);
    const callsWhilePending = vi.mocked(fetch).mock.calls.length;
    expect(callsWhilePending).toBeGreaterThan(0);
  });

  it.each(["expired", "refunded"])(
    "says a %s checkout did not complete",
    async (status) => {
      stubStatus({ ...COMPLETED, status });
      render();
      expect(await screen.findByText(/didn't complete/i)).toBeDefined();
    },
  );

  it("does not tell a paying buyer nothing was charged when OUR api is down", async () => {
    // This page is only reachable from Stripe's success url — i.e. only after
    // a payment. A failed read of our own status endpoint is our problem, not
    // evidence that no money moved.
    stubStatus({}, 404);
    render();
    expect(
      await screen.findByText(/can't confirm this just yet/i),
    ).toBeDefined();
    expect(screen.queryByText(/nothing has been charged/i)).toBeNull();
  });

  it("does not spin forever when there is no session id at all", () => {
    const mock = stubStatus(COMPLETED);
    renderPage(<FoundingThanks />, { route: "/founding/thanks" });
    expect(screen.getByText(/didn't complete/i)).toBeDefined();
    expect(mock).not.toHaveBeenCalled();
  });

  it("takes the session id out of the address bar before the pixel fires", async () => {
    // This page loads the Meta pixel, which transmits the full document
    // location. Leaving the id there hands a third party a key to the buyer's
    // tier, amount and masked address.
    stubStatus(COMPLETED);
    render();
    await screen.findByText(/payment received/i);
    await waitFor(() =>
      expect(window.location.search).not.toContain("session_id"),
    );
  });

  it("stops polling once the seat hold has lapsed", async () => {
    // `open` is not terminal on its own — the row only leaves it on a webhook
    // — so a bookmarked thanks page for an abandoned checkout would otherwise
    // poll 30 times a minute forever.
    stubStatus({
      ...COMPLETED,
      status: "open",
      holdExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    render();
    await screen.findByText(/finishing up/i);
    const calls = vi.mocked(fetch).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
  });

  it("always offers a way back to the plans", async () => {
    stubStatus(COMPLETED);
    render();
    expect(
      await screen.findByRole("link", { name: /back to the plans/i }),
    ).toBeDefined();
  });
});
