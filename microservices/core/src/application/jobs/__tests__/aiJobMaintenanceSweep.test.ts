import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  aiJobMaintenanceSweep,
  JOB_RETENTION_DAYS,
} from "../aiJobMaintenanceSweep";

const NOW = new Date("2026-08-02T05:00:00.000Z");

describe("aiJobMaintenanceSweep", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("reaps stale jobs and purges terminal ones past retention", async () => {
    const repo = {
      markStaleRunning: vi.fn().mockResolvedValue(2),
      purgeTerminalOlderThan: vi.fn().mockResolvedValue(7),
    };

    const summary = await aiJobMaintenanceSweep({ repo, now: NOW });

    expect(summary).toEqual({ staleReaped: 2, purged: 7, failed: 0 });
    expect(repo.purgeTerminalOlderThan).toHaveBeenCalledWith(
      new Date(NOW.getTime() - JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    );
  });

  it("reaps BEFORE purging, so a job reaped this run is purgeable on a later one", async () => {
    // The other order leaves every reaped job waiting a further 30 days for the
    // next sweep to notice it.
    const order: string[] = [];
    const repo = {
      markStaleRunning: vi.fn(async () => {
        order.push("reap");
        return 1;
      }),
      purgeTerminalOlderThan: vi.fn(async () => {
        order.push("purge");
        return 1;
      }),
    };

    await aiJobMaintenanceSweep({ repo, now: NOW });

    expect(order).toEqual(["reap", "purge"]);
  });

  it("a failed reap does not stop the purge — the steps are independent", async () => {
    const repo = {
      markStaleRunning: vi.fn().mockRejectedValue(new Error("boom")),
      purgeTerminalOlderThan: vi.fn().mockResolvedValue(3),
    };

    const summary = await aiJobMaintenanceSweep({ repo, now: NOW });

    expect(summary).toEqual({ staleReaped: 0, purged: 3, failed: 1 });
  });

  it("a failed purge is counted, not thrown", async () => {
    const repo = {
      markStaleRunning: vi.fn().mockResolvedValue(1),
      purgeTerminalOlderThan: vi.fn().mockRejectedValue(new Error("boom")),
    };

    const summary = await aiJobMaintenanceSweep({ repo, now: NOW });

    expect(summary).toEqual({ staleReaped: 1, purged: 0, failed: 1 });
  });

  it("both failing still returns a summary rather than aborting the cron", async () => {
    // Reaping is only the PERSISTENCE of staleness — `GET /jobs/:id` derives the
    // same verdict on read, so a broken sweep degrades table hygiene, not
    // correctness. That is why nothing here propagates.
    const repo = {
      markStaleRunning: vi.fn().mockRejectedValue(new Error("a")),
      purgeTerminalOlderThan: vi.fn().mockRejectedValue(new Error("b")),
    };

    expect(await aiJobMaintenanceSweep({ repo, now: NOW })).toEqual({
      staleReaped: 0,
      purged: 0,
      failed: 2,
    });
  });
});
