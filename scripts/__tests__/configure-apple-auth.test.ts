import { describe, expect, it, vi } from "vitest";
import { getDomainConfig } from "../../packages/api-utils/src/domains/domain-config";
import {
  buildPatch,
  configureAppleAuth,
  parseArgs,
  runCli,
  validateConfig,
} from "../configure-apple-auth";

const now = Date.now();
const servicesId = "com.example.persistence.web";
function token(
  payload: Record<string, unknown>,
  header: unknown = { alg: "ES256", kid: "KEY123" },
  signature = Buffer.alloc(64, 1).toString("base64url"),
) {
  return [
    Buffer.from(JSON.stringify(header)).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        iss: "TEAM123",
        iat: Math.floor(now / 1000),
        ...payload,
      }),
    ).toString("base64url"),
    signature,
  ].join(".");
}
const ref = (stage: "production" | "staging") =>
  new URL(getDomainConfig(stage).supabaseUrl).hostname.split(".")[0]!;
function env(stage: "production" | "staging" = "production") {
  return {
    SUPABASE_ACCESS_TOKEN: "sbp_private-management-value",
    SUPABASE_PROJECT_REF: ref(stage),
    VITE_SUPABASE_ANON_KEY: token(
      { role: "anon", ref: ref(stage), exp: Math.floor(now / 1000) + 3600 },
      { alg: "HS256" },
    ),
    APPLE_SERVICES_ID: servicesId,
    APPLE_CLIENT_SECRET: token({
      sub: servicesId,
      aud: "https://appleid.apple.com",
      exp: Math.floor(now / 1000) + 3600,
    }),
  };
}
const existing = {
  external_apple_enabled: false,
  external_apple_client_id: "native.older, native.extra ,native.older",
  uri_allow_list: "persistence://**,https://existing.example/callback",
  external_google_enabled: true,
  external_google_secret: "do-not-copy",
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
function successfulFetch() {
  const config = validateConfig("production", env(), now);
  const patch = buildPatch(config, existing);
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(existing))
    .mockResolvedValueOnce(json({ external_apple_secret: "never-print" }))
    .mockResolvedValueOnce(json(patch));
}

