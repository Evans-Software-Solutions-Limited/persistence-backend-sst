/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

// The post-commit tombstone re-stamp (PER-108); its SQL is covered against
// PGlite in coaching/__tests__/coaching.integration.test.ts.
const restampTombstones = vi.fn<(ids: string[]) => Promise<void>>(
  async () => {},
);
vi.mock("../../coaching/clientProfileRepository", async (original) => ({
  ...(await original<object>()),
  ClientProfileRepository: class {
    restampTombstones = restampTombstones;
  },
}));

import { getDb } from "@persistence/db/client";
import {
  AccountRepository,
  SOFT_DELETE_GRACE_PERIOD_MS,
} from "../accountRepository";
import { ACCOUNT_DELETION_STEPS } from "../accountDeletionPlan";
import { profiles, userDevices } from "@persistence/db";

const dialect = new PgDialect();

function renderCondition(condition: unknown): string {
  return dialect.sqlToQuery(condition as SQL).sql;
}

describe("AccountRepository.purgeUserData", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * Build a mock tx whose gating `select(...).for("update")` returns
   * `gateRows` (default: one row = still soft-deleted → purge proceeds).
   * Pass `[]` to simulate a restore having cleared `deleted_at` mid-sweep,
   * so the purge must abort and delete nothing.
   */
  function makeTx(
    executed: SQL[],
    gateRows: Array<{ id: string }> = [{ id: "x" }],
  ) {
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn(async () => gateRows),
          })),
        })),
      })),
      execute: vi.fn(async (stmt: SQL) => void executed.push(stmt)),
    };
  }

  it("runs every deletion step, in plan order, inside a single transaction", async () => {
    const executed: SQL[] = [];
    const tx = makeTx(executed);
    const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) =>
      cb(tx),
    );
    (getDb as any).mockReturnValue({ transaction });

    expect(await new AccountRepository().purgeUserData("user-9")).toBe(true);

    // One transaction, one execute per plan step.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(ACCOUNT_DELETION_STEPS.length);

    // Rendered SQL matches the plan, in order — and the last statement is the
    // profile delete that triggers the cascade.
    const renderedTables = executed.map((stmt) => {
      const { sql } = dialect.sqlToQuery(stmt);
      return sql.match(/"([a-z_]+)"/)?.[1];
    });
    expect(renderedTables).toEqual(ACCOUNT_DELETION_STEPS.map((s) => s.table));
    expect(dialect.sqlToQuery(executed[executed.length - 1]!).sql).toContain(
      '"profiles"',
    );
  });

  it("re-stamps the coach-profile tombstones AFTER the purge transaction commits (PER-108)", async () => {
    const executed: SQL[] = [];
    const order: string[] = [];
    const tx = makeTx(executed);
    // postgres.js returns an array of rows from `execute`.
    tx.execute = vi.fn(async (stmt: SQL) => {
      executed.push(stmt);
      return dialect.sqlToQuery(stmt).sql.includes('"coach_client_profiles"')
        ? ([{ id: "p-1" }, { id: "p-2" }] as never)
        : (undefined as never);
    });
    const transaction = vi.fn(
      async (cb: (t: typeof tx) => Promise<unknown>) => {
        await cb(tx);
        order.push("commit");
      },
    );
    restampTombstones.mockImplementationOnce(async () => {
      order.push("restamp");
    });
    (getDb as any).mockReturnValue({ transaction });

    await new AccountRepository().purgeUserData("athlete-1");

    expect(restampTombstones).toHaveBeenCalledWith(["p-1", "p-2"]);
    expect(order).toEqual(["commit", "restamp"]);
  });

  it("reads PGlite-shaped { rows } results too, and nothing to re-stamp means no call", async () => {
    const executed: SQL[] = [];
    const tx = makeTx(executed);
    tx.execute = vi.fn(async (stmt: SQL) => {
      executed.push(stmt);
      return dialect.sqlToQuery(stmt).sql.includes('"coach_client_profiles"')
        ? ({ rows: [{ id: "p-9" }, { id: 7 }] } as never)
        : ({ rows: [] } as never);
    });
    (getDb as any).mockReturnValue({
      transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    });
    await new AccountRepository().purgeUserData("athlete-2");
    expect(restampTombstones).toHaveBeenCalledWith(["p-9"]);

    restampTombstones.mockClear();
    const quiet = makeTx([]);
    (getDb as any).mockReturnValue({
      transaction: vi.fn(async (cb: (t: typeof quiet) => Promise<void>) =>
        cb(quiet),
      ),
    });
    await new AccountRepository().purgeUserData("athlete-3");
    expect(restampTombstones).not.toHaveBeenCalled();
  });

  it("a failed re-stamp doesn't fail the purge, which has already committed", async () => {
    const tx = makeTx([]);
    tx.execute = vi.fn(async (stmt: SQL) =>
      dialect.sqlToQuery(stmt).sql.includes('"coach_client_profiles"')
        ? ([{ id: "p-1" }] as never)
        : (undefined as never),
    );
    (getDb as any).mockReturnValue({
      transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    });
    restampTombstones.mockRejectedValueOnce(new Error("db blip"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      new AccountRepository().purgeUserData("athlete-4"),
    ).resolves.toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("handles a Coach-Mode user (trainer_actions_audit + client_ai_summaries rows on both sides) without relying on any FK to auto-cascade — every NO-ACTION table is explicitly deleted before profiles", async () => {
    // Fixture: the deleting user is a coach with audit/summary rows as the
    // TRAINER party, and also (implausible in practice, but the plan must
    // not assume mutual exclusivity) rows as the CLIENT party from some
    // other coach. Both trainer_actions_audit and client_ai_summaries carry
    // NOT NULL/NO ACTION FKs on trainer_id AND client_id (migrations
    // 20260705140000 / 20260708130000) — pre-fix, deleting this user's
    // profile would 500 with a foreign-key violation because neither table
    // appeared in ACCOUNT_DELETION_STEPS at all.
    const executed: SQL[] = [];
    const tx = makeTx(executed);
    const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) =>
      cb(tx),
    );
    (getDb as any).mockReturnValue({ transaction });

    await new AccountRepository().purgeUserData("coach-user-1");

    const rendered = executed.map((stmt) => dialect.sqlToQuery(stmt).sql);

    // Both NO-ACTION audit/summary tables are hit on BOTH FK columns —
    // covers the coach-as-trainer AND coach-as-client shapes in one pass.
    expect(
      rendered.some((sql) =>
        sql.includes('delete from "trainer_actions_audit" where "trainer_id"'),
      ),
    ).toBe(true);
    expect(
      rendered.some((sql) =>
        sql.includes('delete from "trainer_actions_audit" where "client_id"'),
      ),
    ).toBe(true);
    expect(
      rendered.some((sql) =>
        sql.includes('delete from "client_ai_summaries" where "trainer_id"'),
      ),
    ).toBe(true);
    expect(
      rendered.some((sql) =>
        sql.includes('delete from "client_ai_summaries" where "client_id"'),
      ),
    ).toBe(true);

    // profiles is still the LAST statement — the NO-ACTION cleanup above
    // committed first, so the cascade-triggering delete never hits a
    // dangling reference.
    expect(rendered[rendered.length - 1]).toContain('"profiles"');

    // No FK violation ever reaches the transaction (this mock has no real
    // constraints — the point is that every step for a Coach-Mode user is
    // present and profiles is unconditionally last).
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("aborts and deletes NOTHING when the account is no longer soft-deleted (restore won the race with the nightly sweep)", async () => {
    // The gating `select ... for update` returns zero rows — i.e. restore()
    // cleared deleted_at (committing first under the same row lock) between
    // listPendingPurge's snapshot and this per-user purge. The purge must
    // run NO deletion steps, so the restored account survives intact.
    const executed: SQL[] = [];
    const tx = makeTx(executed, []);
    const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) =>
      cb(tx),
    );
    (getDb as any).mockReturnValue({ transaction });

    // PER-121 / Inspector Brad #553: reports that nothing was purged, so
    // the cron skips the auth-user delete.
    expect(await new AccountRepository().purgeUserData("restored-user")).toBe(
      false,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(tx.execute).not.toHaveBeenCalled();
    expect(executed).toEqual([]);
  });

  it("propagates a transaction failure (atomic — rollback, no half-delete)", async () => {
    const boom = new Error("constraint blocked");
    const transaction = vi.fn(async () => {
      throw boom;
    });
    (getDb as any).mockReturnValue({ transaction });

    await expect(new AccountRepository().purgeUserData("user-9")).rejects.toBe(
      boom,
    );
  });
});

