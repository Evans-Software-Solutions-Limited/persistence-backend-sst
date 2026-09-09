import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { FoundingPlans } from "../FoundingPlans";
import { CampaignContext } from "../campaign";
import { FOUNDING_COPY } from "../foundingOffer";
import * as metaPixel from "@/lib/metaPixel";
import { setConsent } from "@/lib/consent";

const assign = vi.hoisted(() => vi.fn());

function stubFetch(
  body: Record<string, unknown> = {
    ok: true,
    url: "https://checkout.stripe.com/c/pay/cs_1",
  },
  status = 200,
) {
  const mock = vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function renderPlans(campaign?: string) {
  return renderPage(
    <CampaignContext.Provider value={campaign}>
      <FoundingPlans />
    </CampaignContext.Provider>,
    { route: campaign ? `/${campaign}` : "/founding" },
  );
}

async function choosePremium6() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Premium, Six months — £30" }),
  );
  return screen.findByLabelText("Founding checkout");
}

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value },
  });
}

function lastBody(mock: ReturnType<typeof stubFetch>) {
  const [, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("FoundingPlans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.stubGlobal("location", { ...window.location, assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the plans first and asks for an email only after one is chosen", async () => {
    stubFetch();
    renderPlans();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    await choosePremium6();
    expect(screen.getByLabelText("Email address")).toBeDefined();
  });

  it("keeps the chosen term visible while the email is typed", async () => {
    stubFetch();
    renderPlans();
    await choosePremium6();
    expect(screen.getByText("Premium · Six months · £30")).toBeDefined();
  });

  it("lets the buyer go back and pick a different term", async () => {
    stubFetch();
    renderPlans();
    await choosePremium6();
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    expect(await screen.findByLabelText("Founding prices")).toBeDefined();
    expect(screen.queryByLabelText("Email address")).toBeNull();
  });

  it("posts the chosen term and redirects to Stripe", async () => {
    const mock = stubFetch();
    renderPlans();
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    expect(lastBody(mock)).toMatchObject({
      tier: "premium",
      months: 6,
      email: "buyer@example.test",
    });
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/c/pay/cs_1",
      ),
    );
  });

  it("sends the route's campaign and the stored referral code", async () => {
    // The same attribution a store click carries, so one ad's purchase and its
    // store click group together.
    window.sessionStorage.setItem("persistence.ref", "METAFOUND");
    const mock = stubFetch();
    renderPlans("meta");
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(lastBody(mock)).toMatchObject({
      campaign: "meta",
      referralCode: "METAFOUND",
    });
  });

  it("fires InitiateCheckout with the id it sent the server", async () => {
    // The pair dedupes at Meta on the shared id; two ids would count one
    // intent twice.
    const spy = vi.spyOn(metaPixel, "trackInitiateCheckout");
    const mock = stubFetch();
    renderPlans();
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![0]).toBe(lastBody(mock).event_id);
    // …and the plan, so a Sales campaign can tell which term converted.
    expect(spy.mock.calls[0]!.slice(1)).toEqual([30, "GBP", "premium_6m"]);
  });

  it("does not report an intent when the request failed", async () => {
    // Nobody was sent anywhere, so no checkout was initiated.
    const spy = vi.spyOn(metaPixel, "trackInitiateCheckout");
    stubFetch({ ok: false, error: "pool_full" }, 409);
    renderPlans();
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ["pool_full", 409, /last founding place/i],
    ["invalid_email", 400, /doesn't look right/i],
    ["challenge_failed", 400, /couldn't verify/i],
    ["rate_limited", 429, /too many attempts/i],
    ["something_else", 500, /couldn't start the payment/i],
  ])("explains a %s refusal", async (error, status, copy) => {
    stubFetch({ ok: false, error }, status);
    renderPlans();
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    expect(await screen.findByText(copy)).toBeDefined();
  });

  it("says so when the server reports the offer has closed", async () => {
    stubFetch({ ok: false, error: "offer_closed" }, 410);
    renderPlans();
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(assign).not.toHaveBeenCalled();
  });

  it("survives a network failure without redirecting anywhere", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    renderPlans();
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(assign).not.toHaveBeenCalled();
  });

  it("refuses to submit an invalid email, without calling the API", async () => {
    const mock = stubFetch();
    renderPlans();
    const form = await choosePremium6();
    typeEmail("nope");
    fireEvent.submit(form);
    expect(
      await screen.findByText("Enter a valid email address."),
    ).toBeDefined();
    expect(mock).not.toHaveBeenCalled();
  });

  it("carries the honeypot field the server already drops on", async () => {
    const mock = stubFetch();
    renderPlans();
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(lastBody(mock)).toHaveProperty("hp", "");
  });

  it("states the cancellation position, verbatim, before the buyer pays", async () => {
    // Pinned to the whole sentence on purpose. The earlier assertion was
    // /14-day right to cancel/i, which matches both "LOSING the 14-day right"
    // and "you KEEP a 14-day right" — it survived that exact reversal without
    // a murmur. This is legally operative text; the test has to see the words
    // that flip its meaning.
    stubFetch();
    renderPlans();
    await choosePremium6();
    expect(screen.getByText(FOUNDING_COPY.termsNote)).toBeDefined();
    expect(FOUNDING_COPY.termsNote).toMatch(
      /You keep a 14-day right to cancel for a full refund, unless you've started using the app in that time\./,
    );
  });

  it("moves focus to the email field when a plan is chosen", async () => {
    // Choosing REPLACES the cards, so the button that was just pressed leaves
    // the DOM and focus falls back to <body> — a keyboard user's next Tab
    // restarts at the top of the page, past the field they were sent here to
    // fill in. LANDING_PAGE.md § 6 requires the move.
    stubFetch();
    renderPlans();
    await choosePremium6();
    expect(document.activeElement).toBe(
      screen.getByLabelText(FOUNDING_COPY.emailLabel),
    );
  });

  it("keeps the heading and caption with the cards they describe", async () => {
    // Both once rendered as siblings AROUND this component, so choosing a plan
    // left "Pick your access. Pay once." sitting above the email form and the
    // price caption sitting below it, captioning a form neither describes.
    stubFetch();
    renderPlans();
    expect(await screen.findByText(FOUNDING_COPY.plansHeading)).toBeDefined();
    expect(screen.getByText(FOUNDING_COPY.plansCaption)).toBeDefined();
    await choosePremium6();
    expect(screen.queryByText(FOUNDING_COPY.plansHeading)).toBeNull();
    expect(screen.queryByText(FOUNDING_COPY.plansCaption)).toBeNull();
  });

  it("asks for no marketing consent — buying is not a sign-up", async () => {
    stubFetch();
    renderPlans();
    await choosePremium6();
    expect(screen.queryByText(/happy for us to email you/i)).toBeNull();
  });

  it("clears a refusal when the buyer goes back to the plans", async () => {
    // The message belonged to the term they abandoned; carrying it onto the
    // next choice would read as that one failing too.
    stubFetch({ ok: false, error: "pool_full" }, 409);
    renderPlans();
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Change plan" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Premium+, One year — £100",
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("posts the twelve-month Premium+ term when that is the one chosen", async () => {
    const mock = stubFetch();
    renderPlans();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Premium+, One year — £100",
      }),
    );
    const form = await screen.findByLabelText("Founding checkout");
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(lastBody(mock)).toMatchObject({
      tier: "premium_plus",
      months: 12,
    });
  });

  it("carries the Meta click ids and the Turnstile token when it has them", async () => {
    setConsent({ advertising: true });
    document.cookie = "_fbp=fb.1.1.browser";
    document.cookie = "_fbc=fb.1.1.click";
    const mock = stubFetch();
    renderPlans();
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(lastBody(mock)).toMatchObject({
      fbp: "fb.1.1.browser",
      fbc: "fb.1.1.click",
      marketing_consent: true,
    });
    document.cookie = "_fbp=;expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = "_fbc=;expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("treats an unreadable response body as a failure, not a redirect", async () => {
    // A gateway returning HTML would otherwise blow up on `.json()`.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    renderPlans();
    const form = await choosePremium6();
    typeEmail("buyer@example.test");
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(assign).not.toHaveBeenCalled();
  });

  it("does nothing at all when a sold-out plan button is clicked", () => {
    renderPage(<FoundingPlans soldOut />, { route: "/founding" });
    fireEvent.click(
      screen.getByRole("button", { name: "Premium, Six months — £30" }),
    );
    expect(screen.queryByLabelText("Founding checkout")).toBeNull();
  });

  it.each([
    ["already_granted", 409, /already has a founding place/i],
    ["too_many_holds", 429, /already have a checkout open/i],
    ["not_configured", 503, /aren't available right now/i],
  ])(
    "explains a %s refusal in words the buyer can act on",
    async (error, status, copy) => {
      // Without these the buyer reads "please try again in a moment" and does,
      // forever.
      stubFetch({ ok: false, error }, status);
      renderPlans();
      const form = await choosePremium6();
      typeEmail("buyer@example.test");
      fireEvent.submit(form);
      expect(await screen.findByText(copy)).toBeDefined();
    },
  );

  describe("when the bot check has not loaded", () => {
    beforeEach(() => vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "site-key"));

    it("says why the button is not ready, rather than leaving it dead", async () => {
      // The checkout route requires a real token, so without one the button
      // can do nothing — and a disabled button with no explanation is the
      // worst version of that.
      stubFetch();
      renderPlans();
      const form = await choosePremium6();
      typeEmail("buyer@example.test");
      expect(
        screen.getByRole("button", { name: /continue to payment/i }),
      ).toHaveProperty("disabled", true);
      fireEvent.submit(form);
      expect(
        await screen.findByText(/security check hasn't loaded/i),
      ).toBeDefined();
    });

    it("does not call the API while no token exists", async () => {
      const mock = stubFetch();
      renderPlans();
      const form = await choosePremium6();
      typeEmail("buyer@example.test");
      fireEvent.submit(form);
      expect(mock).not.toHaveBeenCalled();
    });
  });

  it("offers nothing to click when every place has gone", () => {
    renderPage(<FoundingPlans soldOut />, { route: "/founding" });
    const buttons = screen.getAllByRole("button");
    expect(buttons.every((b) => b.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/just sold out/i);
  });
});
