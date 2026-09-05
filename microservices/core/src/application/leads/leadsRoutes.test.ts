import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "./rateLimit";

const resendMocks = {
  addContactToAudience: vi.fn(),
  sendEmail: vi.fn(),
};

vi.mock("./resendClient", () => ({
  addContactToAudience: (...args: unknown[]) =>
    resendMocks.addContactToAudience(...args),
  sendEmail: (...args: unknown[]) => resendMocks.sendEmail(...args),
  getResendAthletesAudienceId: () => "aud_athletes",
  getResendCoachesAudienceId: () => "aud_coaches",
  RESEND_NOTIFICATION_TO: "admin@evans-software-solutions.com",
}));

// Turnstile + emit are best-effort side paths; mock them so the route tests
// stay isolated from DB/HTTP. `turnstileOutcome` is switchable per-test.
let turnstileOutcome = "skipped";
const emitEventMock = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {},
);

vi.mock("./turnstile", () => ({
  verifyTurnstile: vi.fn(async () => turnstileOutcome),
}));

vi.mock("../analytics/emitEvent", () => ({
  emitEvent: (...args: unknown[]) => emitEventMock(...args),
}));

async function post(path: string, body: Record<string, unknown>, ip?: string) {
  const { leadsRoutes } = await import("./leadsRoutes");
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  // Distinct IPs land in distinct rate-limit buckets; omit for the common case
  // (shares the "unknown" bucket, reset before every test).
  if (ip) headers["x-forwarded-for"] = ip;
  return leadsRoutes.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

/** POST a raw text/plain body — the production `/store-click` beacon shape. */
async function postText(path: string, raw: string) {
  const { leadsRoutes } = await import("./leadsRoutes");
  return leadsRoutes.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: raw,
    }),
  );
}

/** A CORS preflight for `path`. */
async function preflight(path: string) {
  const { leadsRoutes } = await import("./leadsRoutes");
  return leadsRoutes.handle(
    new Request(`http://localhost${path}`, {
      method: "OPTIONS",
      headers: { origin: "https://persistence.example.com" },
    }),
  );
}

// Default the challenge to "off" (skipped) so the pre-existing suites are
// unaffected; the WS3 suite below flips it per-test. Reset the in-memory rate
// limiter too, so the per-IP windows never leak a count from one test into the
// next (the whole file otherwise shares the "unknown" bucket).
beforeEach(() => {
  turnstileOutcome = "skipped";
  resetRateLimits();
});

