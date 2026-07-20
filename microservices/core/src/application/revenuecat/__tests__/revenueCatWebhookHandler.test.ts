import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────
// vi.hoisted so these initialise BEFORE the hoisted vi.mock factories run
// (the factories close over them at module-eval time).
const {
  findByExternalIdMock,
  updateByIdMock,
  insertMock,
  upsertByExternalIdMock,
  cancelLiveMock,
  userExistsMock,
  claimMock,
  markDoneMock,
  markFailedMock,
  fetchEntMock,
} = vi.hoisted(() => ({
  findByExternalIdMock: vi.fn(),
  updateByIdMock: vi.fn(),
  insertMock: vi.fn(),
  upsertByExternalIdMock: vi.fn(),
  cancelLiveMock: vi.fn(),
  userExistsMock: vi.fn(),
  claimMock: vi.fn(),
  markDoneMock: vi.fn(),
  markFailedMock: vi.fn(),
  fetchEntMock: vi.fn(),
}));

vi.mock("../../repositories/subscriptionRepository", () => ({
  LIVE_SUBSCRIPTION_STATUSES: ["active", "pending", "trialing", "past_due"],
  SubscriptionRepository: vi.fn().mockImplementation(() => ({
    findByExternalId: findByExternalIdMock,
    updateById: updateByIdMock,
    insert: insertMock,
    upsertByExternalId: upsertByExternalIdMock,
    cancelLiveSubscriptions: cancelLiveMock,
    userExists: userExistsMock,
  })),
}));

vi.mock("../../repositories/revenuecatWebhookEventsRepository", () => ({
  RevenueCatWebhookEventsRepository: vi.fn().mockImplementation(() => ({
    claim: claimMock,
    markDone: markDoneMock,
    markFailed: markFailedMock,
  })),
}));

vi.mock("../revenueCatClient", () => ({
  fetchActiveEntitlements: fetchEntMock,
  getRevenueCatWebhookSecret: () => "rc_whsec_test",
}));

import {
  handleRevenueCatWebhook,
  isRevenueCatAnonymousId,
  resolveAppUserIds,
  secretsMatch,
} from "../revenueCatWebhookHandler";

const SECRET = "rc_whsec_test";

function buildRequest({
  body = JSON.stringify({
    event: { id: "evt_1", type: "INITIAL_PURCHASE", app_user_id: "user-1" },
  }),
  auth = SECRET as string | null,
}: { body?: string; auth?: string | null } = {}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (auth !== null) headers["authorization"] = auth;
  return new Request("http://localhost/revenuecat/webhook", {
    method: "POST",
    headers,
    body,
  });
}

describe("secretsMatch", () => {
  it("true for equal strings", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
  });
  it("false for unequal length", () => {
    expect(secretsMatch("abc", "abcd")).toBe(false);
  });
  it("false for same length, different content", () => {
    expect(secretsMatch("abc", "abd")).toBe(false);
  });
});

describe("isRevenueCatAnonymousId", () => {
  it("true for the RevenueCat anonymous id prefix", () => {
    expect(isRevenueCatAnonymousId("$RCAnonymousID:abc")).toBe(true);
  });
  it("false for a Supabase-style id", () => {
    expect(isRevenueCatAnonymousId("3f1a2b4c-...-uuid")).toBe(false);
  });
});

describe("resolveAppUserIds", () => {
  it("returns the single app_user_id", () => {
    expect(resolveAppUserIds({ app_user_id: "u1" })).toEqual(["u1"]);
  });
  it("collects + dedupes transfer arrays", () => {
    expect(
      resolveAppUserIds({
        transferred_to: ["a", "b"],
        transferred_from: ["b", "c"],
      }),
    ).toEqual(["a", "b", "c"]);
  });
  it("drops non-strings and empties", () => {
    expect(
      resolveAppUserIds({
        app_user_id: "",
        transferred_to: [1, "x", null],
      } as never),
    ).toEqual(["x"]);
  });
  it("returns [] when nothing is present", () => {
    expect(resolveAppUserIds({})).toEqual([]);
  });
});

