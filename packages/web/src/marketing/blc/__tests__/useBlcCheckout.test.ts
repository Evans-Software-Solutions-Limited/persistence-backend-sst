import { act, renderHook } from "@testing-library/react";
import { useBlcCheckout, errorMessage } from "../useBlcCheckout";
import { accountSession } from "@/founding/auth";
import { setConsent } from "@/lib/consent";
import { TDUID_STORAGE_KEY } from "@/lib/tradedoubler";
import * as pixel from "@/lib/metaPixel";

vi.mock("@/founding/auth", () => ({ accountSession: vi.fn() }));

const assign = vi.fn();
const request = {
  accountId: "apple-user",
  tier: "premium" as const,
  cadence: "annual" as const,
  code: " BLC-CODE ",
  email: "buyer@example.com",
  priceMinor: 11199,
  hp: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accountSession).mockResolvedValue({
    accessToken: "verified",
    refreshToken: "r",
    expiresAt: 9999999999,
  });
  vi.stubGlobal("location", { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function okFetch() {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ ok: true, url: "https://checkout.stripe.com/pay" }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function bodyOf(fetcher: ReturnType<typeof vi.fn>) {
  const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
  return {
    init,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

it("posts the exact checkout body with the verified bearer, then navigates to Stripe", async () => {
  setConsent({ advertising: true, affiliate: true });
  window.sessionStorage.setItem(TDUID_STORAGE_KEY, "click-id");
  const fetcher = okFetch();
  const track = vi.spyOn(pixel, "trackInitiateCheckout");
  const { result } = renderHook(useBlcCheckout);

  let ok: boolean | undefined;
  await act(async () => {
    ok = await result.current.start({
      ...request,
      campaign: "blc",
      turnstileToken: "challenge",
    });
  });

  expect(ok).toBe(true);
  expect(accountSession).toHaveBeenCalledWith("apple-user");
  const url = (fetcher.mock.calls[0] as unknown as [string])[0];
  expect(url).toMatch(/\/blc\/checkout$/);
  const { init, body } = bodyOf(fetcher);
  expect(init.method).toBe("POST");
  expect(init.headers).toMatchObject({
    Authorization: "Bearer verified",
    "Content-Type": "application/json",
  });
  expect(body).toEqual({
    tier: "premium",
    cadence: "annual",
    code: "BLC-CODE",
    email: "buyer@example.com",
    tduid: "click-id",
    campaign: "blc",
    marketing_consent: true,
    event_id: body.event_id,
    hp: "",
    turnstileToken: "challenge",
  });
  expect(typeof body.event_id).toBe("string");
  expect(track).toHaveBeenCalledWith(
    body.event_id,
    111.99,
    "GBP",
    "blc_premium_annual",
  );
  expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/pay");
});

it("omits tduid, campaign, turnstile and click ids when it has none, and reports consent honestly", async () => {
  setConsent({ advertising: false, affiliate: false });
  const fetcher = okFetch();
  const { result } = renderHook(useBlcCheckout);
  await act(async () => {
    await result.current.start(request);
  });
  const { body } = bodyOf(fetcher);
  expect(body).not.toHaveProperty("tduid");
  expect(body).not.toHaveProperty("campaign");
  expect(body).not.toHaveProperty("turnstileToken");
  expect(body).not.toHaveProperty("fbc");
  expect(body).not.toHaveProperty("fbp");
  expect(body.marketing_consent).toBe(false);
});

it("forwards fbc (from a URL fbclid) and fbp (from the _fbp cookie)", async () => {
  // `location` is stubbed above (for `assign`), so the query goes on the stub.
  vi.stubGlobal("location", {
    ...window.location,
    search: "?fbclid=click123",
    assign,
  });
  document.cookie = "_fbp=fb.1.1690000000000.999888777";
  const fetcher = okFetch();
  const { result } = renderHook(useBlcCheckout);
  await act(async () => {
    await result.current.start(request);
  });
  const { body } = bodyOf(fetcher);
  expect(body.fbc).toMatch(/^fb\.1\.\d+\.click123$/);
  expect(body.fbp).toBe("fb.1.1690000000000.999888777");
  document.cookie = "_fbp=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
});

it("never creates a payment after account verification fails", async () => {
  vi.mocked(accountSession).mockRejectedValue(new Error("changed"));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useBlcCheckout);
  await act(async () => {
    await result.current.start(request);
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
  expect(result.current.status).toBe("error");
  expect(result.current.message).toMatch(/couldn't start the payment/);
});

it.each([
  ["invalid_code", 400, /That code can't be used/],
  ["invalid_request", 400, /couldn't start the payment/],
  ["account_ineligible", 403, /can't take this offer/],
  ["active_subscription", 409, /already has a paid plan/],
  ["unavailable", 503, /aren't available right now/],
  ["unknown", 500, /couldn't start the payment/],
])(
  "maps %s to its copy without reporting a checkout",
  async (error, status, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error }), { status }),
      ),
    );
    const track = vi.spyOn(pixel, "trackInitiateCheckout");
    const { result } = renderHook(useBlcCheckout);
    await act(async () => {
      await result.current.start(request);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.message).toMatch(expected);
    expect(track).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  },
);

it("reads a bare 429 as rate limiting", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 429 })),
  );
  const { result } = renderHook(useBlcCheckout);
  await act(async () => {
    await result.current.start(request);
  });
  expect(result.current.message).toMatch(/Too many attempts/);
});

it("treats a 200 without a url as a failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
  );
  const { result } = renderHook(useBlcCheckout);
  await act(async () => {
    await result.current.start(request);
  });
  expect(result.current.status).toBe("error");
  expect(assign).not.toHaveBeenCalled();
});

it("resets a refusal", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 })),
  );
  const { result } = renderHook(useBlcCheckout);
  await act(async () => {
    await result.current.start(request);
  });
  expect(result.current.status).toBe("error");
  act(() => result.current.reset());
  expect(result.current.status).toBe("idle");
  expect(result.current.message).toBeNull();
});

it("errorMessage falls back to the generic line for an unknown code", () => {
  expect(errorMessage("something_else", 418)).toMatch(/couldn't start/);
  expect(errorMessage(undefined, 429)).toMatch(/Too many/);
});