describe("POST /leads/waitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendMocks.addContactToAudience.mockResolvedValue(undefined);
  });

  it("adds a valid email to the athletes audience", async () => {
    const res = await post("/leads/waitlist", {
      email: "  Athlete@Example.com  ",
      name: "Ada Lovelace",
      source: "hero-cta",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resendMocks.addContactToAudience).toHaveBeenCalledWith(
      "aud_athletes",
      { email: "athlete@example.com", firstName: "Ada", lastName: "Lovelace" },
    );
  });

  it("works without an optional name", async () => {
    const res = await post("/leads/waitlist", { email: "a@example.com" });
    expect(res.status).toBe(200);
    expect(resendMocks.addContactToAudience).toHaveBeenCalledWith(
      "aud_athletes",
      { email: "a@example.com" },
    );
  });

  it("drops the submission silently when the honeypot is filled", async () => {
    const res = await post("/leads/waitlist", {
      email: "a@example.com",
      hp: "i-am-a-bot",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resendMocks.addContactToAudience).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const res = await post("/leads/waitlist", { email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_email" });
    expect(resendMocks.addContactToAudience).not.toHaveBeenCalled();
  });

  it("returns 503 when Resend add-contact fails", async () => {
    resendMocks.addContactToAudience.mockRejectedValue(new Error("boom"));
    const res = await post("/leads/waitlist", { email: "a@example.com" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
  });

  it("returns 503 when Resend is not configured", async () => {
    resendMocks.addContactToAudience.mockRejectedValue(
      new Error("Resend is not configured"),
    );
    const res = await post("/leads/waitlist", { email: "a@example.com" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
  });

  it("returns 503 on a non-Error rejection", async () => {
    resendMocks.addContactToAudience.mockRejectedValue("some string failure");
    const res = await post("/leads/waitlist", { email: "a@example.com" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("POST /leads/coach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendMocks.addContactToAudience.mockResolvedValue(undefined);
    resendMocks.sendEmail.mockResolvedValue(undefined);
  });

  it("adds the contact to the coaches audience and sends the notification", async () => {
    const res = await post("/leads/coach", {
      email: "Coach@Example.com",
      name: "Grace Hopper",
      clientCount: "10-25",
      currentTool: "Spreadsheets",
      message: "Interested in the beta",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resendMocks.addContactToAudience).toHaveBeenCalledWith(
      "aud_coaches",
      {
        email: "coach@example.com",
        firstName: "Grace",
        lastName: "Hopper",
      },
    );
    expect(resendMocks.sendEmail).toHaveBeenCalledWith({
      to: "admin@evans-software-solutions.com",
      subject: "New coach enquiry",
      text: expect.stringContaining("coach@example.com"),
    });
  });

  it("still succeeds when the notification email fails (best-effort)", async () => {
    resendMocks.sendEmail.mockRejectedValue(new Error("smtp down"));
    const res = await post("/leads/coach", {
      email: "coach@example.com",
      name: "Grace Hopper",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resendMocks.addContactToAudience).toHaveBeenCalledTimes(1);
  });

  it("drops the submission silently when the honeypot is filled", async () => {
    const res = await post("/leads/coach", {
      email: "coach@example.com",
      name: "Grace Hopper",
      hp: "bot",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resendMocks.addContactToAudience).not.toHaveBeenCalled();
    expect(resendMocks.sendEmail).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    const res = await post("/leads/coach", {
      email: "not-an-email",
      name: "Grace Hopper",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_email" });
    expect(resendMocks.addContactToAudience).not.toHaveBeenCalled();
  });

  it("rejects a missing/blank name", async () => {
    const res = await post("/leads/coach", {
      email: "coach@example.com",
      name: "   ",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_name" });
    expect(resendMocks.addContactToAudience).not.toHaveBeenCalled();
  });

  it("returns 503 when Resend add-contact fails, without sending the notification", async () => {
    resendMocks.addContactToAudience.mockRejectedValue(new Error("boom"));
    const res = await post("/leads/coach", {
      email: "coach@example.com",
      name: "Grace Hopper",
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
    expect(resendMocks.sendEmail).not.toHaveBeenCalled();
  });

  it("returns 503 on a non-Error add-contact rejection", async () => {
    resendMocks.addContactToAudience.mockRejectedValue("some string failure");
    const res = await post("/leads/coach", {
      email: "coach@example.com",
      name: "Grace Hopper",
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "unavailable" });
  });

  it("still succeeds on a non-Error notification-email rejection", async () => {
    resendMocks.sendEmail.mockRejectedValue("smtp string failure");
    const res = await post("/leads/coach", {
      email: "coach@example.com",
      name: "Grace Hopper",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("growth instrumentation (spec-30 WS1/WS3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendMocks.addContactToAudience.mockResolvedValue(undefined);
  });

  it("emits lead_captured (athletes) with forwarded fbc/fbp/event_id + consent true", async () => {
    const res = await post("/leads/waitlist", {
      email: "athlete@example.com",
      fbc: "fb.1.1.abc",
      fbp: "fb.1.1.xyz",
      event_id: "evt-web-1",
      marketing_consent: true,
    });
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "lead_captured",
      source: "web",
      eventId: "evt-web-1",
      properties: {
        audience: "athletes",
        marketing_consent: true,
        fbc: "fb.1.1.abc",
        fbp: "fb.1.1.xyz",
      },
    });
  });

  it("emits lead_captured (coaches) defaulting consent to FALSE when not sent (fail closed)", async () => {
    const res = await post("/leads/coach", {
      email: "coach@example.com",
      name: "Grace Hopper",
    });
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "lead_captured",
      source: "web",
      eventId: undefined,
      properties: { audience: "coaches", marketing_consent: false },
    });
  });

  it("does NOT emit when the honeypot is tripped", async () => {
    await post("/leads/waitlist", {
      email: "bot@example.com",
      hp: "i am a bot",
    });
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  it("rejects the waitlist with 400 when the Turnstile challenge fails", async () => {
    turnstileOutcome = "failed";
    const res = await post("/leads/waitlist", { email: "a@example.com" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "challenge_failed" });
    expect(resendMocks.addContactToAudience).not.toHaveBeenCalled();
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  it("rejects the coach route with 400 when the token is missing", async () => {
    turnstileOutcome = "missing_token";
    const res = await post("/leads/coach", {
      email: "coach@example.com",
      name: "Grace Hopper",
    });
    expect(res.status).toBe(400);
    expect(resendMocks.addContactToAudience).not.toHaveBeenCalled();
  });

  it("still captures when the challenge passes", async () => {
    turnstileOutcome = "passed";
    const res = await post("/leads/waitlist", { email: "a@example.com" });
    expect(res.status).toBe(200);
    expect(resendMocks.addContactToAudience).toHaveBeenCalled();
    expect(emitEventMock).toHaveBeenCalled();
  });
});

describe("POST /store-click (spec-30 R3.8)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits a store_click conversion carrying fbc/fbp/event_id + consent", async () => {
    const res = await post("/store-click", {
      fbc: "fb.1.1.abc",
      fbp: "fb.1.1.xyz",
      event_id: "evt-store-1",
      marketing_consent: true,
      store: "android",
      ref: "UON2026",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: "evt-store-1",
      properties: {
        marketing_consent: true,
        fbc: "fb.1.1.abc",
        fbp: "fb.1.1.xyz",
        store: "android",
        ref: "UON2026",
      },
    });
  });

  it("drops a ref longer than 24 characters", async () => {
    const res = await post("/store-click", {
      event_id: "evt-ref-too-long",
      ref: "A".repeat(25),
    });
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: "evt-ref-too-long",
      properties: { marketing_consent: false },
    });
  });

  it("drops an invalid store value rather than persisting unbounded input", async () => {
    const res = await post("/store-click", {
      event_id: "evt-store-invalid",
      store: "windows",
    });
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: "evt-store-invalid",
      properties: { marketing_consent: false },
    });
  });

  it("defaults consent to FALSE when the field is absent (fail closed)", async () => {
    const res = await post("/store-click", { event_id: "evt-store-2" });
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: "evt-store-2",
      properties: { marketing_consent: false },
    });
  });

  it("accepts the production text/plain beacon body and parses it as JSON", async () => {
    const res = await postText(
      "/store-click",
      JSON.stringify({
        event_id: "evt-beacon-1",
        fbp: "fb.1.1.beacon",
        marketing_consent: true,
        ref: "UON2026",
      }),
    );
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: "evt-beacon-1",
      properties: {
        marketing_consent: true,
        fbp: "fb.1.1.beacon",
        ref: "UON2026",
      },
    });
  });

  it("drops a non-string ref", async () => {
    const res = await post("/store-click", {
      event_id: "evt-ref-wrong-type",
      ref: { code: "UON2026" },
    });
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: "evt-ref-wrong-type",
      properties: { marketing_consent: false },
    });
  });

  it("still emits (consent false) when the beacon body is unparseable — fail-safe", async () => {
    const res = await postText("/store-click", "not json at all");
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: undefined,
      properties: { marketing_consent: false },
    });
  });

  it("records the campaign slug so a click can be attributed to a channel", async () => {
    const res = await post("/store-click", {
      event_id: "evt-campaign",
      store: "ios",
      campaign: "meta",
    });
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: "evt-campaign",
      properties: {
        marketing_consent: false,
        store: "ios",
        campaign: "meta",
      },
    });
  });

  it("carries the campaign through the production text/plain beacon too", async () => {
    const res = await postText(
      "/store-click",
      JSON.stringify({ event_id: "evt-campaign-beacon", campaign: "uon" }),
    );
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: "evt-campaign-beacon",
      properties: { marketing_consent: false, campaign: "uon" },
    });
  });

  it.each([
    ["upper case", "META"],
    ["an underscore", "meta_founders"],
    ["a space", "meta founders"],
    ["over 32 characters", "a".repeat(33)],
    ["empty", ""],
  ])("drops a campaign slug with %s", async (_label, campaign) => {
    // The slug ends up in `properties.campaign`, which the admin attribution
    // queries GROUP BY — arbitrary text there both pollutes those groupings
    // and is unbounded input on a public endpoint.
    const res = await post("/store-click", {
      event_id: `evt-bad-${_label}`,
      campaign,
    });
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: `evt-bad-${_label}`,
      properties: { marketing_consent: false },
    });
  });

  it("drops a non-string campaign", async () => {
    const res = await post("/store-click", {
      event_id: "evt-campaign-wrong-type",
      campaign: { slug: "meta" },
    });
    expect(res.status).toBe(200);
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: "evt-campaign-wrong-type",
      properties: { marketing_consent: false },
    });
  });

  it("drops an oversized beacon body but still emits the bare conversion", async () => {
    const res = await postText(
      "/store-click",
      JSON.stringify({ event_id: "x", fbp: "y".repeat(5000) }),
    );
    expect(res.status).toBe(200);
    // >4096 chars → parseBeaconBody returns {} → nothing forwarded but the
    // conversion still counts.
    expect(emitEventMock).toHaveBeenCalledWith({
      name: "store_click",
      source: "web",
      eventId: undefined,
      properties: { marketing_consent: false },
    });
  });
});

