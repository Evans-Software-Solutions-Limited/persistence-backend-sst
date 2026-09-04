/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { AdminAuditRepository } from "../adminAuditRepository";

function selectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ limit, orderBy });
  const from = vi.fn().mockReturnValue({ where });
  return { select: vi.fn().mockReturnValue({ from }), where, limit };
}

describe("AdminAuditRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks whether an action/entity audit row exists", async () => {
    const db = selectChain([{ id: "audit-1" }]);
    (getDb as any).mockReturnValue(db);
    const repo = new AdminAuditRepository();

    expect(
      await repo.exists({
        action: "founding_grant.apply_deferred",
        entityId: "g1",
      }),
    ).toBe(true);
    expect(db.where).toHaveBeenCalledOnce();

    db.limit.mockResolvedValueOnce([]);
    expect(
      await repo.exists({
        action: "founding_grant.apply_deferred",
        entityId: "g2",
      }),
    ).toBe(false);
  });

  it("records defaults through the shared database and accepts a transaction", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = { insert: vi.fn().mockReturnValue({ values }) };
    (getDb as any).mockReturnValue(db);
    const repo = new AdminAuditRepository();

    await repo.record({
      actorId: "admin-1",
      action: "test",
      entityType: "founding_grant",
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: null,
        before: null,
        after: null,
        reason: null,
      }),
    );

    const txValues = vi.fn().mockResolvedValue(undefined);
    const transaction = {
      insert: vi.fn().mockReturnValue({ values: txValues }),
    };
    await repo.record(
      {
        actorId: "admin-1",
        action: "test-full",
        entityType: "founding_grant",
        entityId: "g1",
        before: { state: "before" },
        after: { state: "after" },
        reason: "reason",
      },
      transaction as any,
    );
    expect(txValues).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "g1", reason: "reason" }),
    );
  });

  it("records once with an atomic conflict-ignore insert", async () => {
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const db = { insert: vi.fn().mockReturnValue({ values }) };
    (getDb as any).mockReturnValue(db);

    await new AdminAuditRepository().recordOnce({
      actorId: "admin-1",
      action: "founding_grant.apply_deferred",
      entityType: "founding_grant",
      entityId: "g1",
      after: { userId: "u1" },
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "founding_grant.apply_deferred",
        entityId: "g1",
      }),
    );
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
  });

  it("lists without filters using defaults and bounds a filtered limit", async () => {
    const db = selectChain([{ id: "audit-1" }]);
    (getDb as any).mockReturnValue(db);
    const repo = new AdminAuditRepository();

    expect(await repo.list({})).toEqual([{ id: "audit-1" }]);
    expect(db.where).toHaveBeenLastCalledWith(undefined);
    expect(db.limit).toHaveBeenLastCalledWith(100);

    await repo.list({
      entityType: "founding_grant",
      entityId: "g1",
      limit: 900,
    });
    expect(db.where).not.toHaveBeenLastCalledWith(undefined);
    expect(db.limit).toHaveBeenLastCalledWith(500);

    await repo.list({ entityType: "founding_grant", limit: 10 });
    await repo.list({ entityId: "g1", limit: 10 });
    expect(db.limit).toHaveBeenLastCalledWith(10);
  });
});
