/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../assertTrainerCanActForClient";

/**
 * The helper runs at most two SELECTs, each of shape
 * `select().from().where().limit()`:
 *   1. profiles.role read (always)
 *   2. pt_client_relationships read (only if the role check passed)
 * Tests stage the row-sets in call order via `makeQueueDb`.
 */
function makeChainResolving(rows: unknown) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
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
const ACTIVE_REL = [{ id: "rel-1" }];
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
});
