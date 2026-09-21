/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import { AiUsageLogRepository } from "../aiUsageLogRepository";

describe("AiUsageLogRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a usage-log row with the given fields", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values });
    (getDb as any).mockReturnValue({ insert });

    const repo = new AiUsageLogRepository();
    await repo.record({
      userId: "user-1",
      endpoint: "/nutrition/ai/estimate",
      requestSizeBytes: 1200,
      responseSizeBytes: 340,
      ms: 890,
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({
      userId: "user-1",
      endpoint: "/nutrition/ai/estimate",
      requestSizeBytes: 1200,
      responseSizeBytes: 340,
      ms: 890,
    });
  });

  it("accepts null request/response/ms fields (failure-path telemetry)", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values });
    (getDb as any).mockReturnValue({ insert });

    const repo = new AiUsageLogRepository();
    await repo.record({
      userId: "user-1",
      endpoint: "/nutrition/ai/estimate-text",
      requestSizeBytes: null,
      responseSizeBytes: null,
      ms: null,
    });

    expect(values).toHaveBeenCalledWith({
      userId: "user-1",
      endpoint: "/nutrition/ai/estimate-text",
      requestSizeBytes: null,
      responseSizeBytes: null,
      ms: null,
    });
  });

  it("countForUserToday counts rows for the user+endpoint since UTC midnight", async () => {
    const where = vi.fn().mockResolvedValue([{ n: 7 }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    (getDb as any).mockReturnValue({ select });

    const repo = new AiUsageLogRepository();
    const n = await repo.countForUserToday("user-1", "/nutrition/ai/estimate");

    expect(n).toBe(7);
    expect(select).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("countForUserToday returns 0 when no rows exist", async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    (getDb as any).mockReturnValue({ select });

    const repo = new AiUsageLogRepository();
    const n = await repo.countForUserToday("user-1", "/nutrition/ai/estimate");

    expect(n).toBe(0);
  });
});

// Query inspection verifies the real SQL scope, while the lock-aware fake below
// exercises concurrent callers without pretending to test PostgreSQL itself.
import { PgDialect } from "drizzle-orm/pg-core";
const dialect = new PgDialect();

describe("reserveForUserToday", () => {
  const input = {
    userId: "user-1",
    endpoint: "/recipes/import",
    limit: 2,
    requestSizeBytes: 400,
  };
  beforeEach(() => vi.clearAllMocks());

  function setup(n = 0) {
    const execute = vi.fn().mockResolvedValue(undefined);
    const where = vi.fn().mockResolvedValue([{ n }]);
    const values = vi.fn().mockResolvedValue(undefined);
    const tx = {
      execute,
      select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
      insert: vi.fn(() => ({ values })),
    };
    const transaction = vi.fn(async (run: any) => run(tx));
    vi.mocked(getDb).mockReturnValue({ transaction } as any);
    return { tx, transaction, execute, where, values };
  }

  it("locks before counting and inserts the reservation inside the transaction", async () => {
    const { execute, where, values, transaction } = setup(1);
    expect(await new AiUsageLogRepository().reserveForUserToday(input)).toBe(
      true,
    );
    expect(transaction).toHaveBeenCalledOnce();
    const lock = dialect.sqlToQuery(execute.mock.calls[0][0]);
    expect(lock.sql).toContain(
      "pg_advisory_xact_lock(hashtextextended($1, 0))",
    );
    expect(lock.params).toEqual([
      JSON.stringify(["ai-usage", "user-1", "/recipes/import"]),
    ]);
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(
      where.mock.invocationCallOrder[0],
    );
    expect(where.mock.invocationCallOrder[0]).toBeLessThan(
      values.mock.invocationCallOrder[0],
    );
    expect(values).toHaveBeenCalledWith({
      userId: input.userId,
      endpoint: input.endpoint,
      requestSizeBytes: 400,
      responseSizeBytes: null,
      ms: null,
      createdAt: expect.any(Date),
    });
    const createdAt = values.mock.calls[0][0].createdAt;
    const start = new Date(createdAt);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const query = dialect.sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('"ai_usage_log"."created_at" >=');
    expect(query.sql).toContain('"ai_usage_log"."created_at" <');
    expect(query.params).toEqual([
      input.userId,
      input.endpoint,
      start.toISOString(),
      end.toISOString(),
    ]);
  });

  it.each([2, 3])("does not insert when existing count is %s", async (n) => {
    const { values } = setup(n);
    expect(await new AiUsageLogRepository().reserveForUserToday(input)).toBe(
      false,
    );
    expect(values).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Infinity, NaN])(
    "fails closed for invalid limit %s",
    async (limit) => {
      const { transaction } = setup();
      expect(
        await new AiUsageLogRepository().reserveForUserToday({
          ...input,
          limit,
        }),
      ).toBe(false);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("accepts an empty count result and null request size", async () => {
    const { where, values } = setup();
    where.mockResolvedValue([]);
    expect(
      await new AiUsageLogRepository().reserveForUserToday({
        ...input,
        requestSizeBytes: null,
      }),
    ).toBe(true);
    expect(values.mock.calls[0][0].requestSizeBytes).toBeNull();
  });

  it.each(["lock", "count", "insert"])(
    "propagates %s failures rather than allowing an inference",
    async (stage) => {
      const { execute, where, values } = setup();
      ({ lock: execute, count: where, insert: values })[
        stage
      ]!.mockRejectedValueOnce(new Error("database unavailable"));
      await expect(
        new AiUsageLogRepository().reserveForUserToday(input),
      ).rejects.toThrow("database unavailable");
      if (stage !== "insert") expect(values).not.toHaveBeenCalled();
    },
  );

  it("serializes simultaneous attempts for the last available slot", async () => {
    let tail = Promise.resolve();
    let stored = 1;
    const events: string[] = [];
    vi.mocked(getDb).mockReturnValue({
      transaction: async (run: any) => {
        let release = () => {};
        const tx = {
          execute: async () => {
            const previous = tail;
            tail = new Promise<void>((resolve) => {
              release = resolve;
            });
            await previous;
            events.push("lock");
          },
          select: () => ({
            from: () => ({
              where: async () => {
                events.push("count");
                return [{ n: stored }];
              },
            }),
          }),
          insert: () => ({
            values: async () => {
              events.push("insert");
              stored += 1;
            },
          }),
        };
        try {
          return await run(tx);
        } finally {
          events.push("commit");
          release();
        }
      },
    } as any);
    const repo = new AiUsageLogRepository();
    expect(
      await Promise.all([
        repo.reserveForUserToday(input),
        repo.reserveForUserToday(input),
      ]),
    ).toEqual([true, false]);
    expect(stored).toBe(2);
    expect(events).toEqual([
      "lock",
      "count",
      "insert",
      "commit",
      "lock",
      "count",
      "commit",
    ]);
  });
});