describe("per-IP origin-backstop rate limit (spec-30 R3.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendMocks.addContactToAudience.mockResolvedValue(undefined);
  });

  it("429s the 11th waitlist post from one IP within the window, keeping the first 10", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 10; i++) {
      const res = await post("/leads/waitlist", { email: "a@example.com" }, ip);
      expect(res.status).toBe(200);
    }
    const res = await post("/leads/waitlist", { email: "a@example.com" }, ip);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
  });

  it("shares one leads budget across /leads/waitlist + /leads/coach per IP", async () => {
    const ip = "203.0.113.8";
    // 10 waitlist posts exhaust the shared 'leads' bucket...
    for (let i = 0; i < 10; i++) {
      await post("/leads/waitlist", { email: "a@example.com" }, ip);
    }
    // ...so the very next coach post from the same IP is throttled.
    const res = await post(
      "/leads/coach",
      { email: "coach@example.com", name: "Grace Hopper" },
      ip,
    );
    expect(res.status).toBe(429);
    expect(resendMocks.addContactToAudience).toHaveBeenCalledTimes(10);
  });

  it("rate-limits BEFORE any work — no Resend call, no emit on the throttled request", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 10; i++) {
      await post("/leads/waitlist", { email: "a@example.com" }, ip);
    }
    vi.clearAllMocks();
    const res = await post("/leads/waitlist", { email: "a@example.com" }, ip);
    expect(res.status).toBe(429);
    expect(resendMocks.addContactToAudience).not.toHaveBeenCalled();
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  it("keeps store-click on its own, higher budget — 60 pass, the 61st 429s", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 60; i++) {
      const res = await post("/store-click", { event_id: `e${i}` }, ip);
      expect(res.status).toBe(200);
    }
    const res = await post("/store-click", { event_id: "e60" }, ip);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
  });

  it("isolates buckets by IP — a second IP is unaffected by the first's exhaustion", async () => {
    const hot = "203.0.113.11";
    for (let i = 0; i < 10; i++) {
      await post("/leads/waitlist", { email: "a@example.com" }, hot);
    }
    expect(
      (await post("/leads/waitlist", { email: "a@example.com" }, hot)).status,
    ).toBe(429);
    const fresh = await post(
      "/leads/waitlist",
      { email: "a@example.com" },
      "198.51.100.2",
    );
    expect(fresh.status).toBe(200);
  });
});

