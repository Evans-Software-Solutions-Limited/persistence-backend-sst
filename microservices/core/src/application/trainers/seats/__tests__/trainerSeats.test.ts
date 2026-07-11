/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

// NotificationDispatcher is mocked so the notify helper's best-effort contract
// can be asserted without touching push infra.
const createAndDispatch = vi.fn(async () => ({}));
vi.mock("../../../notifications/push/notificationDispatcher", () => ({
  NotificationDispatcher: vi.fn(() => ({ createAndDispatch })),
}));

/**
 * Thenable query-builder mock. One `.select()` == one logical query and pops
 * the next queued row-set; every chain method returns the same builder and the
 * builder is awaitable at ANY terminal (`.where()` for count queries,
 * `.limit()` for resolve queries), resolving to that row-set. `.where()` /
 * `.leftJoin()` predicates are captured so a test can render them via
 * `PgDialect` — the mocked-DB SQL blind spot per
 * reference_drizzle_groupby_param_bug.md.
 */
interface Capture {
  wheres: unknown[];
}
function makeChain(rows: unknown, capture: Capture) {
  const chain: any = {};
  const self = () => chain;
  chain.from = vi.fn(self);
  chain.leftJoin = vi.fn(self);
  chain.innerJoin = vi.fn(self);
  chain.orderBy = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.for = vi.fn(self);
  chain.where = vi.fn((cond: unknown) => {
    capture.wheres.push(cond);
    return chain;
  });
  chain.then = (
    resolve: (v: unknown) => unknown,
    reject: (e: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}
function makeQueueDb(queue: unknown[][], capture: Capture = { wheres: [] }) {
  return {
    select: vi.fn(() => makeChain(queue.length ? queue.shift() : [], capture)),
  };
}

// ─── Row builders ─────────────────────────────────────────────────────
const trainerSub = (over: Record<string, unknown> = {}) => [
  {
    tierName: "individual_trainer",
    paymentStatus: "active",
    expiresAt: null,
    trainerClientLimit: 2,
    isTrainerTier: true,
    ...over,
  },
];
const nonTrainerSub = (over: Record<string, unknown> = {}) => [
  {
    tierName: "premium",
    paymentStatus: "active",
    expiresAt: null,
    trainerClientLimit: null,
    isTrainerTier: false,
    ...over,
  },
];
const tierRow = (
  tierName: string,
  priceMonthly: string,
  trainerClientLimit: number | null,
  isTrainerTier: boolean,
) => [
  {
    tierName,
    workoutLimit: null,
    aiAccess: true,
    priceMonthly,
    trainerClientLimit,
    isTrainerTier,
  },
];
const FREE_TIER = tierRow("free", "0.00", null, false);
const INDIVIDUAL_TIER = tierRow("individual_trainer", "14.99", 2, true);
const SMALL_BIZ_TIER = tierRow("small_business", "49.99", 30, true);
const count = (n: number) => [{ total: n }];

describe("nextTrainerTierUp", () => {
  it("steps up the trainer-tier ladder; non-trainer → cheapest trainer tier; top → null", async () => {
    const { nextTrainerTierUp } =
      await import("../../../entitlement/assertEntitlement");
    expect(nextTrainerTierUp("individual_trainer")).toBe("small_business");
    expect(nextTrainerTierUp("small_business")).toBe("medium_enterprise");
    expect(nextTrainerTierUp("medium_enterprise")).toBeNull();
    expect(nextTrainerTierUp("free")).toBe("individual_trainer");
    expect(nextTrainerTierUp("premium")).toBe("individual_trainer");
  });
});

describe("evaluateTrainerClientsActiveSeat (active-cap verdict)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows a trainer under their active cap", async () => {
    const { evaluateTrainerClientsActiveSeat } =
      await import("../../../entitlement/assertEntitlement");
    const db = makeQueueDb([trainerSub(), count(1)]) as any; // limit 2, 1 active
    const v = await evaluateTrainerClientsActiveSeat("t1", db);
    expect(v).toEqual({ allowed: true });
  });

  it("denies at the active cap with reason 'limit' + next-tier-up upgrade", async () => {
    const { evaluateTrainerClientsActiveSeat } =
      await import("../../../entitlement/assertEntitlement");
    const db = makeQueueDb([
      trainerSub(), // limit 2
      count(2), // 2 active → at cap
      SMALL_BIZ_TIER, // buildDeny loads the upgrade tier price
    ]) as any;
    const v = await evaluateTrainerClientsActiveSeat("t1", db);
    expect(v).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "individual_trainer",
      upgradeTo: "small_business",
      upgradePriceMonthly: 49.99,
    });
  });

  it("treats a trainer tier with a NULL limit as unlimited", async () => {
    const { evaluateTrainerClientsActiveSeat } =
      await import("../../../entitlement/assertEntitlement");
    const db = makeQueueDb([trainerSub({ trainerClientLimit: null })]) as any; // no count query needed
    const v = await evaluateTrainerClientsActiveSeat("t1", db);
    expect(v).toEqual({ allowed: true });
  });

  it("denies a non-trainer tier with reason 'tier' → individual_trainer", async () => {
    const { evaluateTrainerClientsActiveSeat } =
      await import("../../../entitlement/assertEntitlement");
    const db = makeQueueDb([nonTrainerSub(), INDIVIDUAL_TIER]) as any;
    const v = await evaluateTrainerClientsActiveSeat("t1", db);
    expect(v).toEqual({
      allowed: false,
      reason: "tier",
      currentTier: "premium",
      upgradeTo: "individual_trainer",
      upgradePriceMonthly: 14.99,
    });
  });

  it("reverts a cancelled trainer sub to free rules → reason 'cancelled', no upgrade CTA", async () => {
    const { evaluateTrainerClientsActiveSeat } =
      await import("../../../entitlement/assertEntitlement");
    const db = makeQueueDb([
      trainerSub({ paymentStatus: "cancelled", expiresAt: null }),
      FREE_TIER, // revert-to-free loadTier
    ]) as any;
    const v = await evaluateTrainerClientsActiveSeat("t1", db);
    expect(v).toEqual({
      allowed: false,
      reason: "cancelled",
      currentTier: "individual_trainer",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("denies medium_enterprise at 500 clients with NO upgrade target (top tier)", async () => {
    const { evaluateTrainerClientsActiveSeat } =
      await import("../../../entitlement/assertEntitlement");
    const db = makeQueueDb([
      trainerSub({ tierName: "medium_enterprise", trainerClientLimit: 500 }),
      count(500),
    ]) as any;
    const v = await evaluateTrainerClientsActiveSeat("t1", db);
    expect(v).toEqual({
      allowed: false,
      reason: "limit",
      currentTier: "medium_enterprise",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });
});

describe("assertEntitlement(userId, 'trainer_clients') routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows under cap", async () => {
    const { assertEntitlement } =
      await import("../../../entitlement/assertEntitlement");
    (getDb as any).mockReturnValue(makeQueueDb([trainerSub(), count(0)]));
    const v = await assertEntitlement("t1", "trainer_clients");
    expect(v).toEqual({ allowed: true });
  });

  it("denies at cap (verdict maps through EntitlementError → 402 elsewhere)", async () => {
    const { assertEntitlement } =
      await import("../../../entitlement/assertEntitlement");
    (getDb as any).mockReturnValue(
      makeQueueDb([trainerSub(), count(2), SMALL_BIZ_TIER]),
    );
    const v = await assertEntitlement("t1", "trainer_clients");
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.reason).toBe("limit");
      expect(v.upgradeTo).toBe("small_business");
    }
  });
});