describe("handleRevenueCatWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimMock.mockResolvedValue(true);
    markDoneMock.mockResolvedValue(undefined);
    markFailedMock.mockResolvedValue(undefined);
    findByExternalIdMock.mockResolvedValue(null);
    updateByIdMock.mockResolvedValue({ id: "us1" });
    insertMock.mockResolvedValue({ id: "us1" });
    upsertByExternalIdMock.mockResolvedValue({ id: "us1" });
    cancelLiveMock.mockResolvedValue(0);
    userExistsMock.mockResolvedValue(true);
    fetchEntMock.mockResolvedValue([]);
  });

  it("401 when the Authorization header is missing (claim not attempted)", async () => {
    const res = await handleRevenueCatWebhook(buildRequest({ auth: null }));
    expect(res.status).toBe(401);
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("401 when the secret does not match", async () => {
    const res = await handleRevenueCatWebhook(buildRequest({ auth: "wrong" }));
    expect(res.status).toBe(401);
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON", async () => {
    const res = await handleRevenueCatWebhook(buildRequest({ body: "{nope" }));
    expect(res.status).toBe(400);
  });

  it("400 when the event is missing id/type", async () => {
    const res = await handleRevenueCatWebhook(
      buildRequest({ body: JSON.stringify({ event: { app_user_id: "u1" } }) }),
    );
    expect(res.status).toBe(400);
  });

  it("200 duplicate when the event was already claimed (no sync)", async () => {
    claimMock.mockResolvedValue(false);
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(fetchEntMock).not.toHaveBeenCalled();
  });

  it("active entitlement → cancels live siblings then upserts the canonical row (atomic, no find→insert)", async () => {
    fetchEntMock.mockResolvedValue([
      {
        tier: "premium",
        expiresAt: new Date("2026-07-01T00:00:00.000Z"),
        productId: "premium_monthly",
        store: "app_store",
      },
    ]);
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(200);
    expect(cancelLiveMock).toHaveBeenCalledWith("user-1");
    expect(upsertByExternalIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        tierName: "premium",
        paymentStatus: "active",
        externalSubscriptionId: "rc_user-1",
        billingCycle: "monthly",
      }),
    );
    // spec-12.13: the active branch no longer does the non-atomic
    // findByExternalId→insert-or-update dance — a single upsert replaces it.
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(findByExternalIdMock).not.toHaveBeenCalled();
    expect(markDoneMock).toHaveBeenCalledWith("evt_1");
  });

  it("active entitlement → cancels siblings BEFORE the upsert (no active-unique violation when re-activating across rails)", async () => {
    // A sibling row (e.g. a Stripe mirror) may be live while the rc_ mirror is
    // (re)activated. cancelLiveSubscriptions MUST run before the upsert, else two
    // live rows for one user trip the user_subscriptions_active_unique index.
    fetchEntMock.mockResolvedValue([
      { tier: "premium", expiresAt: null, productId: null, store: null },
    ]);
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(200);
    const cancelOrder = cancelLiveMock.mock.invocationCallOrder[0];
    const upsertOrder = upsertByExternalIdMock.mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(upsertOrder);
    expect(upsertByExternalIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalSubscriptionId: "rc_user-1",
        paymentStatus: "active",
      }),
    );
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  it("skips an anonymous app_user_id (no entitlement fetch, no writes)", async () => {
    const body = JSON.stringify({
      event: {
        id: "evt_anon",
        type: "INITIAL_PURCHASE",
        app_user_id: "$RCAnonymousID:abc123",
      },
    });
    const res = await handleRevenueCatWebhook(buildRequest({ body }));
    expect(res.status).toBe(200);
    expect(fetchEntMock).not.toHaveBeenCalled();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(upsertByExternalIdMock).not.toHaveBeenCalled();
    expect(cancelLiveMock).not.toHaveBeenCalled();
    expect(markDoneMock).toHaveBeenCalledWith("evt_anon");
  });

  it("skips an app_user_id with no matching profile (foreign environment on a shared RC project) — no fetch, no writes, 200 done", async () => {
    // Simulate a cross-environment event: the user exists in the OTHER
    // Supabase project, not this backend. Must no-op (not 500-loop on the FK).
    userExistsMock.mockResolvedValue(false);
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(200);
    expect(fetchEntMock).not.toHaveBeenCalled();
    expect(upsertByExternalIdMock).not.toHaveBeenCalled();
    expect(cancelLiveMock).not.toHaveBeenCalled();
    expect(findByExternalIdMock).not.toHaveBeenCalled();
    expect(markDoneMock).toHaveBeenCalledWith("evt_1");
  });

  it("no active entitlement + existing live rc row → cancels it (revert to free)", async () => {
    findByExternalIdMock.mockResolvedValue({
      id: "us9",
      paymentStatus: "active",
    });
    fetchEntMock.mockResolvedValue([]);
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(200);
    expect(updateByIdMock).toHaveBeenCalledWith("us9", {
      paymentStatus: "cancelled",
    });
  });

  it("no active entitlement + no existing row → no writes", async () => {
    findByExternalIdMock.mockResolvedValue(null);
    fetchEntMock.mockResolvedValue([]);
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(200);
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(upsertByExternalIdMock).not.toHaveBeenCalled();
  });

  it("TRANSFER event re-syncs both implicated users", async () => {
    const body = JSON.stringify({
      event: {
        id: "evt_t",
        type: "TRANSFER",
        transferred_to: ["a"],
        transferred_from: ["b"],
      },
    });
    await handleRevenueCatWebhook(buildRequest({ body }));
    expect(fetchEntMock).toHaveBeenCalledTimes(2);
    expect(fetchEntMock).toHaveBeenCalledWith("a");
    expect(fetchEntMock).toHaveBeenCalledWith("b");
  });

  it("marks the event failed + returns 500 when the sync throws", async () => {
    fetchEntMock.mockRejectedValue(new Error("rc down"));
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(500);
    expect(markFailedMock).toHaveBeenCalledWith("evt_1", "rc down");
    expect(markDoneMock).not.toHaveBeenCalled();
  });

  it("500s (retryable) — NOT a skip — when the profile lookup throws a transient error", async () => {
    // A transient DB error must not be mistaken for "foreign user": the event
    // must fail + retry, never markDone, so a real purchase isn't lost.
    userExistsMock.mockRejectedValue(new Error("connection terminated"));
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(500);
    expect(markFailedMock).toHaveBeenCalledWith(
      "evt_1",
      "connection terminated",
    );
    expect(markDoneMock).not.toHaveBeenCalled();
    expect(fetchEntMock).not.toHaveBeenCalled();
  });
});
