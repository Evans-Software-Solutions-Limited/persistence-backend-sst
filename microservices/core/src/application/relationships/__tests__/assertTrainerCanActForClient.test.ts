/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../assertTrainerCanActForClient";

/**
 * The helper runs at most two SELECTs, each ultimately resolving via
 * `.limit()`:
 *   1. profiles.role read — `select().from().where().limit()` (always)
 *   2. pt_client_relationships INNER JOIN profiles read (Cluster 2a: the
 *      client's `deleted_at` is now joined in the same round-trip) —
 *      `select().from().innerJoin().where().limit()` (only if the role
 *      check passed). `innerJoin` is a passthrough on this mock so the
 *      first (role) query, which never calls it, is unaffected.
 * Tests stage the row-sets in call order via `makeQueueDb`.
 */
function makeChainResolving(rows: unknown) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ where, innerJoin });
  return { from };
}

function makeQueueDb(queue: unknown[][]) {
  const select = vi.fn(() => {
    if (queue.length === 0) {
      throw new Error(
        "test stub exhausted: more SELECTs ran than the test queued",
      );
    }
    return makeChainResolving(queue.shift());
  });
  return { select, __queue: queue };
}

const TRAINER = "trainer-1";
const CLIENT = "client-1";
const ACTIVE_REL = [{ id: "rel-1", clientDeletedAt: null }];
const NO_REL: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertTrainerCanActForClient", () => {
  it("allows an active, non-AI relationship for a personal_trainer", async () => {
    const db = makeQueueDb([[{ role: "personal_trainer" }], ACTIVE_REL]);
    (getDb as any).mockReturnValue(db);

    const v = await assertTrainerCanActForClient(TRAINER, CLIENT);

    expect(v).toEqual({ allowed: true });
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("allows a physiotherapist", async () => {
    const db = makeQueueDb([[{ role: "physiotherapist" }], ACTIVE_REL]);
    (getDb as any).mockReturnValue(db);

    expect(await assertTrainerCanActForClient(TRAINER, CLIENT)).toEqual({
      allowed: true,
    });
  });

  it("allows an admin acting as a trainer", async () => {
    const db = makeQueueDb([[{ role: "admin" }], ACTIVE_REL]);
    (getDb as any).mockReturnValue(db);

    expect(await assertTrainerCanActForClient(TRAINER, CLIENT)).toEqual({
      allowed: true,
    });
  });

  it("denies wrong_role for a plain user and never reads the relationship", async () => {
    const db = makeQueueDb([[{ role: "user" }]]);
    (getDb as any).mockReturnValue(db);

    const v = await assertTrainerCanActForClient(TRAINER, CLIENT);

    expect(v).toMatchObject({
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer" },
    });
    // Role check short-circuits BEFORE the relationship read (cross-cuts § 1.3).
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("denies wrong_role when the profile row is missing", async () => {
    const db = makeQueueDb([[]]);
    (getDb as any).mockReturnValue(db);

    const v = await assertTrainerCanActForClient(TRAINER, CLIENT);

    expect(v).toMatchObject({ allowed: false, reason: "wrong_role" });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("denies trainer_deleted when the acting coach is themselves soft-deleted (Cluster 2a), before reading the relationship", async () => {
    const db = makeQueueDb([
      [
        {
          role: "personal_trainer",
          deletedAt: new Date("2026-07-13T00:00:00Z"),
        },
      ],
    ]);
    (getDb as any).mockReturnValue(db);

    const v = await assertTrainerCanActForClient(TRAINER, CLIENT);

    expect(v).toMatchObject({
      allowed: false,
      reason: "trainer_deleted",
      status: 403,
      body: { code: "account_deleted" },
    });
    // Denied at the role read (which already loads the caller's profile) —
    // the relationship query never runs.
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("denies no_relationship when a trainer has no active relationship with the client", async () => {
    const db = makeQueueDb([[{ role: "personal_trainer" }], NO_REL]);
    (getDb as any).mockReturnValue(db);

    const v = await assertTrainerCanActForClient(TRAINER, CLIENT);

    expect(v).toMatchObject({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client" },
    });
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it("denies client_deleted when the client is soft-deleted (Cluster 2a — hide from coach immediately), even with an active relationship row", async () => {
    const db = makeQueueDb([
      [{ role: "personal_trainer" }],
      [{ id: "rel-1", clientDeletedAt: new Date("2026-07-13T00:00:00Z") }],
    ]);
    (getDb as any).mockReturnValue(db);

    const v = await assertTrainerCanActForClient(TRAINER, CLIENT);

    expect(v).toMatchObject({
      allowed: false,
      reason: "client_deleted",
      status: 403,
      // Same wire body as no_relationship — never disclose to the coach
      // that the specific reason is the client's account being deleted.
      body: { code: "not_your_client" },
    });
  });
});
