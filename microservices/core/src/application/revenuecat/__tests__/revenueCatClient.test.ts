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
  fetchCustomerSubscriptions,
  getRevenueCatApiKey,
  getRevenueCatProjectId,
  getRevenueCatWebhookSecret,
  normalizeSubscription,
  parseRcTimestamp,
} from "../revenueCatClient";

/**
 * A real v2 `GET /customers/{id}/subscriptions` item, trimmed to the fields we
 * parse (captured from a live sandbox response 2026-07-22). The human
 * entitlement id lives at `entitlements.items[].lookup_key`.
 */
function realSubscriptionItem(over: Record<string, unknown> = {}) {
  return {
    gives_access: true,
    auto_renewal_status: "will_renew",
    current_period_starts_at: 1784721019000,
    current_period_ends_at: 1784807419000,
    ends_at: 1784807419000,
    product_id: "prod1a5681d5cd",
    store: "app_store",
    status: "trialing",
    entitlements: {
      items: [
        {
          id: "entla453e0a079",
          lookup_key: "individual_trainer",
          object: "entitlement",
          state: "active",
        },
      ],
    },
    ...over,
  };
}

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

describe("normalizeSubscription", () => {
  it("normalises a real access-granting subscription via its nested lookup_key", () => {
    expect(normalizeSubscription(realSubscriptionItem())).toEqual({
      tier: "individual_trainer",
      expiresAt: new Date(1784807419000),
      billingCycle: "monthly",
      productId: "prod1a5681d5cd",
      store: "app_store",
      autoRenewOff: false,
    });
  });

  it("returns null when the subscription grants no access", () => {
    expect(
      normalizeSubscription(realSubscriptionItem({ gives_access: false })),
    ).toBeNull();
  });

  it("returns null when no entitlement maps to a modelled tier", () => {
    expect(
      normalizeSubscription(
        realSubscriptionItem({
          entitlements: { items: [{ lookup_key: "something_new" }] },
        }),
      ),
    ).toBeNull();
    expect(
      normalizeSubscription(
        realSubscriptionItem({ entitlements: { items: [] } }),
      ),
    ).toBeNull();
    expect(
      normalizeSubscription(realSubscriptionItem({ entitlements: undefined })),
    ).toBeNull();
  });

  it("picks the highest-ranked entitlement when a subscription lists several", () => {
    const result = normalizeSubscription(
      realSubscriptionItem({
        entitlements: {
          items: [
            { lookup_key: "premium" },
            { lookup_key: "medium_enterprise" },
            { lookup_key: "unknown" },
          ],
        },
      }),
    );
    expect(result?.tier).toBe("medium_enterprise");
  });

  it("flags auto-renew off (cancelled but active)", () => {
    expect(
      normalizeSubscription(
        realSubscriptionItem({ auto_renewal_status: "will_not_renew" }),
      )?.autoRenewOff,
    ).toBe(true);
  });

  it("falls back to ends_at when current_period_ends_at is absent, else null expiry", () => {
    expect(
      normalizeSubscription(
        realSubscriptionItem({
          current_period_ends_at: undefined,
          ends_at: 1790000000000,
        }),
      )?.expiresAt,
    ).toEqual(new Date(1790000000000));
    expect(
      normalizeSubscription(
        realSubscriptionItem({
          current_period_ends_at: undefined,
          ends_at: undefined,
        }),
      )?.expiresAt,
    ).toBeNull();
  });

  it("tolerates an ISO-string timestamp (shape-change insurance)", () => {
    expect(
      normalizeSubscription(
        realSubscriptionItem({
          current_period_ends_at: "2026-07-01T00:00:00.000Z",
        }),
      )?.expiresAt,
    ).toEqual(new Date("2026-07-01T00:00:00.000Z"));
  });

  it("returns null (never throws) for a null / non-object item", () => {
    expect(normalizeSubscription(null as never)).toBeNull();
    expect(normalizeSubscription(undefined as never)).toBeNull();
    expect(normalizeSubscription("nope" as never)).toBeNull();
  });
});

describe("fetchCustomerSubscriptions", () => {
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
              realSubscriptionItem(),
              realSubscriptionItem({ gives_access: false }), // dropped
              realSubscriptionItem({
                entitlements: { items: [{ lookup_key: "unknown" }] },
              }), // dropped
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCustomerSubscriptions("user-1");
    expect(result).toEqual([
      {
        tier: "individual_trainer",
        expiresAt: new Date(1784807419000),
        billingCycle: "monthly",
        productId: "prod1a5681d5cd",
        store: "app_store",
        autoRenewOff: false,
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.revenuecat.com/v2/projects/proj_123/customers/user-1/subscriptions",
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
    await fetchCustomerSubscriptions("user/with space");
    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    expect(calls[0][0]).toContain("user%2Fwith%20space");
  });

  it("returns [] when the response has no items array", async () => {
    stubFetch(() => new Response(JSON.stringify({}), { status: 200 }));
    expect(await fetchCustomerSubscriptions("user-1")).toEqual([]);
  });

  it("skips null/malformed items without throwing (payment path must converge)", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ items: [null, realSubscriptionItem(), {}] }),
          { status: 200 },
        ),
    );
    const result = await fetchCustomerSubscriptions("user-1");
    expect(result).toHaveLength(1);
    expect(result[0].tier).toBe("individual_trainer");
  });

  it("throws on a non-2xx response (so the webhook retries, never revoking access)", async () => {
    stubFetch(() => new Response("nope", { status: 503, statusText: "err" }));
    await expect(fetchCustomerSubscriptions("user-1")).rejects.toThrow(
      /RevenueCat subscriptions failed: 503/,
    );
  });
});