describe("configure Apple auth input validation", () => {
  it.each(
    [
      [],
      ["dev"],
      ["production", "staging"],
      ["production", "--unknown"],
      ["production", "--check", "--check"],
    ].map((args) => ({ args })),
  )("rejects ambiguous CLI arguments $args", ({ args }) => {
    expect(() => parseArgs(args)).toThrow("Usage:");
  });
  it("accepts stage and optional local-only check", () => {
    expect(parseArgs(["production"])).toEqual({
      stage: "production",
      check: false,
    });
    expect(parseArgs(["--check", "staging"])).toEqual({
      stage: "staging",
      check: true,
    });
  });
  it.each(["production", "staging"] as const)(
    "derives the project/callback/native app for %s",
    (stage) => {
      const result = validateConfig(stage, env(stage), now);
      expect(result.projectRef).toBe(ref(stage));
      expect(result.callback).toBe(
        `https://${getDomainConfig(stage).webHost}/founding/access/callback?flow=*`,
      );
      expect(result.nativeId).toBe(
        `com.bradleyevans96.persistence${stage === "staging" ? ".staging" : ""}`,
      );
    },
  );
  it.each(Object.keys(env()))(
    "requires %s without network activity",
    async (key) => {
      const values: Record<string, string | undefined> = env();
      delete values[key];
      const fetcher = vi.fn<typeof fetch>();
      const output = { log: vi.fn(), error: vi.fn() };
      expect(await runCli(["production"], values, fetcher, output)).toBe(1);
      expect(fetcher).not.toHaveBeenCalled();
      expect(output.error).toHaveBeenCalledWith(`Missing or invalid ${key}.`);
    },
  );
  it("rejects whitespace in credentials", () => {
    expect(() =>
      validateConfig(
        "production",
        { ...env(), SUPABASE_ACCESS_TOKEN: " secret " },
        now,
      ),
    ).toThrow("SUPABASE_ACCESS_TOKEN");
  });
  it("refuses the other stage's project before network writes", () => {
    expect(() => validateConfig("production", env("staging"), now)).toThrow(
      "project does not match",
    );
  });
  it("accepts publishable browser keys", () => {
    expect(
      validateConfig(
        "production",
        { ...env(), VITE_SUPABASE_ANON_KEY: "sb_publishable_public-value" },
        now,
      ).projectRef,
    ).toBe(ref("production"));
  });
  it.each([
    "sb_secret_sensitive",
    "sb_publishable_",
    token({ role: "service_role", ref: ref("production") }),
    token({ role: "anon", ref: "other" }),
    token({ role: "anon", ref: ref("production"), exp: 1 }),
    token({ role: "anon", ref: ref("production"), exp: "tomorrow" }),
  ])("refuses privileged, malformed or mismatched browser key %#", (key) => {
    expect(() =>
      validateConfig(
        "production",
        { ...env(), VITE_SUPABASE_ANON_KEY: key },
        now,
      ),
    ).toThrow();
  });
  it("supports legacy anon JWT without optional expiry", () => {
    expect(() =>
      validateConfig(
        "production",
        {
          ...env(),
          VITE_SUPABASE_ANON_KEY: token({
            role: "anon",
            ref: ref("production"),
          }),
        },
        now,
      ),
    ).not.toThrow();
  });
  it.each([
    "malformed",
    "!.!.!",
    "eA.eA.eA",
    token({}, []),
    token({}, { alg: "none" }),
    token({ sub: servicesId, aud: "https://appleid.apple.com", exp: 1 }),
    token({
      sub: "another.web",
      aud: "https://appleid.apple.com",
      exp: Math.floor(now / 1000) + 3600,
    }),
    token({
      sub: servicesId,
      aud: "wrong",
      exp: Math.floor(now / 1000) + 3600,
    }),
    token({ sub: servicesId, aud: "https://appleid.apple.com", exp: "later" }),
    token({
      sub: servicesId,
      aud: "https://appleid.apple.com",
      exp: Math.floor(now / 1000) + 0.5,
    }),
    token(
      {
        sub: servicesId,
        aud: "https://appleid.apple.com",
        exp: Math.floor(now / 1000) + 3600,
      },
      { alg: "HS256", kid: "x" },
    ),
    token(
      {
        sub: servicesId,
        aud: "https://appleid.apple.com",
        exp: Math.floor(now / 1000) + 3600,
      },
      { alg: "ES256" },
    ),
    token(
      {
        sub: servicesId,
        aud: "https://appleid.apple.com",
        exp: Math.floor(now / 1000) + 3600,
      },
      { alg: "ES256", kid: "" },
    ),
    token(
      {
        sub: servicesId,
        aud: "https://appleid.apple.com",
        exp: Math.floor(now / 1000) + 3600,
      },
      { alg: "ES256", kid: "x" },
      "short",
    ),
  ])("refuses an invalid Apple secret without exposing it %#", (secret) => {
    expect(() =>
      validateConfig(
        "production",
        { ...env(), APPLE_CLIENT_SECRET: secret },
        now,
      ),
    ).toThrow();
  });
  it.each([
    { iss: "" },
    { iss: 42 },
    { iat: "yesterday" },
    { iat: 1.5 },
    { iat: Math.floor(now / 1000) + 61 },
    { iat: Math.floor(now / 1000) + 50, exp: Math.floor(now / 1000) + 40 },
    { exp: Math.floor(now / 1000) + 15_777_001 },
  ])("rejects invalid Apple issuer/time bounds %j", (claims) => {
    const secret = token({
      sub: servicesId,
      aud: "https://appleid.apple.com",
      exp: Math.floor(now / 1000) + 3600,
      ...claims,
    });
    expect(() =>
      validateConfig(
        "production",
        { ...env(), APPLE_CLIENT_SECRET: secret },
        now,
      ),
    ).toThrow("Apple client secret");
  });
  it.each(["production", "staging"] as const)(
    "rejects using the %s native bundle ID as the web Services ID",
    (stage) => {
      expect(() =>
        validateConfig(
          stage,
          {
            ...env(stage),
            APPLE_SERVICES_ID: `com.bradleyevans96.persistence${stage === "staging" ? ".staging" : ""}`,
          },
          now,
        ),
      ).toThrow("Services ID");
    },
  );
  it("refuses a malformed Services ID", () => {
    expect(() =>
      validateConfig(
        "production",
        { ...env(), APPLE_SERVICES_ID: "not-an-identifier" },
        now,
      ),
    ).toThrow("Services ID");
  });
});

