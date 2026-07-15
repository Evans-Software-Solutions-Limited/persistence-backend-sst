import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SDK. `vi.hoisted` lets the mock factory reference these fns.
const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  wrapHandler: vi.fn((h: unknown) => h),
}));

vi.mock("@sentry/aws-serverless", () => ({
  init: mocks.init,
  captureException: mocks.captureException,
  wrapHandler: mocks.wrapHandler,
}));

type SentryModule = typeof import("../sentry");

const ORIGINAL_ENV = { ...process.env };

/**
 * Load a FRESH copy of the module (module-level `enabled` is reset) with the
 * given env, then run `initSentry()` so `enabled` reflects the DSN.
 */
async function loadInitialised(env: {
  dsn?: string;
  stage?: string;
}): Promise<SentryModule> {
  vi.resetModules();
  if (env.dsn === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = env.dsn;
  if (env.stage === undefined) delete process.env.SST_STAGE;
  else process.env.SST_STAGE = env.stage;
  const mod = await import("../sentry");
  mod.initSentry();
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("redactString", () => {
  it("redacts email addresses", async () => {
    const { redactString } = await import("../sentry");
    expect(redactString("contact jane.doe+test@example.co.uk now")).toBe(
      "contact [redacted]-email now",
    );
  });

  it("redacts JWTs (eyJ… three-segment tokens)", async () => {
    const { redactString } = await import("../sentry");
    const jwt = "eyJhbGciOi.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4";
    expect(redactString(`token=${jwt}`)).toBe("token=[redacted]-token");
  });

  it("redacts bearer and basic authorization values, preserving the scheme", async () => {
    const { redactString } = await import("../sentry");
    expect(redactString("Authorization: Bearer abc123.def-456")).toBe(
      "Authorization: Bearer [redacted]",
    );
    expect(redactString("Basic dXNlcjpwYXNz")).toBe("Basic [redacted]");
  });

  it("leaves PII-free text unchanged", async () => {
    const { redactString } = await import("../sentry");
    expect(redactString("failed to connect to database")).toBe(
      "failed to connect to database",
    );
  });
});

describe("scrubEvent", () => {
  it("drops the request body and cookies and redacts the query string", async () => {
    const { scrubEvent } = await import("../sentry");
    const event = scrubEvent({
      request: {
        data: { weightKg: 82, email: "a@b.com" },
        cookies: { session: "secret" },
        query_string: "token=eyJa.eyJb.sigZ&x=1",
      },
    } as never) as unknown as { request: Record<string, unknown> };
    expect(event.request.data).toBeUndefined();
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.query_string).toBe("token=[redacted]-token&x=1");
  });

  it("redacts authorization/cookie headers (case-insensitive) and other header values", async () => {
    const { scrubEvent } = await import("../sentry");
    const event = scrubEvent({
      request: {
        headers: {
          Authorization: "Bearer xyz",
          Cookie: "sb-access=1",
          "X-Contact": "user@example.com",
          "content-type": "application/json",
        },
      },
    } as never) as unknown as { request: { headers: Record<string, string> } };
    expect(event.request.headers.Authorization).toBe("[redacted]");
    expect(event.request.headers.Cookie).toBe("[redacted]");
    expect(event.request.headers["X-Contact"]).toBe("[redacted]-email");
    expect(event.request.headers["content-type"]).toBe("application/json");
  });

  it("keeps a non-string query_string untouched", async () => {
    const { scrubEvent } = await import("../sentry");
    const event = scrubEvent({
      request: { query_string: [["a", "b"]] },
    } as never) as unknown as { request: { query_string: unknown } };
    expect(event.request.query_string).toEqual([["a", "b"]]);
  });

  it("keeps only the user id, dropping email/username/ip", async () => {
    const { scrubEvent } = await import("../sentry");
    const event = scrubEvent({
      user: {
        id: "user-123",
        email: "a@b.com",
        username: "alice",
        ip_address: "1.2.3.4",
      },
    } as never) as unknown as { user: Record<string, unknown> };
    expect(event.user).toEqual({ id: "user-123" });
  });

  it("empties a user with no id", async () => {
    const { scrubEvent } = await import("../sentry");
    const event = scrubEvent({
      user: { email: "a@b.com" },
    } as never) as unknown as { user: Record<string, unknown> };
    expect(event.user).toEqual({});
  });

  it("redacts exception messages and ignores exceptions with no value", async () => {
    const { scrubEvent } = await import("../sentry");
    const event = scrubEvent({
      exception: {
        values: [
          { type: "Error", value: "bad login for admin@corp.com" },
          { type: "Error" },
        ],
      },
    } as never) as unknown as { exception: { values: { value?: string }[] } };
    expect(event.exception.values[0].value).toBe(
      "bad login for [redacted]-email",
    );
    expect(event.exception.values[1].value).toBeUndefined();
  });

  it("scrubs attached breadcrumbs and the top-level message", async () => {
    const { scrubEvent } = await import("../sentry");
    const event = scrubEvent({
      message: "sent to a@b.com",
      breadcrumbs: [{ message: "GET /x?token=eyJa.eyJb.sigZ" }],
    } as never) as unknown as {
      message: string;
      breadcrumbs: { message: string }[];
    };
    expect(event.message).toBe("sent to [redacted]-email");
    expect(event.breadcrumbs[0].message).toBe("GET /x?token=[redacted]-token");
  });

  it("deep-redacts extra + contexts, and redacts request.url + structured message", async () => {
    const { scrubEvent } = await import("../sentry");
    const event = scrubEvent({
      logentry: { message: "hi a@b.com", formatted: "fmt a@b.com" },
      request: { url: "https://api/x?email=a@b.com" },
      extra: {
        note: "reach me at a@b.com",
        nested: { token: "eyJa.eyJb.sigZ" },
      },
      contexts: { runtime: { name: "node a@b.com", version: "22" } },
    } as never) as unknown as {
      logentry: { message: string; formatted: string };
      request: { url: string };
      extra: { note: string; nested: { token: string } };
      contexts: { runtime: { name: string; version: string } };
    };
    expect(event.logentry.message).toBe("hi [redacted]-email");
    expect(event.logentry.formatted).toBe("fmt [redacted]-email");
    expect(event.request.url).toBe("https://api/x?email=[redacted]-email");
    expect(event.extra.note).toBe("reach me at [redacted]-email");
    expect(event.extra.nested.token).toBe("[redacted]-token");
    expect(event.contexts.runtime.name).toBe("node [redacted]-email");
    expect(event.contexts.runtime.version).toBe("22");
  });

  it("handles a minimal event with none of the optional fields", async () => {
    const { scrubEvent } = await import("../sentry");
    expect(() => scrubEvent({} as never)).not.toThrow();
  });
});

describe("scrubBreadcrumb", () => {
  it("redacts the message and string data values, leaving non-strings intact", async () => {
    const { scrubBreadcrumb } = await import("../sentry");
    const crumb = scrubBreadcrumb({
      message: "login a@b.com",
      data: {
        url: "https://x/y?email=c@d.com",
        status: 500,
        args: ["called with e@f.com", { jwt: "eyJa.eyJb.sigZ" }],
      },
    } as never) as unknown as {
      message: string;
      data: { url: string; status: number; args: [string, { jwt: string }] };
    };
    expect(crumb.message).toBe("login [redacted]-email");
    expect(crumb.data.url).toBe("https://x/y?email=[redacted]-email");
    expect(crumb.data.status).toBe(500);
    // Nested array/object values are redacted too (recursion).
    expect(crumb.data.args[0]).toBe("called with [redacted]-email");
    expect(crumb.data.args[1].jwt).toBe("[redacted]-token");
  });

  it("handles a breadcrumb with no message or data", async () => {
    const { scrubBreadcrumb } = await import("../sentry");
    expect(() =>
      scrubBreadcrumb({ category: "navigation" } as never),
    ).not.toThrow();
  });
});

describe("scrubTransaction", () => {
  it("scrubs shared fields plus span descriptions and span data", async () => {
    const { scrubTransaction } = await import("../sentry");
    const event = scrubTransaction({
      message: "trace for a@b.com",
      user: { id: "u1", email: "a@b.com" },
      spans: [
        {
          description: "SELECT * WHERE email = 'a@b.com'",
          data: {
            "http.url": "https://x/y?token=eyJa.eyJb.sigZ",
            "http.status": 200,
          },
        },
        { op: "db" },
      ],
    } as never) as unknown as {
      message: string;
      user: Record<string, unknown>;
      spans: { description?: string; data?: Record<string, unknown> }[];
    };
    expect(event.message).toBe("trace for [redacted]-email");
    expect(event.user).toEqual({ id: "u1" });
    expect(event.spans[0].description).toBe(
      "SELECT * WHERE email = '[redacted]-email'",
    );
    expect(event.spans[0].data!["http.url"]).toBe(
      "https://x/y?token=[redacted]-token",
    );
    expect(event.spans[0].data!["http.status"]).toBe(200);
    // A span with no description/data must not throw.
    expect(event.spans[1].description).toBeUndefined();
  });

  it("handles a transaction event with no spans", async () => {
    const { scrubTransaction } = await import("../sentry");
    expect(() =>
      scrubTransaction({ type: "transaction" } as never),
    ).not.toThrow();
  });
});

describe("initSentry / isSentryEnabled", () => {
  it("no-ops when SENTRY_DSN is unset", async () => {
    const mod = await loadInitialised({ dsn: undefined });
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mod.isSentryEnabled()).toBe(false);
  });

  it("no-ops when SENTRY_DSN is blank/whitespace", async () => {
    const mod = await loadInitialised({ dsn: "   " });
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mod.isSentryEnabled()).toBe(false);
  });

  it("initialises with the scrub hooks and stage environment when a DSN is present", async () => {
    const mod = await loadInitialised({
      dsn: "https://abc@o1.ingest.sentry.io/42",
      stage: "production",
    });
    expect(mod.isSentryEnabled()).toBe(true);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    const opts = mocks.init.mock.calls[0][0];
    expect(opts.dsn).toBe("https://abc@o1.ingest.sentry.io/42");
    expect(opts.environment).toBe("production");
    expect(opts.tracesSampleRate).toBe(0.1);
    expect(opts.sendDefaultPii).toBe(false);
    expect(opts.beforeSend).toBe(mod.scrubEvent);
    expect(opts.beforeSendTransaction).toBe(mod.scrubTransaction);
    expect(opts.beforeBreadcrumb).toBe(mod.scrubBreadcrumb);
  });

  it("falls back to 'unknown' environment when SST_STAGE is unset", async () => {
    await loadInitialised({ dsn: "https://abc@o1.ingest.sentry.io/42" });
    expect(mocks.init.mock.calls[0][0].environment).toBe("unknown");
  });
});