describe("AccountRepository.softDelete", () => {
  beforeEach(() => vi.clearAllMocks());

  /** Mock db whose transaction records each `tx.update(table).set().where()`. */
  function makeDb() {
    const updates: Array<{
      table: unknown;
      values: Record<string, unknown>;
      where: unknown;
    }> = [];
    const tx = {
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Record<string, unknown>) => ({
          where: vi.fn(async (where: unknown) => {
            updates.push({ table, values, where });
          }),
        })),
      })),
    };
    const transaction = vi.fn(async (fn: (t: typeof tx) => Promise<void>) =>
      fn(tx),
    );
    (getDb as any).mockReturnValue({ transaction });
    return { updates, transaction };
  }

  it("stamps deleted_at = now and purge_after = now + 30 days, scoped to the caller's id, and returns purgeAfter", async () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    const { updates, transaction } = makeDb();

    const purgeAfter = await new AccountRepository().softDelete("user-42", now);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(purgeAfter.getTime()).toBe(
      now.getTime() + SOFT_DELETE_GRACE_PERIOD_MS,
    );
    expect(purgeAfter.toISOString()).toBe("2026-08-12T12:00:00.000Z");
    const profile = updates.find((u) => u.table === profiles)!;
    expect(profile.values).toEqual({
      deletedAt: now,
      purgeAfter,
      updatedAt: now,
    });
    const q = dialect.sqlToQuery(profile.where as SQL);
    expect(q.sql).toBe('"profiles"."id" = $1');
    expect(q.params).toEqual(["user-42"]);
  });

  it("deactivates every device push token of the caller, in the same transaction", async () => {
    // A soft-deleted account must stop pushing to its phones for the whole
    // 30-day window — the dispatcher doesn't check deleted_at.
    const now = new Date("2026-07-13T12:00:00.000Z");
    const { updates } = makeDb();

    await new AccountRepository().softDelete("user-42", now);

    expect(updates.map((u) => u.table)).toEqual([profiles, userDevices]);
    const devices = updates[1]!;
    expect(devices.values).toEqual({ isActive: false, updatedAt: now });
    const q = dialect.sqlToQuery(devices.where as SQL);
    expect(q.sql).toBe('"user_devices"."user_id" = $1');
    expect(q.params).toEqual(["user-42"]);
  });

  it("defaults to the current time when `now` is omitted", async () => {
    const { updates } = makeDb();

    const before = Date.now();
    await new AccountRepository().softDelete("user-42");
    const after = Date.now();

    const stamped = updates[0]!.values as unknown as { deletedAt: Date };
    expect(stamped.deletedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(stamped.deletedAt.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("AccountRepository.restore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears deleted_at/purge_after and returns 'restored' when a row matched (currently soft-deleted)", async () => {
    let capturedWhere: unknown;
    const returning = vi.fn(async () => [{ id: "user-42" }]);
    const where = vi.fn((cond: unknown) => {
      capturedWhere = cond;
      return { returning };
    });
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    (getDb as any).mockReturnValue({ update });

    const result = await new AccountRepository().restore("user-42");

    expect(result).toBe("restored");
    // Scoped to id = userId AND deleted_at IS NOT NULL — an already-active
    // account (deleted_at already NULL) must not match.
    const rendered = renderCondition(capturedWhere);
    expect(rendered).toContain("is not null");
  });

  it("returns 'not_deleted' (no-op) when the account was never soft-deleted", async () => {
    const returning = vi.fn(async () => []);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    (getDb as any).mockReturnValue({ update });

    const result = await new AccountRepository().restore("user-42");
    expect(result).toBe("not_deleted");
  });
});

describe("AccountRepository.listPendingPurge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("selects ids where deleted_at IS NOT NULL AND purge_after <= now", async () => {
    const now = new Date("2026-08-12T00:00:00.000Z");
    let capturedWhere: unknown;
    const where = vi.fn(async (cond: unknown) => {
      capturedWhere = cond;
      return [{ id: "user-a" }, { id: "user-b" }];
    });
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    (getDb as any).mockReturnValue({ select });

    const ids = await new AccountRepository().listPendingPurge(now);

    expect(ids).toEqual(["user-a", "user-b"]);
    const rendered = renderCondition(capturedWhere);
    expect(rendered).toContain("is not null");
    expect(rendered).toContain("<= $1");
  });

  it("returns an empty array when nothing is due", async () => {
    const where = vi.fn(async () => []);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    (getDb as any).mockReturnValue({ select });

    const ids = await new AccountRepository().listPendingPurge(new Date());
    expect(ids).toEqual([]);
  });
});