describe("countCommittedTrainerSeats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sums active+pending relationships and pending invitations", async () => {
    const { countCommittedTrainerSeats } = await import("../trainerSeats");
    const db = makeQueueDb([count(3), count(2)]) as any; // rels=3, invites=2
    expect(await countCommittedTrainerSeats(db, "t1")).toBe(5);
  });

  it("treats empty count results as zero", async () => {
    const { countCommittedTrainerSeats } = await import("../trainerSeats");
    const db = makeQueueDb([[], []]) as any; // no rows → 0 + 0
    expect(await countCommittedTrainerSeats(db, "t1")).toBe(0);
  });

  it("scopes both counts to the trainer (render-guard: two-trainer isolation)", async () => {
    const { countCommittedTrainerSeats } = await import("../trainerSeats");
    const capture: Capture = { wheres: [] };
    const db = makeQueueDb([count(0), count(0)], capture) as any;
    await countCommittedTrainerSeats(db, "trainer-A");
    const dialect = new PgDialect();
    const [relsWhere, invitesWhere] = capture.wheres.map(
      (c) => dialect.sqlToQuery(c as never).sql,
    );
    // Relationships count: trainer-scoped, active|pending, non-AI only.
    expect(relsWhere).toContain('"trainer_id"');
    expect(relsWhere).toContain('"status"');
    expect(relsWhere).toContain('"is_ai_trainer"');
    // Pending email invitations: trainer-scoped.
    expect(invitesWhere).toContain('"trainer_id"');
    expect(invitesWhere).toContain('"status"');
  });
});

describe("countActiveTrainerClients (render-guard)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts only active, non-AI relationships for the given trainer", async () => {
    const { countActiveTrainerClients } =
      await import("../../../entitlement/assertEntitlement");
    const capture: Capture = { wheres: [] };
    const db = makeQueueDb([count(4)], capture) as any;
    expect(await countActiveTrainerClients(db, "trainer-A")).toBe(4);
    const where = new PgDialect().sqlToQuery(capture.wheres[0] as never).sql;
    expect(where).toContain('"trainer_id"');
    expect(where).toContain('"status"');
    expect(where).toContain('"is_ai_trainer"');
  });
});