describe("captureFatal", () => {
  it("is a no-op when Sentry is disabled", async () => {
    const mod = await loadInitialised({ dsn: undefined });
    mod.captureFatal(new Error("boom"), { requestId: "r1" });
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("captures with extra context when enabled", async () => {
    const mod = await loadInitialised({
      dsn: "https://abc@o1.ingest.sentry.io/42",
    });
    const err = new Error("boom");
    mod.captureFatal(err, { requestId: "r1" });
    expect(mocks.captureException).toHaveBeenCalledWith(err, {
      extra: { requestId: "r1" },
    });
  });

  it("captures without a hint when no context is given", async () => {
    const mod = await loadInitialised({
      dsn: "https://abc@o1.ingest.sentry.io/42",
    });
    const err = new Error("boom");
    mod.captureFatal(err);
    expect(mocks.captureException).toHaveBeenCalledWith(err, undefined);
  });
});

describe("wrapLambda", () => {
  it("returns the handler untouched when disabled", async () => {
    const mod = await loadInitialised({ dsn: undefined });
    const handler = () => "raw";
    expect(mod.wrapLambda(handler)).toBe(handler);
    expect(mocks.wrapHandler).not.toHaveBeenCalled();
  });

  it("wraps the handler via Sentry.wrapHandler when enabled", async () => {
    const mod = await loadInitialised({
      dsn: "https://abc@o1.ingest.sentry.io/42",
    });
    const handler = () => "raw";
    const wrapped = mod.wrapLambda(handler);
    expect(mocks.wrapHandler).toHaveBeenCalledWith(handler);
    expect(wrapped).toBe(handler); // mock passes the handler through
  });
});
