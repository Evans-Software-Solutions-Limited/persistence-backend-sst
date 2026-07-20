/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { userSubscriptions } from "@persistence/db";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeUpdateChain(resolved: unknown) {
  const returning = vi.fn().mockResolvedValue(resolved);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { chain: { set }, set, where, returning };
}

function makeUpsertChain(resolved: unknown) {
  const returning = vi.fn().mockResolvedValue(resolved);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  return { chain: { insert }, insert, values, onConflictDoUpdate, returning };
}

describe("SubscriptionRepository.cancelLiveSubscriptions (M12 RevenueCat sync)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels live rows and returns the count cancelled", async () => {
    const update = makeUpdateChain([{ id: "a" }, { id: "b" }]);
    (getDb as any).mockReturnValue({
      update: vi.fn().mockReturnValue(update.chain),
    });

    const { SubscriptionRepository } =
      await import("../subscriptionRepository");
    const count = await new SubscriptionRepository().cancelLiveSubscriptions(
      "user-1",
    );

    expect(count).toBe(2);
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({ paymentStatus: "cancelled" }),
    );
  });

  it("returns 0 when the user has no live rows", async () => {
    const update = makeUpdateChain([]);
    (getDb as any).mockReturnValue({
      update: vi.fn().mockReturnValue(update.chain),
    });

    const { SubscriptionRepository } =
      await import("../subscriptionRepository");
    const count = await new SubscriptionRepository().cancelLiveSubscriptions(
      "user-1",
    );
    expect(count).toBe(0);
  });
});

describe("SubscriptionRepository.upsertByExternalId (spec-12.13 atomic upsert)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts with the given values and updates only the mutable fields on conflict", async () => {
    const row = { id: "us1", externalSubscriptionId: "rc_user-1" };
    const upsert = makeUpsertChain([row]);
    (getDb as any).mockReturnValue({
      insert: vi.fn().mockReturnValue(upsert.chain.insert()),
    });

    const { SubscriptionRepository } =
      await import("../subscriptionRepository");
    const result = await new SubscriptionRepository().upsertByExternalId({
      userId: "user-1",
      tierName: "premium",
      paymentStatus: "active",
      billingCycle: "monthly",
      externalSubscriptionId: "rc_user-1",
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      metadata: { source: "revenuecat" },
    });

    expect(result).toEqual(row);
    // Full desired row is inserted…
    expect(upsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        externalSubscriptionId: "rc_user-1",
        startsAt: expect.any(Date),
      }),
    );
    // …but the DO UPDATE set touches only entitlement fields — never user_id
    // or starts_at (the conflicting row is the same subscription).
    const conflictArg = upsert.onConflictDoUpdate.mock.calls[0][0];
    expect(conflictArg.target).toBe(userSubscriptions.externalSubscriptionId);
    // The partial predicate MUST be passed so Postgres infers
    // `user_subscriptions_external_id_unique` (not error on an ambiguous
    // target). Rendering it proves it matches the index's WHERE clause; this
    // guards against someone dropping targetWhere or editing the predicate.
    expect(conflictArg.targetWhere).toBeDefined();
    const renderedWhere = new PgDialect()
      .sqlToQuery(conflictArg.targetWhere)
      .sql.toLowerCase();
    expect(renderedWhere).toContain('"external_subscription_id" is not null');
    expect(Object.keys(conflictArg.set).sort()).toEqual([
      "billingCycle",
      "cancelledAt",
      "expiresAt",
      "metadata",
      "paymentStatus",
      "tierName",
      "updatedAt",
    ]);
    expect(conflictArg.set).not.toHaveProperty("userId");
    expect(conflictArg.set).not.toHaveProperty("startsAt");
  });

  it("throws (and never touches the DB) when externalSubscriptionId is empty", async () => {
    const getDbMock = getDb as any;
    const { SubscriptionRepository } =
      await import("../subscriptionRepository");

    await expect(
      new SubscriptionRepository().upsertByExternalId({
        userId: "user-1",
        tierName: "premium",
        externalSubscriptionId: "",
        startsAt: new Date(),
      }),
    ).rejects.toThrow(/non-null externalSubscriptionId/);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("throws when the upsert returns no row", async () => {
    const upsert = makeUpsertChain([]);
    (getDb as any).mockReturnValue({
      insert: vi.fn().mockReturnValue(upsert.chain.insert()),
    });

    const { SubscriptionRepository } =
      await import("../subscriptionRepository");
    await expect(
      new SubscriptionRepository().upsertByExternalId({
        userId: "user-1",
        tierName: "premium",
        externalSubscriptionId: "rc_user-1",
        startsAt: new Date(),
      }),
    ).rejects.toThrow(/returned no rows/);
  });
});

describe("upsert SQL renders the partial-unique conflict target (PgDialect)", () => {
  // The unit suite mocks getDb, so a chain mock can't prove the emitted SQL is
  // correct (see the Drizzle GROUP-BY lesson). Render the real statement via a
  // connection-less drizzle instance and assert the ON CONFLICT target + the
  // partial predicate that must match `user_subscriptions_external_id_unique`.
  it("emits ON CONFLICT (external_subscription_id) WHERE ... IS NOT NULL DO UPDATE", () => {
    const renderDb = drizzle.mock();
    const query = renderDb
      .insert(userSubscriptions)
      .values({
        userId: "user-1",
        tierName: "premium",
        paymentStatus: "active",
        externalSubscriptionId: "rc_user-1",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .onConflictDoUpdate({
        target: userSubscriptions.externalSubscriptionId,
        targetWhere: sql`${userSubscriptions.externalSubscriptionId} IS NOT NULL`,
        set: { paymentStatus: "active", updatedAt: new Date() },
      });

    const rendered = query.toSQL().sql.toLowerCase();
    expect(rendered).toContain("on conflict");
    expect(rendered).toContain('"external_subscription_id"');
    expect(rendered).toContain("is not null");
    expect(rendered).toContain("do update set");
  });
});
