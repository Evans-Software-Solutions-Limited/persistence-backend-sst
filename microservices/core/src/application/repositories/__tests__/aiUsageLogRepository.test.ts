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
