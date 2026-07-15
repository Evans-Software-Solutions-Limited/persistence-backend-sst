// Local mock of the native SDK so this suite can assert init options and
// control the module's `enabled` state. Overrides the global setup.ts mock.
const mocks = {
  init: jest.fn(),
  captureException: jest.fn(),
  wrap: jest.fn((c: unknown) => c),
};
jest.mock("@sentry/react-native", () => ({
  __esModule: true,
  init: mocks.init,
  captureException: mocks.captureException,
  wrap: mocks.wrap,
}));

// Control the runtime variant read by resolveEnvironment().
let mockAppVariant: unknown = "staging";
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { appVariant: mockAppVariant } };
    },
  },
}));

type SentryModule = typeof import("../sentry");

// jest-expo runs under Babel/CJS — dynamic `import()` isn't supported, so use
// `require` + `jest.resetModules()` to get a fresh module (resets `enabled`).
function load(): SentryModule {
  // require (not import) so `jest.resetModules()` yields a fresh module with a
  // reset `enabled` flag — jest-expo's Babel/CJS runtime has no dynamic import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../sentry") as SentryModule;
}

function loadInitialised(dsn?: string): SentryModule {
  jest.resetModules();
  if (dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
  const mod = load();
  mod.initSentry();
  return mod;
}

const ORIGINAL_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

beforeEach(() => {
  jest.clearAllMocks();
  mockAppVariant = "staging";
});

afterEach(() => {
  if (ORIGINAL_DSN === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = ORIGINAL_DSN;
});

describe("redactString", () => {
  it("redacts emails, JWTs, and bearer/basic auth values", () => {
    const { redactString } = load();
    expect(redactString("email jane@example.com")).toBe(
      "email [redacted]-email",
    );
    expect(redactString("t=eyJa.eyJb.sigZ")).toBe("t=[redacted]-token");
    expect(redactString("Bearer abc.def-123")).toBe("Bearer [redacted]");
    expect(redactString("Basic dXNlcg==")).toBe("Basic [redacted]");
  });

  it("leaves PII-free text unchanged", () => {
    const { redactString } = load();
    expect(redactString("network request failed")).toBe(
      "network request failed",
    );
  });
});

describe("scrubEvent", () => {
  it("drops request body/cookies, redacts headers + query + message + exception", () => {
    const { scrubEvent } = load();
    const event = scrubEvent({
      message: "sent to a@b.com",
      user: { id: "u1", email: "a@b.com", username: "al" },
      request: {
        data: { weightKg: 80 },
        cookies: { s: "x" },
        query_string: "token=eyJa.eyJb.sigZ",
        headers: {
          Authorization: "Bearer z",
          Cookie: "sb=1",
          "X-Contact": "c@d.com",
          "content-type": "application/json",
        },
      },
      exception: { values: [{ value: "bad email a@b.com" }, {}] },
      breadcrumbs: [{ message: "GET /x?email=e@f.com" }],
    } as never) as unknown as {
      message: string;
      user: Record<string, unknown>;
      request: {
        data?: unknown;
        cookies?: unknown;
        query_string: string;
        headers: Record<string, string>;
      };
      exception: { values: { value?: string }[] };
      breadcrumbs: { message: string }[];
    };
    expect(event.message).toBe("sent to [redacted]-email");
    expect(event.user).toEqual({ id: "u1" });
    expect(event.request.data).toBeUndefined();
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.query_string).toBe("token=[redacted]-token");
    expect(event.request.headers.Authorization).toBe("[redacted]");
    expect(event.request.headers.Cookie).toBe("[redacted]");
    expect(event.request.headers["X-Contact"]).toBe("[redacted]-email");
    expect(event.request.headers["content-type"]).toBe("application/json");
    expect(event.exception.values[0].value).toBe("bad email [redacted]-email");
    expect(event.exception.values[1].value).toBeUndefined();
    expect(event.breadcrumbs[0].message).toBe("GET /x?email=[redacted]-email");
  });

  it("empties a user with no id and ignores a non-string query string", () => {
    const { scrubEvent } = load();
    const event = scrubEvent({
      user: { email: "a@b.com" },
      request: { query_string: [["a", "b"]] },
    } as never) as unknown as {
      user: Record<string, unknown>;
      request: { query_string: unknown };
    };
    expect(event.user).toEqual({});
    expect(event.request.query_string).toEqual([["a", "b"]]);
  });

  it("deep-redacts extra + contexts, and redacts request.url + structured message", () => {
    const { scrubEvent } = load();
    const event = scrubEvent({
      logentry: { message: "hi a@b.com", formatted: "fmt a@b.com" },
      request: { url: "https://api/x?email=a@b.com" },
      extra: {
        note: "reach me at a@b.com",
        nested: { token: "eyJa.eyJb.sigZ" },
      },
      contexts: {
        device: { name: "Sarah's iPhone a@b.com", family: "iPhone" },
      },
    } as never) as unknown as {
      logentry: { message: string; formatted: string };
      request: { url: string };
      extra: { note: string; nested: { token: string } };
      contexts: { device: { name: string; family: string } };
    };
    expect(event.logentry.message).toBe("hi [redacted]-email");
    expect(event.logentry.formatted).toBe("fmt [redacted]-email");
    expect(event.request.url).toBe("https://api/x?email=[redacted]-email");
    expect(event.extra.note).toBe("reach me at [redacted]-email");
    expect(event.extra.nested.token).toBe("[redacted]-token");
    // device.name can't be pattern-matched (arbitrary name) → dropped wholesale.
    expect(event.contexts.device.name).toBe("[redacted]");
    expect(event.contexts.device.family).toBe("iPhone");
  });

  it("handles a minimal event", () => {
    const { scrubEvent } = load();
    expect(() => scrubEvent({} as never)).not.toThrow();
  });
});

describe("scrubTransaction", () => {
  it("scrubs span descriptions and span data, plus shared fields", () => {
    const { scrubTransaction } = load();
    const event = scrubTransaction({
      message: "trace a@b.com",
      spans: [
        {
          description: "GET https://x?email=a@b.com",
          data: { "http.url": "https://x?token=eyJa.eyJb.sigZ", n: 1 },
        },
        { op: "ui" },
      ],
    } as never) as unknown as {
      message: string;
      spans: { description?: string; data?: Record<string, unknown> }[];
    };
    expect(event.message).toBe("trace [redacted]-email");
    expect(event.spans[0].description).toBe(
      "GET https://x?email=[redacted]-email",
    );
    expect(event.spans[0].data!["http.url"]).toBe(
      "https://x?token=[redacted]-token",
    );
    expect(event.spans[0].data!.n).toBe(1);
    expect(event.spans[1].description).toBeUndefined();
  });

  it("handles a transaction event with no spans", () => {
    const { scrubTransaction } = load();
    expect(() =>
      scrubTransaction({ type: "transaction" } as never),
    ).not.toThrow();
  });
});

describe("scrubBreadcrumb", () => {
  it("redacts the message and string data, leaving non-strings intact", () => {
    const { scrubBreadcrumb } = load();
    const crumb = scrubBreadcrumb({
      message: "login a@b.com",
      data: {
        url: "https://x?email=c@d.com",
        code: 200,
        args: ["called with e@f.com", { jwt: "eyJa.eyJb.sigZ" }],
      },
    } as never) as unknown as {
      message: string;
      data: {
        url: string;
        code: number;
        args: [string, { jwt: string }];
      };
    };
    expect(crumb.message).toBe("login [redacted]-email");
    expect(crumb.data.url).toBe("https://x?email=[redacted]-email");
    expect(crumb.data.code).toBe(200);
    // Nested array/object values are redacted too (recursion).
    expect(crumb.data.args[0]).toBe("called with [redacted]-email");
    expect(crumb.data.args[1].jwt).toBe("[redacted]-token");
  });

  it("handles a breadcrumb with no message or data", () => {
    const { scrubBreadcrumb } = load();
    expect(() => scrubBreadcrumb({ category: "nav" } as never)).not.toThrow();
  });
});

describe("initSentry / isSentryEnabled", () => {
  it("no-ops when the DSN is unset", () => {
    const mod = loadInitialised(undefined);
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mod.isSentryEnabled()).toBe(false);
  });

  it("no-ops when the DSN is blank/whitespace", () => {
    const mod = loadInitialised("   ");
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mod.isSentryEnabled()).toBe(false);
  });

  it("initialises with the scrub hooks + environment from the variant", () => {
    const mod = loadInitialised("https://k@o.ingest.sentry.io/1");
    expect(mod.isSentryEnabled()).toBe(true);
    const opts = mocks.init.mock.calls[0][0];
    expect(opts.dsn).toBe("https://k@o.ingest.sentry.io/1");
    expect(opts.environment).toBe("staging");
    expect(opts.tracesSampleRate).toBe(0.1);
    expect(opts.sendDefaultPii).toBe(false);
    expect(opts.beforeSend).toBe(mod.scrubEvent);
    expect(opts.beforeSendTransaction).toBe(mod.scrubTransaction);
    expect(opts.beforeBreadcrumb).toBe(mod.scrubBreadcrumb);
  });

  it("falls back to 'development' when the variant is absent", () => {
    mockAppVariant = undefined;
    loadInitialised("https://k@o.ingest.sentry.io/1");
    expect(mocks.init.mock.calls[0][0].environment).toBe("development");
  });
});

describe("captureBoundaryError", () => {
  it("is a no-op when Sentry is disabled", () => {
    const mod = loadInitialised(undefined);
    mod.captureBoundaryError(new Error("x"));
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("captures with and without extra context when enabled", () => {
    const mod = loadInitialised("https://k@o.ingest.sentry.io/1");
    const err = new Error("x");
    mod.captureBoundaryError(err, { screen: "Home" });
    expect(mocks.captureException).toHaveBeenCalledWith(err, {
      extra: { screen: "Home" },
    });
    mod.captureBoundaryError(err);
    expect(mocks.captureException).toHaveBeenLastCalledWith(err, undefined);
  });
});