describe("CORS (browser-facing marketing routes)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendMocks.addContactToAudience.mockResolvedValue(undefined);
  });

  it("answers the waitlist preflight with 204 + permissive CORS headers", async () => {
    const res = await preflight("/leads/waitlist");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "content-type",
    );
    // A preflight must never touch Resend/emit.
    expect(resendMocks.addContactToAudience).not.toHaveBeenCalled();
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  it("answers the coach + store-click preflights with 204 + ACAO", async () => {
    for (const path of ["/leads/coach", "/store-click"]) {
      const res = await preflight(path);
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("stamps CORS on the actual POST response so the browser can read it", async () => {
    const res = await post("/leads/waitlist", { email: "a@example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("stamps CORS even on the 429 response (browser needs it to read the error)", async () => {
    const ip = "203.0.113.55";
    for (let i = 0; i < 10; i++) {
      await post("/leads/waitlist", { email: "a@example.com" }, ip);
    }
    const res = await post("/leads/waitlist", { email: "a@example.com" }, ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("stamps CORS on a 422 schema-validation error (rejected before the handler)", async () => {
    // An over-length email fails the t.Object body schema BEFORE the handler's
    // withCors runs; the onError hook must still add CORS so the browser can
    // read the validation error.
    const res = await post("/leads/waitlist", {
      email: `${"a".repeat(400)}@example.com`,
    });
    expect(res.status).toBe(422);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