describe("assertTrainerCanInvite (invite-creation gate → EntitlementError/402)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws EntitlementError with the upgrade verdict at the committed cap", async () => {
    const { assertTrainerCanInvite } = await import("../trainerSeats");
    const { EntitlementError } =
      await import("../../../entitlement/assertEntitlement");
    const db = makeQueueDb([
      trainerSub(), // limit 2
      count(1), // active+pending rels = 1
      count(1), // pending invitations = 1 → committed 2 == cap
      SMALL_BIZ_TIER,
    ]) as any;
    await expect(assertTrainerCanInvite("t1", db)).rejects.toBeInstanceOf(
      EntitlementError,
    );
  });

  it("throws for a non-trainer tier", async () => {
    const { assertTrainerCanInvite } = await import("../trainerSeats");
    const { EntitlementError } =
      await import("../../../entitlement/assertEntitlement");
    const db = makeQueueDb([nonTrainerSub(), INDIVIDUAL_TIER]) as any;
    await expect(assertTrainerCanInvite("t1", db)).rejects.toBeInstanceOf(
      EntitlementError,
    );
  });

  it("resolves when the trainer has an open committed seat", async () => {
    const { assertTrainerCanInvite } = await import("../trainerSeats");
    const db = makeQueueDb([
      trainerSub({ trainerClientLimit: 5 }),
      count(1),
      count(1), // committed 2 < 5
    ]) as any;
    await expect(assertTrainerCanInvite("t1", db)).resolves.toBeUndefined();
  });

  it("resolves for an unlimited (NULL-limit) trainer tier without counting", async () => {
    const { assertTrainerCanInvite } = await import("../trainerSeats");
    const db = makeQueueDb([trainerSub({ trainerClientLimit: null })]) as any;
    await expect(assertTrainerCanInvite("t1", db)).resolves.toBeUndefined();
  });
});

describe("evaluateTrainerJoinSeat (invite-code redeem, committed)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows when a committed seat is open", async () => {
    const { evaluateTrainerJoinSeat } = await import("../trainerSeats");
    const db = makeQueueDb([trainerSub(), count(0), count(0)]) as any;
    expect(await evaluateTrainerJoinSeat("t1", db)).toEqual({ allowed: true });
  });

  it("denies at the committed cap (verdict for the client-facing 409 + trainer notify)", async () => {
    const { evaluateTrainerJoinSeat } = await import("../trainerSeats");
    const db = makeQueueDb([
      trainerSub(),
      count(2),
      count(0), // committed 2 == cap
      SMALL_BIZ_TIER,
    ]) as any;
    const v = await evaluateTrainerJoinSeat("t1", db);
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.upgradeTo).toBe("small_business");
  });

  it("denies when the trainer's tier grants no client slots (non-trainer)", async () => {
    const { evaluateTrainerJoinSeat } = await import("../trainerSeats");
    const db = makeQueueDb([nonTrainerSub(), INDIVIDUAL_TIER]) as any;
    const v = await evaluateTrainerJoinSeat("t1", db);
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.reason).toBe("tier");
      expect(v.upgradeTo).toBe("individual_trainer");
    }
  });

  it("allows an unlimited (NULL-limit) trainer tier without counting", async () => {
    const { evaluateTrainerJoinSeat } = await import("../trainerSeats");
    const db = makeQueueDb([trainerSub({ trainerClientLimit: null })]) as any;
    expect(await evaluateTrainerJoinSeat("t1", db)).toEqual({ allowed: true });
  });
});

describe("notifyTrainerClientLimitReached (best-effort)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dispatches the trainer_client_limit_reached notification with the upgrade pointer", async () => {
    const { notifyTrainerClientLimitReached } = await import("../trainerSeats");
    await notifyTrainerClientLimitReached("trainer-A", {
      allowed: false,
      reason: "limit",
      currentTier: "individual_trainer",
      upgradeTo: "small_business",
      upgradePriceMonthly: 49.99,
    });
    expect(createAndDispatch).toHaveBeenCalledWith(
      "trainer-A",
      expect.objectContaining({
        type: "trainer_client_limit_reached",
        data: expect.objectContaining({
          deepLink: "persistencemobile://clients",
          upgrade_to: "small_business",
        }),
      }),
    );
  });

  it("never throws when the dispatch fails", async () => {
    const { notifyTrainerClientLimitReached } = await import("../trainerSeats");
    createAndDispatch.mockRejectedValueOnce(new Error("push boom"));
    await expect(
      notifyTrainerClientLimitReached("trainer-A", null),
    ).resolves.toBeUndefined();
  });
});
