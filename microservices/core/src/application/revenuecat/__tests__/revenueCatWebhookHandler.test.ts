import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedSubscription } from "../entitlements";

// ─── Mocks ────────────────────────────────────────────────────────────
// vi.hoisted so these initialise BEFORE the hoisted vi.mock factories run
// (the factories close over them at module-eval time).
const {
  findByExternalIdMock,
  updateByIdMock,
  insertMock,
  upsertByExternalIdMock,
  cancelLiveMock,
  cancelLiveByExternalIdMock,
  userExistsMock,
  claimMock,
  markDoneMock,
  markFailedMock,
  fetchSubsMock,
  createAndDispatchMock,
} = vi.hoisted(() => ({
  findByExternalIdMock: vi.fn(),
  updateByIdMock: vi.fn(),
  insertMock: vi.fn(),
  upsertByExternalIdMock: vi.fn(),
  cancelLiveMock: vi.fn(),
  cancelLiveByExternalIdMock: vi.fn(),
  userExistsMock: vi.fn(),
  claimMock: vi.fn(),
  markDoneMock: vi.fn(),
  markFailedMock: vi.fn(),
  fetchSubsMock: vi.fn(),
  createAndDispatchMock: vi.fn(),
}));

vi.mock("../../repositories/subscriptionRepository", () => ({
  LIVE_SUBSCRIPTION_STATUSES: ["active", "pending", "trialing", "past_due"],
  SubscriptionRepository: vi.fn().mockImplementation(() => ({
    findByExternalId: findByExternalIdMock,
    updateById: updateByIdMock,
    insert: insertMock,
    upsertByExternalId: upsertByExternalIdMock,
    cancelLiveSubscriptions: cancelLiveMock,
    cancelLiveByExternalId: cancelLiveByExternalIdMock,
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
  fetchCustomerSubscriptions: fetchSubsMock,
  getRevenueCatWebhookSecret: () => "rc_whsec_test",
}));

vi.mock("../../notifications/push/notificationDispatcher", () => ({
  NotificationDispatcher: vi.fn().mockImplementation(() => ({
    createAndDispatch: createAndDispatchMock,
  })),
}));

import {
  handleRevenueCatWebhook,
  isRevenueCatAnonymousId,
  resolveAppUserIds,
  secretsMatch,
  transferredFromIds,
} from "../revenueCatWebhookHandler";

const SECRET = "rc_whsec_test";

/** A normalised access-granting subscription (what fetchCustomerSubscriptions returns). */
function subFixture(
  over: Partial<NormalizedSubscription> = {},
): NormalizedSubscription {
  return {
    tier: "premium",
    expiresAt: null,
    billingCycle: "monthly",
    productId: null,
    store: null,
    autoRenewOff: false,
    ...over,
  };
}

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
    fetchSubsMock.mockResolvedValue([]);
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
    expect(fetchSubsMock).not.toHaveBeenCalled();
  });

  it("access-granting subscription → cancels live siblings then upserts the canonical row (atomic, no find→insert)", async () => {
    fetchSubsMock.mockResolvedValue([
      subFixture({
        tier: "premium",
        expiresAt: new Date("2026-07-01T00:00:00.000Z"),
        productId: "prod_x",
        store: "app_store",
      }),
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

  it("threads the subscription's tier + expiry + store through to the write (the ingestion fix)", async () => {
    const expiresAt = new Date(1784807419000);
    fetchSubsMock.mockResolvedValue([
      subFixture({
        tier: "individual_trainer",
        expiresAt,
        productId: "prod1a5681d5cd",
        store: "app_store",
      }),
    ]);
    await handleRevenueCatWebhook(buildRequest());
    expect(upsertByExternalIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tierName: "individual_trainer",
        expiresAt,
        metadata: expect.objectContaining({
          source: "revenuecat",
          store: "app_store",
          product_id: "prod1a5681d5cd",
        }),
      }),
    );
  });

  it("sets cancelledAt when auto-renew is OFF (cancelled but active)", async () => {
    fetchSubsMock.mockResolvedValue([subFixture({ autoRenewOff: true })]);
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(200);
    const values = upsertByExternalIdMock.mock.calls[0][0] as {
      cancelledAt: Date | null;
    };
    expect(values.cancelledAt).toBeInstanceOf(Date);
  });

  it("leaves cancelledAt null when auto-renew is ON", async () => {
    fetchSubsMock.mockResolvedValue([subFixture({ autoRenewOff: false })]);
    await handleRevenueCatWebhook(buildRequest());
    const values = upsertByExternalIdMock.mock.calls[0][0] as {
      cancelledAt: Date | null;
    };
    expect(values.cancelledAt).toBeNull();
  });

  it("access-granting subscription → cancels siblings BEFORE the upsert (no active-unique violation when re-activating across rails)", async () => {
    // A sibling row (e.g. a Stripe mirror) may be live while the rc_ mirror is
    // (re)activated. cancelLiveSubscriptions MUST run before the upsert, else two
    // live rows for one user trip the user_subscriptions_active_unique index.
    fetchSubsMock.mockResolvedValue([subFixture({ tier: "premium" })]);
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

  it("skips an anonymous app_user_id (no subscription fetch, no writes)", async () => {
    const body = JSON.stringify({
      event: {
        id: "evt_anon",
        type: "INITIAL_PURCHASE",
        app_user_id: "$RCAnonymousID:abc123",
      },
    });
    const res = await handleRevenueCatWebhook(buildRequest({ body }));
    expect(res.status).toBe(200);
    expect(fetchSubsMock).not.toHaveBeenCalled();
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
    expect(fetchSubsMock).not.toHaveBeenCalled();
    expect(upsertByExternalIdMock).not.toHaveBeenCalled();
    expect(cancelLiveMock).not.toHaveBeenCalled();
    expect(findByExternalIdMock).not.toHaveBeenCalled();
    expect(markDoneMock).toHaveBeenCalledWith("evt_1");
  });

  it("no access-granting subscription + existing live rc row → cancels it (revert to free)", async () => {
    // The revert is now ONE atomic UPDATE scoped by external id + live status,
    // rather than findByExternalId → check → updateById. Same outcome; the status
    // check moved into the WHERE so exactly one concurrent caller can win it, and
    // so the "was this a revocation?" answer comes from rows-affected rather than
    // from a read that another event may already have invalidated.
    cancelLiveByExternalIdMock.mockResolvedValue(true);
    fetchSubsMock.mockResolvedValue([]);
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(200);
    expect(cancelLiveByExternalIdMock).toHaveBeenCalledWith("rc_user-1");
  });

  it("no access-granting subscription + no existing row → no writes", async () => {
    // Nothing live to cancel: the atomic update matches zero rows and reports it.
    cancelLiveByExternalIdMock.mockResolvedValue(false);
    fetchSubsMock.mockResolvedValue([]);
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
    expect(fetchSubsMock).toHaveBeenCalledTimes(2);
    expect(fetchSubsMock).toHaveBeenCalledWith("a");
    expect(fetchSubsMock).toHaveBeenCalledWith("b");
  });

  it("marks the event failed + returns 500 when the sync throws", async () => {
    fetchSubsMock.mockRejectedValue(new Error("rc down"));
    const res = await handleRevenueCatWebhook(buildRequest());
    expect(res.status).toBe(500);
    // The message now names WHICH app user failed, because a TRANSFER syncs two
    // and each is isolated — so assert the cause surfaces rather than pinning the
    // exact string.
    expect(markFailedMock).toHaveBeenCalledWith(
      "evt_1",
      expect.stringContaining("rc down"),
    );
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
      expect.stringContaining("connection terminated"),
    );
    expect(markDoneMock).not.toHaveBeenCalled();
    expect(fetchSubsMock).not.toHaveBeenCalled();
  });
});

describe("subscription-transfer notice", () => {
  /**
   * Apple binds a subscription to the APPLE ID, so "Restore Purchases" on another
   * app account legitimately MOVES it — and the losing account otherwise just
   * silently goes free. The move is reversible in one tap, so the notice is the
   * whole mitigation. These tests pin its scope, which is the part that can go
   * wrong: notifying on an ordinary expiry would tell users their sub "moved to
   * another account" when it merely lapsed.
   */
  const LOSER = "user-loser";
  const WINNER = "user-winner";

  function transferBody(over: Record<string, unknown> = {}): string {
    return JSON.stringify({
      event: {
        id: "evt_transfer",
        type: "TRANSFER",
        transferred_from: [LOSER],
        transferred_to: [WINNER],
        ...over,
      },
    });
  }

  beforeEach(() => {
    // These describes are file-level siblings, so they don't inherit the
    // handler suite's clear — without this, call counts leak across tests and a
    // `not.toHaveBeenCalled()` assertion sees the previous test's notification.
    vi.clearAllMocks();
    // Every mock the handler path touches, set HERE rather than inherited. These
    // describes are file-level siblings, and `clearAllMocks` keeps
    // implementations — so relying on the sibling suite's `beforeEach` having run
    // first made this suite order-dependent: under `-t`, `.only`, a reorder, or
    // removal of that sibling, the failure-isolation test threw
    // `Cannot read properties of undefined (reading 'catch')` instead of failing.
    claimMock.mockResolvedValue(true);
    markDoneMock.mockResolvedValue(undefined);
    markFailedMock.mockResolvedValue(undefined);
    userExistsMock.mockResolvedValue(true);
    updateByIdMock.mockResolvedValue(undefined);
    upsertByExternalIdMock.mockResolvedValue(undefined);
    cancelLiveMock.mockResolvedValue(0);
    cancelLiveByExternalIdMock.mockResolvedValue(true);
    createAndDispatchMock.mockResolvedValue(undefined);
    // Loser has a live row that the sync's atomic revoke will cancel (returning
    // true = "this call did it"); winner gains one.
    cancelLiveByExternalIdMock.mockImplementation(
      async (externalId: string) => externalId === `rc_${LOSER}`,
    );
    fetchSubsMock.mockImplementation(async (appUserId: string) =>
      appUserId === WINNER ? [subFixture()] : [],
    );
  });

  it("notifies the account that LOST the subscription", async () => {
    const res = await handleRevenueCatWebhook(
      buildRequest({ body: transferBody() }),
    );

    expect(res.status).toBe(200);
    expect(createAndDispatchMock).toHaveBeenCalledTimes(1);
    const [userId, payload] = createAndDispatchMock.mock.calls[0];
    expect(userId).toBe(LOSER);
    expect(payload.type).toBe("subscription_transferred");
    // The copy has to name the recovery action — the notice is only useful
    // because the transfer is reversible.
    expect(payload.message).toMatch(/restore purchases/i);
  });

  it("does NOT notify the account that gained it", async () => {
    await handleRevenueCatWebhook(buildRequest({ body: transferBody() }));

    const notified = createAndDispatchMock.mock.calls.map((c) => c[0]);
    expect(notified).not.toContain(WINNER);
  });

  it("does NOT notify on an ordinary expiry — only on a TRANSFER", async () => {
    // The revocation branch in the sync fires for expiry and cancellation too.
    // Telling that user their subscription "moved to another account" would be
    // both wrong and alarming.
    const res = await handleRevenueCatWebhook(
      buildRequest({
        body: JSON.stringify({
          event: { id: "evt_exp", type: "EXPIRATION", app_user_id: LOSER },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(cancelLiveByExternalIdMock).toHaveBeenCalled(); // it WAS revoked…
    expect(createAndDispatchMock).not.toHaveBeenCalled(); // …but stays silent
  });

  it("ignores transferred_from on a NON-transfer event type", async () => {
    // The `eventType === "TRANSFER"` gate is defensive: today RevenueCat only
    // puts `transferred_from` on TRANSFER events, so the previous test (an
    // EXPIRATION with no such field) passes with the gate deleted. That makes
    // this the only test that pins it — and it is worth pinning, because the
    // alternative is trusting a third party's payload shape not to change. A
    // future event type that carried the field must not notify.
    const res = await handleRevenueCatWebhook(
      buildRequest({
        body: JSON.stringify({
          event: {
            id: "evt_weird",
            type: "PRODUCT_CHANGE",
            transferred_from: [LOSER],
          },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(createAndDispatchMock).not.toHaveBeenCalled();
  });

  it("notifies ONLY the from-side even when both sides come back revoked", async () => {
    // Pins `transferredFromIds` against `resolveAppUserIds` (which unions both
    // sides, because both need re-SYNCING — only the from-side gets notified).
    // The earlier "does not notify the winner" test can't catch a swap here: in
    // that fixture the winner syncs to `activated`, so the outcome filter blocks
    // it anyway. Revoking both isolates the id-selection from the outcome check.
    fetchSubsMock.mockResolvedValue([]);
    cancelLiveByExternalIdMock.mockResolvedValue(true);

    await handleRevenueCatWebhook(buildRequest({ body: transferBody() }));

    const notified = createAndDispatchMock.mock.calls.map((c) => c[0]);
    expect(notified).toEqual([LOSER]);
  });

  it("stays silent when the transferred-from user had nothing live", async () => {
    // A no-op sync must not manufacture a loss. Also covers the anonymous and
    // foreign-environment ids, which the sync reports as `skipped`.
    cancelLiveByExternalIdMock.mockResolvedValue(false);

    await handleRevenueCatWebhook(buildRequest({ body: transferBody() }));

    expect(createAndDispatchMock).not.toHaveBeenCalled();
  });

  it("does not notify an anonymous transferred-from id", async () => {
    // The revoke must SUCCEED for the anon external id, otherwise this passes for
    // the wrong reason (outcome `already_inactive`) and deleting
    // `isRevenueCatAnonymousId`'s early return leaves it green — which it did.
    cancelLiveByExternalIdMock.mockResolvedValue(true);
    const anon = "$RCAnonymousID:abc123";
    await handleRevenueCatWebhook(
      buildRequest({ body: transferBody({ transferred_from: [anon] }) }),
    );

    expect(createAndDispatchMock).not.toHaveBeenCalled();
  });

  it("keeps the notice when a LATER sync in the same event throws", async () => {
    // `revoked` is an edge, not a state: a retry re-syncs the loser to
    // `already_inactive`, so the signal is gone for good. Notifying only after the
    // whole loop therefore DISCARDED an already-earned notice whenever another
    // user in the same event failed — the loser's revocation had already
    // committed, the event eventually goes `done`, and they are never told. That
    // is the exact silent loss this feature exists to remove.
    fetchSubsMock.mockImplementation(async (appUserId: string) => {
      if (appUserId === WINNER) throw new Error("RC 503");
      return [];
    });

    const res = await handleRevenueCatWebhook(
      buildRequest({ body: transferBody() }),
    );

    // The event still fails (so RevenueCat retries the sync)…
    expect(res.status).toBe(500);
    expect(markFailedMock).toHaveBeenCalled();
    // …but the loser was already notified, before the failure.
    expect(createAndDispatchMock).toHaveBeenCalledTimes(1);
    expect(createAndDispatchMock.mock.calls[0][0]).toBe(LOSER);
  });

  it("does not notify twice for a repeated transferred_from entry", async () => {
    // Structural, now that notify happens inside the sync loop: that loop iterates
    // the already-deduped `resolveAppUserIds`, and eligibility is a Set lookup — so
    // a repeated entry cannot be visited twice. Deleting `transferredFromIds`'
    // own dedupe does NOT break this (verified by mutation); the direct unit test
    // below is what pins that function's contract. Kept because it pins the
    // end-to-end property a future refactor of the loop could regress.
    await handleRevenueCatWebhook(
      buildRequest({
        body: transferBody({ transferred_from: [LOSER, LOSER] }),
      }),
    );

    expect(createAndDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("still marks the event done when the notification throws", async () => {
    // A push failure must never fail the webhook: RevenueCat would retry the
    // whole sync, re-notifying every time and re-running settled writes.
    createAndDispatchMock.mockRejectedValue(new Error("expo down"));

    const res = await handleRevenueCatWebhook(
      buildRequest({ body: transferBody() }),
    );

    expect(res.status).toBe(200);
    expect(markDoneMock).toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
  });
});

describe("transferredFromIds", () => {
  it("returns only the from-side ids", () => {
    expect(
      transferredFromIds({
        transferred_from: ["a", "b"],
        transferred_to: ["c"],
      } as never),
    ).toEqual(["a", "b"]);
  });

  it("de-duplicates, matching resolveAppUserIds", () => {
    // The exported contract. The handler no longer depends on it (its loop and Set
    // make duplicates unreachable), but an exported helper that silently differed
    // from the sibling it is modelled on is a trap for the next caller.
    expect(
      transferredFromIds({ transferred_from: ["a", "a", "b"] } as never),
    ).toEqual(["a", "b"]);
  });

  it("is empty when absent or malformed", () => {
    expect(transferredFromIds({} as never)).toEqual([]);
    expect(transferredFromIds({ transferred_from: "a" } as never)).toEqual([]);
    expect(
      transferredFromIds({ transferred_from: [1, "", "ok"] } as never),
    ).toEqual(["ok"]);
  });
});
