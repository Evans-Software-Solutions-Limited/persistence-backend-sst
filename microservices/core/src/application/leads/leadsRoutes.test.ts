import { beforeEach, describe, expect, it, vi } from "vitest";

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

async function post(path: string, body: Record<string, unknown>) {
  const { leadsRoutes } = await import("./leadsRoutes");
  return leadsRoutes.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// Default the challenge to "off" (skipped) so the pre-existing suites are
// unaffected; the WS3 suite below flips it per-test.
beforeEach(() => {
  turnstileOutcome = "skipped";
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
      },
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
});
