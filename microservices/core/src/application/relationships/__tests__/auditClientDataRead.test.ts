/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { clientDataAccessLog } from "@persistence/db";

/** Thenable select builder — resolves to the given row-set. */
function selectChain(rows: unknown[]) {
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.from = vi.fn(self);
  chain.where = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.then = (
    resolve: (v: unknown[]) => unknown,
    reject: (e: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

/**
 * Combined db double: `select(...)` returns `selectRows`; `insert(table)
 * .values(row)` resolves or rejects per `valuesImpl`.
 */
function makeDb(
  selectRows: unknown[],
  valuesImpl: (row: unknown) => Promise<unknown> = () =>
    Promise.resolve(undefined),
) {
  const values = vi.fn(valuesImpl);
  const insert = vi.fn(() => ({ values }));
  const select = vi.fn(() => selectChain(selectRows));
  return { select, insert, values } as any;
}

const ARGS = {
  trainerId: "trainer-1",
  clientId: "client-1",
  dataCategory: "measurements",
  route: "/trainers/me/clients/:clientId/measurements",
};

describe("auditClientDataRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts one row when no recent read exists for this (trainer, client, category)", async () => {
    const db = makeDb([]);
    (getDb as any).mockReturnValue(db);
    const { auditClientDataRead } = await import("../auditClientDataRead");

    await auditClientDataRead(ARGS);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith(clientDataAccessLog);
    expect(db.values).toHaveBeenCalledWith({
      trainerId: "trainer-1",
      clientId: "client-1",
      dataCategory: "measurements",
      route: "/trainers/me/clients/:clientId/measurements",
    });
  });

  it("skips the insert when a read for this category was already logged within the de-dupe window", async () => {
    const db = makeDb([{ id: "existing-row" }]);
    (getDb as any).mockReturnValue(db);
    const { auditClientDataRead } = await import("../auditClientDataRead");

    await auditClientDataRead(ARGS);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("inserts again once the window has elapsed (no recent row returned)", async () => {
    // Simulates the window having passed: the de-dupe SELECT (filtered by
    // `created_at >= since`) no longer matches the earlier row, so it comes
    // back empty and a fresh row is written.
    const db = makeDb([]);
    (getDb as any).mockReturnValue(db);
    const { auditClientDataRead } = await import("../auditClientDataRead");

    await auditClientDataRead(ARGS);

    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("applies the de-dupe window per data_category independently", async () => {
    const db = makeDb([]);
    (getDb as any).mockReturnValue(db);
    const { auditClientDataRead } = await import("../auditClientDataRead");

    await auditClientDataRead({
      ...ARGS,
      dataCategory: "client_detail_aggregate",
    });

    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ dataCategory: "client_detail_aggregate" }),
    );
  });

  it("NEVER throws when the insert fails (best-effort)", async () => {
    const db = makeDb([], () => Promise.reject(new Error("insert failed")));
    (getDb as any).mockReturnValue(db);
    const { auditClientDataRead } = await import("../auditClientDataRead");

    await expect(auditClientDataRead(ARGS)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("NEVER throws when the de-dupe SELECT itself fails (best-effort)", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn(() => {
        throw new Error("select failed");
      }),
      insert: vi.fn(),
    });
    const { auditClientDataRead } = await import("../auditClientDataRead");

    await expect(auditClientDataRead(ARGS)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("exports a tunable DEDUPE_WINDOW_MINUTES config constant", async () => {
    const { DEDUPE_WINDOW_MINUTES } = await import("../auditClientDataRead");
    expect(DEDUPE_WINDOW_MINUTES).toBe(15);
  });
});