describe("Apple configuration update", () => {
  const config = validateConfig("production", env(), now);
  it("puts the web Services ID first, preserves native IDs and redirects, and is idempotent", () => {
    const patch = buildPatch(config, existing);
    expect(patch).toEqual({
      external_apple_enabled: true,
      external_apple_client_id: `${servicesId},native.older,native.extra,com.bradleyevans96.persistence`,
      external_apple_secret: config.clientSecret,
      uri_allow_list: `persistence://**,https://existing.example/callback,${config.callback}`,
    });
    expect(buildPatch(config, patch)).toEqual(patch);
    expect(existing.external_google_secret).toBe("do-not-copy");
  });
  it("initializes disabled provider fields without losing the required native ID", () => {
    const patch = buildPatch(config, {
      external_apple_enabled: false,
      external_apple_client_id: "",
      uri_allow_list: "",
    });
    expect(patch.external_apple_client_id).toBe(
      `${servicesId},com.bradleyevans96.persistence`,
    );
    expect(patch.uri_allow_list).toBe(config.callback);
  });
  it.each([
    null,
    [],
    {},
    { ...existing, external_apple_enabled: "true" },
    { ...existing, external_apple_client_id: 42 },
    { ...existing, uri_allow_list: [] },
  ])("fails closed on malformed management API configuration %#", (value) => {
    expect(() => buildPatch(config, value)).toThrow(
      "invalid auth configuration",
    );
  });
  it("accepts explicitly null fields for an unconfigured Apple provider", () => {
    expect(
      buildPatch(config, {
        external_apple_enabled: false,
        external_apple_client_id: null,
        uri_allow_list: null,
      }),
    ).toMatchObject({
      external_apple_client_id: `${servicesId},com.bradleyevans96.persistence`,
      uri_allow_list: config.callback,
    });
  });
  it("GETs then PATCHes only the allowed fields and rereads configuration", async () => {
    const fetcher = successfulFetch();
    await configureAppleAuth(config, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const [url, options] = fetcher.mock.calls[1]!;
    expect(url).toBe(
      `https://api.supabase.com/v1/projects/${ref("production")}/config/auth`,
    );
    expect(options).toMatchObject({
      method: "PATCH",
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(options!.body as string)).toEqual(
      buildPatch(config, existing),
    );
    expect(fetcher.mock.calls[0]![1]?.method).toBe("GET");
    expect(fetcher.mock.calls[2]![1]?.method).toBe("GET");
  });
  it.each([
    "external_apple_enabled",
    "external_apple_client_id",
    "uri_allow_list",
  ])("fails verification if %s did not apply", async (key) => {
    const patch = buildPatch(config, existing);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(existing))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(
        json({
          ...patch,
          [key]: key === "external_apple_enabled" ? false : "wrong",
        }),
      );
    await expect(configureAppleAuth(config, fetcher)).rejects.toThrow(
      "verification failed",
    );
  });
  it.each([0, 1, 2])(
    "redacts failing API response at step %s",
    async (step) => {
      const responses = [
        json(existing),
        json({}),
        json(buildPatch(config, existing)),
      ];
      responses[step] = new Response("SECRET FROM RESPONSE", {
        status: 403,
        statusText: "LEAK",
      });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => responses.shift()!);
      const output = { log: vi.fn(), error: vi.fn() };
      expect(await runCli(["production"], env(), fetcher, output)).toBe(1);
      expect(output.error).toHaveBeenCalledWith(
        expect.stringContaining("HTTP 403"),
      );
      expect(JSON.stringify(output.error.mock.calls)).not.toMatch(
        /SECRET|LEAK|sbp_private/,
      );
    },
  );
  it("redacts network errors and stops rather than patching after an unreadable GET", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("TOKEN LEAK"));
    await expect(configureAppleAuth(config, fetcher)).rejects.toThrow(
      "GET request failed",
    );
    const malformed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not json, secret"));
    await expect(configureAppleAuth(config, malformed)).rejects.toThrow(
      "unreadable auth configuration",
    );
    expect(malformed).toHaveBeenCalledTimes(1);
  });
  it("check mode validates locally without even reading configuration", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const output = { log: vi.fn(), error: vi.fn() };
    expect(
      await runCli(["production", "--check"], env(), fetcher, output),
    ).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(output.log).toHaveBeenCalledWith(
      "Apple auth inputs validated; no network changes made.",
    );
  });
  it("reports successful synchronization without logging configuration", async () => {
    const output = { log: vi.fn(), error: vi.fn() };
    expect(await runCli(["production"], env(), successfulFetch(), output)).toBe(
      0,
    );
    expect(output.log).toHaveBeenCalledWith(
      "Apple auth configuration applied and verified.",
    );
    expect(output.error).not.toHaveBeenCalled();
    expect(JSON.stringify(output.log.mock.calls)).not.toContain(
      config.clientSecret,
    );
  });
});
