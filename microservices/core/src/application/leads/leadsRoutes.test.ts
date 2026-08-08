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
