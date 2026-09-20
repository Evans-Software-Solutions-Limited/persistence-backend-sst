import { act, renderHook } from "@testing-library/react";
import { useFoundingCheckout } from "@/marketing/useFoundingCheckout";
import { accountSession } from "../auth";
import * as pixel from "@/lib/metaPixel";
vi.mock("../auth", () => ({ accountSession: vi.fn() }));
const assign = vi.fn();
const request = {
  accountId: "apple-user",
  tier: "premium" as const,
  months: 6 as const,
  email: "buyer@example.com",
  priceMinor: 3000,
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
});
it("binds checkout to verified bearer while preserving different receipt email and attribution", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ ok: true, url: "https://checkout.stripe.com/pay" }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const track = vi.spyOn(pixel, "trackInitiateCheckout");
  const { result } = renderHook(useFoundingCheckout);
  await act(async () => {
    await result.current.start({
      ...request,
      campaign: "meta",
      turnstileToken: "challenge",
    });
  });
  expect(accountSession).toHaveBeenCalledWith("apple-user");
  const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(init.headers).toMatchObject({ Authorization: "Bearer verified" });
  expect(JSON.parse(init.body as string)).toMatchObject({
    email: "buyer@example.com",
    tier: "premium",
    months: 6,
    campaign: "meta",
    turnstileToken: "challenge",
    hp: "",
  });
  expect(JSON.parse(init.body as string)).not.toHaveProperty("userId");
  expect(track.mock.calls[0]?.[0]).toBe(
    JSON.parse(init.body as string).event_id,
  );
  expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/pay");
});
it("never creates a payment after account verification fails", async () => {
  vi.mocked(accountSession).mockRejectedValue(new Error("changed"));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useFoundingCheckout);
  await act(async () => {
    await result.current.start(request);
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
  expect(result.current.status).toBe("error");
});
it.each([
  ["auth_required", 401, /sign in again/],
  ["email_not_verified", 403, /Confirm/],
  ["account_ineligible", 403, /cannot receive/],
  ["active_subscription", 409, /already has paid/],
  ["pool_full", 409, /last founding/],
  ["invalid_email", 400, /doesn't look/],
  ["challenge_failed", 400, /couldn't verify/],
  ["rate_limited", 429, /Too many/],
  ["already_granted", 409, /already have a founding/],
  ["too_many_holds", 429, /checkout open/],
  ["not_configured", 503, /available/],
  ["unknown", 500, /couldn't start/],
])(
  "shows actionable %s refusal without reporting checkout",
  async (error, status, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error }), { status: status as number }),
      ),
    );
    const track = vi.spyOn(pixel, "trackInitiateCheckout");
    const { result } = renderHook(useFoundingCheckout);
    await act(async () => {
      await result.current.start(request);
    });
    expect(result.current.message).toMatch(expected as RegExp);
    expect(track).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  },
);
it("handles offer closure and resets a refusal", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 410 })),
  );
  const { result } = renderHook(useFoundingCheckout);
  await act(async () => {
    await result.current.start(request);
  });
  expect(result.current.status).toBe("closed");
  act(() => result.current.reset());
  expect(result.current.status).toBe("idle");
});
it("handles an unreadable gateway response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("bad gateway", { status: 502 })),
  );
  const { result } = renderHook(useFoundingCheckout);
  await act(async () => {
    await result.current.start(request);
  });
  expect(result.current.status).toBe("error");
  expect(assign).not.toHaveBeenCalled();
});
