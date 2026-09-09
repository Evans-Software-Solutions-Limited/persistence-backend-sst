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
  RC_FETCH_TIMEOUT_MS,
  getRevenueCatApiKey,
  getRevenueCatProjectId,
  getRevenueCatWebhookSecret,
  normalizeSubscription,
  parseRcTimestamp,
  resolveAccessBoundaryMs,
  APPLE_BILLING_RETRY_CEILING_MS,
} from "../revenueCatClient";

/**
 * A real v2 `GET /customers/{id}/subscriptions` item, trimmed to the fields we
 * parse (captured from a live sandbox response 2026-07-22). The human
 * entitlement id lives at `entitlements.items[].lookup_key`.
 */
// ⚠ The captured period (2026-07-22 → 07-23) was in the FUTURE when this
// fixture was recorded and is now in the past, which silently turned every
// "ordinary subscription" assertion below into a lapsed-period one once
// `resolveAccessBoundaryMs` started distinguishing them. Anchor the period to
// `now` so the fixture keeps meaning "a live subscription" as time passes; the
// past-period shapes get their own explicit cases.
const DAY_MS = 86_400_000;
const PERIOD_START_MS = Date.now() - DAY_MS;
const PERIOD_END_MS = Date.now() + 29 * DAY_MS;

function realSubscriptionItem(over: Record<string, unknown> = {}) {
  return {
    gives_access: true,
    auto_renewal_status: "will_renew",
    current_period_starts_at: PERIOD_START_MS,
    current_period_ends_at: PERIOD_END_MS,
    ends_at: PERIOD_END_MS,
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

describe("resolveAccessBoundaryMs", () => {
  const NOW = 1_800_000_000_000;
  const HOUR = 3_600_000;

  it("keeps a future period end (the ordinary case)", () => {
    expect(resolveAccessBoundaryMs(NOW + HOUR, null, NOW)).toBe(NOW + HOUR);
  });

  it("passes through a null period end unchanged (no expiry known)", () => {
    expect(resolveAccessBoundaryMs(null, null, NOW)).toBeNull();
  });

  // ⚠ NOT null. Null reads as OPEN-ENDED everywhere, so nothing about the
  // passage of time would revoke it — a terminal RevenueCat event that never
  // arrives would grant indefinite paid access, which is the very failure mode
  // `liveSubscriptionFilter`'s docstring names. The extension is bounded so it
  // expires on its own.
  it("extends a past period end by the store's retry ceiling, not indefinitely", () => {
    expect(resolveAccessBoundaryMs(NOW - HOUR, null, NOW)).toBe(
      NOW - HOUR + APPLE_BILLING_RETRY_CEILING_MS,
    );
  });

  it("anchors the extension to the PERIOD END, so repeated syncs cannot ratchet it forward", () => {
    const periodEnd = NOW - 30 * 24 * HOUR;
    const first = resolveAccessBoundaryMs(periodEnd, null, NOW);
    const laterSync = resolveAccessBoundaryMs(periodEnd, null, NOW + 5 * HOUR);
    expect(first).toBe(laterSync);
  });

  it("lapses once the extension itself has run out", () => {
    // Past the store's own documented maximum, so a `gives_access` claim is no
    // longer something to honour — the boundary returned is in the past and
    // every reader treats it as lapsed.
    const boundary = resolveAccessBoundaryMs(
      NOW - APPLE_BILLING_RETRY_CEILING_MS - HOUR,
      null,
      NOW,
    );
    expect(boundary).not.toBeNull();
    expect(boundary as number).toBeLessThan(NOW);
  });

  it("uses a future grace window as the boundary instead", () => {
    expect(resolveAccessBoundaryMs(NOW - HOUR, NOW + 5 * HOUR, NOW)).toBe(
      NOW + 5 * HOUR,
    );
  });

  it("falls back to the bounded extension when the grace window has also passed", () => {
    expect(resolveAccessBoundaryMs(NOW - 5 * HOUR, NOW - HOUR, NOW)).toBe(
      NOW - 5 * HOUR + APPLE_BILLING_RETRY_CEILING_MS,
    );
  });

  it("uses a real grace window even when the period end is unparseable", () => {
    // The early `periodEndMs === null` return used to throw away the one
    // boundary the payload actually carried.
    expect(resolveAccessBoundaryMs(null, NOW + 5 * HOUR, NOW)).toBe(
      NOW + 5 * HOUR,
    );
  });

  it("does not let a grace window shorten a still-valid period", () => {
    // A future period end wins outright — grace is only consulted once the
    // period itself has run out.
    expect(resolveAccessBoundaryMs(NOW + 5 * HOUR, NOW + HOUR, NOW)).toBe(
      NOW + 5 * HOUR,
    );
  });

  it("treats the exact boundary instant as passed", () => {
    expect(resolveAccessBoundaryMs(NOW, null, NOW)).toBe(
      NOW + APPLE_BILLING_RETRY_CEILING_MS,
    );
  });
});

describe("normalizeSubscription", () => {
  it("normalises a real access-granting subscription via its nested lookup_key", () => {
    expect(normalizeSubscription(realSubscriptionItem())).toEqual({
      tier: "individual_trainer",
      expiresAt: new Date(PERIOD_END_MS),
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

  it("activates a PROMOTIONAL grant like any other access-granting subscription (spec-30 R4.3)", () => {
    // Comps / founding / student rail = RevenueCat promotional entitlements.
    // They surface in the same /subscriptions snapshot with gives_access:true and
    // an entitlement lookup_key that maps to a tier, so the reconcile activates
    // the tier cleanly — no special-casing needed. `store` carries "promotional".
    const promo = realSubscriptionItem({
      store: "promotional",
      auto_renewal_status: "will_not_renew",
      entitlements: { items: [{ lookup_key: "premium" }] },
    });
    expect(normalizeSubscription(promo)).toMatchObject({
      tier: "premium",
      store: "promotional",
    });
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
            { lookup_key: "coach_pro" },
            { lookup_key: "unknown" },
          ],
        },
      }),
    );
    expect(result?.tier).toBe("coach_pro");
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
    const iso = new Date(PERIOD_END_MS).toISOString();
    expect(
      normalizeSubscription(
        realSubscriptionItem({ current_period_ends_at: iso, ends_at: iso }),
      )?.expiresAt,
    ).toEqual(new Date(iso));
  });

  // ── Access boundary vs period end ────────────────────────────────────
  //
  // Every item reaching `normalizeSubscription` has passed the
  // `gives_access !== true` guard, so the store is saying the user HAS access
  // now. Copying an already-past period end into `expires_at` therefore wrote
  // "lapsed" for a paying customer — and `expires_at` is what
  // `liveSubscriptionFilter`, `get_user_subscription()`,
  // `classifySubscriptionStatus` and `computeIsFreeTier` all read as the access
  // boundary. Apple retries a failed renewal for up to 60 days with access
  // intact, reporting exactly this shape throughout.
  it("does NOT mirror an already-past period end as the access boundary", () => {
    const periodEnd = Date.now() - DAY_MS;
    expect(
      normalizeSubscription(
        realSubscriptionItem({
          current_period_ends_at: periodEnd,
          ends_at: periodEnd,
        }),
      )?.expiresAt,
    ).toEqual(new Date(periodEnd + APPLE_BILLING_RETRY_CEILING_MS));
  });

  it("prefers RevenueCat's grace_period_expires_at when the period has passed", () => {
    const graceEnd = Date.now() + 14 * DAY_MS;
    expect(
      normalizeSubscription(
        realSubscriptionItem({
          current_period_ends_at: Date.now() - DAY_MS,
          ends_at: Date.now() - DAY_MS,
          grace_period_expires_at: graceEnd,
        }),
      )?.expiresAt,
    ).toEqual(new Date(graceEnd));
  });

  it("falls back to the bounded extension when the grace window has ALSO passed", () => {
    const periodEnd = Date.now() - 30 * DAY_MS;
    expect(
      normalizeSubscription(
        realSubscriptionItem({
          current_period_ends_at: periodEnd,
          ends_at: periodEnd,
          grace_period_expires_at: Date.now() - DAY_MS,
        }),
      )?.expiresAt,
    ).toEqual(new Date(periodEnd + APPLE_BILLING_RETRY_CEILING_MS));
  });

  it("infers the billing cycle from the REAL period, not the widened boundary", () => {
    // A grace window must not stretch a monthly plan into an annual one.
    const normalised = normalizeSubscription(
      realSubscriptionItem({
        current_period_starts_at: Date.now() - 30 * DAY_MS,
        current_period_ends_at: Date.now() - DAY_MS,
        ends_at: Date.now() - DAY_MS,
        grace_period_expires_at: Date.now() + 60 * DAY_MS,
      }),
    );
    expect(normalised?.billingCycle).toBe("monthly");
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
        expiresAt: new Date(PERIOD_END_MS),
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

  it("aborts a stalled RevenueCat request before it can pin the sync transaction", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchCustomerSubscriptions("user-1");
    await vi.advanceTimersByTimeAsync(RC_FETCH_TIMEOUT_MS);
    await expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    vi.useRealTimers();
  });
});
