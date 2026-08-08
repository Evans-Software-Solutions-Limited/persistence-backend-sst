import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let envMap: Record<string, string> = {
  RESEND_API_KEY: "re_test_key",
  RESEND_ATHLETES_AUDIENCE_ID: "aud_athletes",
  RESEND_COACHES_AUDIENCE_ID: "aud_coaches",
};

vi.mock("@persistence/api-utils/env", () => ({
  getEnv: vi.fn((name: string) => envMap[name] ?? ""),
}));

import {
  addContactToAudience,
  getResendApiKey,
  getResendAthletesAudienceId,
  getResendCoachesAudienceId,
  RESEND_FROM,
  RESEND_NOTIFICATION_TO,
  ResendNotConfiguredError,
  sendEmail,
} from "./resendClient";

describe("env getters", () => {
  it("read their respective env vars", () => {
    expect(getResendApiKey()).toBe("re_test_key");
    expect(getResendAthletesAudienceId()).toBe("aud_athletes");
    expect(getResendCoachesAudienceId()).toBe("aud_coaches");
  });
});

describe("constants", () => {
  it("exposes the from address and notification inbox", () => {
    expect(RESEND_FROM).toContain("@evans-software-solutions.com");
    expect(RESEND_NOTIFICATION_TO).toBe("admin@evans-software-solutions.com");
  });
});

describe("addContactToAudience", () => {
  beforeEach(() => {
    envMap = {
      RESEND_API_KEY: "re_test_key",
      RESEND_ATHLETES_AUDIENCE_ID: "aud_athletes",
      RESEND_COACHES_AUDIENCE_ID: "aud_coaches",
    };
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: () => Promise<Response> | Response) {
    const fetchMock = vi.fn(impl);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts to the audience contacts endpoint with the bearer key", async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify({ id: "c1" }), { status: 200 }),
    );

    await addContactToAudience("aud_athletes", {
      email: "a@example.com",
      firstName: "Ada",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/audiences/aud_athletes/contacts");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_test_key",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@example.com",
      first_name: "Ada",
      unsubscribed: false,
    });
  });

  it("omits first_name/last_name when not provided", async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify({}), { status: 201 }),
    );
    await addContactToAudience("aud_athletes", { email: "a@example.com" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@example.com",
      unsubscribed: false,
    });
  });

  it("includes last_name when provided", async () => {
    const fetchMock = stubFetch(
      () => new Response(JSON.stringify({}), { status: 200 }),
    );
    await addContactToAudience("aud_athletes", {
      email: "a@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      unsubscribed: false,
    });
  });

  it("treats a 409 duplicate response as success", async () => {
    stubFetch(() => new Response(JSON.stringify({}), { status: 409 }));
    await expect(
      addContactToAudience("aud_athletes", { email: "a@example.com" }),
    ).resolves.toBeUndefined();
  });

  it("treats a 422 'already exists' response as success", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ message: "Contact already exists" }), {
          status: 422,
        }),
    );
    await expect(
      addContactToAudience("aud_athletes", { email: "a@example.com" }),
    ).resolves.toBeUndefined();
  });

  it("throws on a 422 that is not a duplicate", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ message: "Invalid email" }), {
          status: 422,
        }),
    );
    await expect(
      addContactToAudience("aud_athletes", { email: "a@example.com" }),
    ).rejects.toThrow(/Resend add-contact failed: 422/);
  });

  it("throws on other non-2xx responses", async () => {
    stubFetch(
      () => new Response("boom", { status: 500, statusText: "Server Error" }),
    );
    await expect(
      addContactToAudience("aud_athletes", { email: "a@example.com" }),
    ).rejects.toThrow(/Resend add-contact failed: 500/);
  });

  it("throws ResendNotConfiguredError when the API key is empty", async () => {
    envMap.RESEND_API_KEY = "";
    await expect(
      addContactToAudience("aud_athletes", { email: "a@example.com" }),
    ).rejects.toBeInstanceOf(ResendNotConfiguredError);
  });

  it("throws ResendNotConfiguredError when the audience id is empty", async () => {
    await expect(
      addContactToAudience("", { email: "a@example.com" }),
    ).rejects.toBeInstanceOf(ResendNotConfiguredError);
  });
});

describe("sendEmail", () => {
  beforeEach(() => {
    envMap = {
      RESEND_API_KEY: "re_test_key",
      RESEND_ATHLETES_AUDIENCE_ID: "aud_athletes",
      RESEND_COACHES_AUDIENCE_ID: "aud_coaches",
    };
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /emails with from/to/subject/text", async () => {
    const fetchMock = vi.fn(
      () => new Response(JSON.stringify({ id: "e1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail({
      to: "admin@evans-software-solutions.com",
      subject: "New coach enquiry",
      text: "body",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(init.body as string)).toEqual({
      from: RESEND_FROM,
      to: "admin@evans-software-solutions.com",
      subject: "New coach enquiry",
      text: "body",
    });
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () => new Response("boom", { status: 500, statusText: "Server Error" }),
      ),
    );
    await expect(
      sendEmail({ to: "a@b.com", subject: "s", text: "t" }),
    ).rejects.toThrow(/Resend send-email failed: 500/);
  });

  it("throws ResendNotConfiguredError when the API key is empty", async () => {
    envMap.RESEND_API_KEY = "";
    await expect(
      sendEmail({ to: "a@b.com", subject: "s", text: "t" }),
    ).rejects.toBeInstanceOf(ResendNotConfiguredError);
  });
});
