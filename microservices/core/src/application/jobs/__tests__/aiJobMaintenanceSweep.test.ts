import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  aiJobMaintenanceSweep,
  JOB_RETENTION_DAYS,
} from "../aiJobMaintenanceSweep";

const NOW = new Date("2026-08-02T05:00:00.000Z");

function makeRepo(
  overrides: Partial<{
    markStaleRunning: () => Promise<number>;
    markStaleQueued: () => Promise<number>;
    purgeTerminalOlderThan: (cutoff: Date) => Promise<number>;
  }> = {},
) {
  return {
    markStaleRunning: vi.fn(overrides.markStaleRunning ?? (async () => 0)),
    markStaleQueued: vi.fn(overrides.markStaleQueued ?? (async () => 0)),
    purgeTerminalOlderThan: vi.fn(
      overrides.purgeTerminalOlderThan ?? (async () => 0),
    ),
  };
}

describe("aiJobMaintenanceSweep", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("reaps dead running jobs, dead queued jobs, and purges terminal ones past retention", async () => {
    const repo = makeRepo({
      markStaleRunning: async () => 2,
      markStaleQueued: async () => 1,
      purgeTerminalOlderThan: async () => 7,
    });

    const summary = await aiJobMaintenanceSweep({ repo, now: NOW });

    expect(summary).toEqual({
      staleReaped: 2,
      queuedReaped: 1,
      purged: 7,
      failed: 0,
    });
    expect(repo.purgeTerminalOlderThan).toHaveBeenCalledWith(
      new Date(NOW.getTime() - JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    );
  });

  it("reaps BOTH kinds of dead job before purging, so a job reaped this run is purgeable later", async () => {
    // Purging first would leave every reaped job waiting a further 30 days for
    // the next sweep to notice it.
    const order: string[] = [];
    const repo = makeRepo({
      markStaleRunning: async () => {
        order.push("reap-running");
        return 1;
      },
      markStaleQueued: async () => {
        order.push("reap-queued");
        return 1;
      },
      purgeTerminalOlderThan: async () => {
        order.push("purge");
        return 1;
      },
    });

    await aiJobMaintenanceSweep({ repo, now: NOW });

    expect(order).toEqual(["reap-running", "reap-queued", "purge"]);
  });

  it("a failed running-reap does not stop the queued reap or the purge", async () => {
    const repo = makeRepo({
      markStaleRunning: async () => {
        throw new Error("boom");
      },
      markStaleQueued: async () => 4,
      purgeTerminalOlderThan: async () => 3,
    });

    expect(await aiJobMaintenanceSweep({ repo, now: NOW })).toEqual({
      staleReaped: 0,
      queuedReaped: 4,
      purged: 3,
      failed: 1,
    });
  });

  it("a failed queued-reap is counted without affecting the others", async () => {
    const repo = makeRepo({
      markStaleRunning: async () => 1,
      markStaleQueued: async () => {
        throw new Error("boom");
      },
      purgeTerminalOlderThan: async () => 2,
    });

    expect(await aiJobMaintenanceSweep({ repo, now: NOW })).toEqual({
      staleReaped: 1,
      queuedReaped: 0,
      purged: 2,
      failed: 1,
    });
  });

  it("a failed purge is counted, not thrown", async () => {
    const repo = makeRepo({
      markStaleRunning: async () => 1,
      purgeTerminalOlderThan: async () => {
        throw new Error("boom");
      },
    });

    expect(await aiJobMaintenanceSweep({ repo, now: NOW })).toEqual({
      staleReaped: 1,
      queuedReaped: 0,
      purged: 0,
      failed: 1,
    });
  });

  it("all three failing still returns a summary rather than aborting the cron", async () => {
    // Reaping is only the PERSISTENCE of staleness — `GET /jobs/:id` derives the
    // same verdicts on read, so a broken sweep degrades table hygiene, not
    // correctness. That is why nothing here propagates.
    const boom = async () => {
      throw new Error("boom");
    };
    const repo = makeRepo({
      markStaleRunning: boom,
      markStaleQueued: boom,
      purgeTerminalOlderThan: boom,
    });

    expect(await aiJobMaintenanceSweep({ repo, now: NOW })).toEqual({
      staleReaped: 0,
      queuedReaped: 0,
      purged: 0,
      failed: 3,
    });
  });
});
