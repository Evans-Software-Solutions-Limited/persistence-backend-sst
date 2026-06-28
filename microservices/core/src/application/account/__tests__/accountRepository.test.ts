/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { AccountRepository } from "../accountRepository";
import { ACCOUNT_DELETION_STEPS } from "../accountDeletionPlan";

const dialect = new PgDialect();

describe("AccountRepository.purgeUserData", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs every deletion step, in plan order, inside a single transaction", async () => {
    const executed: SQL[] = [];
    const tx = { execute: vi.fn(async (stmt: SQL) => void executed.push(stmt)) };
    const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<void>) =>
      cb(tx),
    );
    (getDb as any).mockReturnValue({ transaction });

    await new AccountRepository().purgeUserData("user-9");

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
