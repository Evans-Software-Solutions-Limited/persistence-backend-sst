import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/api-utils/env", () => ({
  getEnv: vi.fn((name: string) => {
    const map: Record<string, string> = {
      REVENUECAT_API_KEY: "sk_test_key",
      REVENUECAT_PROJECT_ID: "proj_123",
      REVENUECAT_WEBHOOK_SECRET: "rc_whsec_test",
    };
    return map[name] ?? "";
  }),
}));

import {
  fetchActiveEntitlements,
  fetchAutoRenewOff,
  getRevenueCatApiKey,
  getRevenueCatProjectId,
  getRevenueCatWebhookSecret,
  normalizeEntitlement,
  parseRcTimestamp,
} from "../revenueCatClient";

describe("env getters", () => {
  it("read their respective env vars", () => {
    expect(getRevenueCatApiKey()).toBe("sk_test_key");
    expect(getRevenueCatProjectId()).toBe("proj_123");
    expect(getRevenueCatWebhookSecret()).toBe("rc_whsec_test");
  });
});

describe("parseRcTimestamp", () => {
  it("parses epoch milliseconds", () => {
    const ms = 1782000000000;
    expect(parseRcTimestamp(ms)?.getTime()).toBe(ms);
  });
  it("parses an ISO string", () => {
    const iso = "2026-07-01T00:00:00.000Z";
    expect(parseRcTimestamp(iso)?.toISOString()).toBe(iso);
  });
  it("returns null for missing / unparseable / wrong-type values", () => {
    expect(parseRcTimestamp(null)).toBeNull();
    expect(parseRcTimestamp(undefined)).toBeNull();
    expect(parseRcTimestamp("not-a-date")).toBeNull();
    expect(parseRcTimestamp("")).toBeNull();
    expect(parseRcTimestamp(Number.NaN)).toBeNull();
    expect(parseRcTimestamp({})).toBeNull();
  });
});

describe("normalizeEntitlement", () => {
  it("normalises a known entitlement", () => {
    expect(
      normalizeEntitlement({
        entitlement_id: "premium",
        expires_at: 1782000000000,
        product_identifier: "premium_monthly",
        store: "app_store",
      }),
    ).toEqual({
      tier: "premium",
      expiresAt: new Date(1782000000000),
      productId: "premium_monthly",
      store: "app_store",
    });
  });

  it("returns null when the entitlement id is missing or unmodelled", () => {
    expect(normalizeEntitlement({})).toBeNull();
    expect(normalizeEntitlement({ entitlement_id: 123 })).toBeNull();
    expect(normalizeEntitlement({ entitlement_id: "unknown_tier" })).toBeNull();
  });

  it("tolerates missing product/store/expiry", () => {
    expect(normalizeEntitlement({ entitlement_id: "premium" })).toEqual({
      tier: "premium",
      expiresAt: null,
      productId: null,
      store: null,
    });
  });
});

describe("fetchActiveEntitlements", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: () => Promise<Response> | Response) {
    vi.stubGlobal("fetch", vi.fn(impl));
  }

  it("maps + filters the v2 items, calling the right URL with the bearer key", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              { entitlement_id: "premium", expires_at: 1782000000000 },
              { entitlement_id: "unknown" },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchActiveEntitlements("user-1");
    expect(result).toEqual([
      {
        tier: "premium",
        expiresAt: new Date(1782000000000),
        productId: null,
        store: null,
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.revenuecat.com/v2/projects/proj_123/customers/user-1/active_entitlements",
    );
    expect((init as RequestInit).headers).toEqual({
      Authorization: "Bearer sk_test_key",
    });
  });

  it("url-encodes the app user id", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchActiveEntitlements("user/with space");
    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    expect(calls[0][0]).toContain("user%2Fwith%20space");
  });

  it("returns [] when the response has no items array", async () => {
    stubFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    expect(await fetchActiveEntitlements("user-1")).toEqual([]);
  });

  it("throws on a non-2xx response (so the webhook retries)", async () => {
    stubFetch(() => new Response("nope", { status: 503, statusText: "err" }));
    await expect(fetchActiveEntitlements("user-1")).rejects.toThrow(
      /RevenueCat active_entitlements failed: 503/,
    );
  });
});

describe("fetchAutoRenewOff", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  function stubFetch(impl: () => Promise<Response> | Response) {
    vi.stubGlobal("fetch", vi.fn(impl));
  }

  it("true when an access-granting subscription won't renew (cancelled but active), hitting the right URL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              { gives_access: true, auto_renewal_status: "will_not_renew" },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAutoRenewOff("user-1")).toBe(true);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      "https://api.revenuecat.com/v2/projects/proj_123/customers/user-1/subscriptions",
    );
  });

  it("false when the will-not-renew subscription no longer grants access", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            items: [
              { gives_access: false, auto_renewal_status: "will_not_renew" },
            ],
          }),
          { status: 200 },
        ),
    );
    expect(await fetchAutoRenewOff("user-1")).toBe(false);
  });

  it("false when auto-renew is on", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            items: [{ gives_access: true, auto_renewal_status: "will_renew" }],
          }),
          { status: 200 },
        ),
    );
    expect(await fetchAutoRenewOff("user-1")).toBe(false);
  });

  it("fail-safe false on non-2xx, thrown error, or missing items", async () => {
    stubFetch(() => new Response("nope", { status: 500 }));
    expect(await fetchAutoRenewOff("user-1")).toBe(false);

    stubFetch(() => {
      throw new Error("network");
    });
    expect(await fetchAutoRenewOff("user-1")).toBe(false);

    stubFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    expect(await fetchAutoRenewOff("user-1")).toBe(false);
  });
});
