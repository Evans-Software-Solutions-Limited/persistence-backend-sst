import { describe, it, expect, vi } from "vitest";
import {
  RETENTION_MONTHS,
  dataRetentionSweep,
  retentionCutoff,
} from "../dataRetentionSweep";

/**
 * The sweep is the mechanism behind a PUBLISHED retention promise ("we remove
 * records older than 12 months"), so these tests pin the window arithmetic and
 * the fact that the repo is called with that cutoff — not merely that something
 * ran.
 */
describe("retentionCutoff", () => {
  it("subtracts exactly RETENTION_MONTHS calendar months", () => {
    expect(RETENTION_MONTHS).toBe(12);
    expect(retentionCutoff(new Date("2026-08-03T02:00:00.000Z"))).toEqual(
      new Date("2025-08-03T02:00:00.000Z"),
    );
  });

  it("clamps rather than overflowing when the target month is shorter", () => {
    // 29 Feb 2028 minus 12 months has no counterpart in 2027. `setUTCMonth`
    // clamps to 28 Feb rather than rolling forward into March — which matters,
    // because rolling FORWARD would delete a day of data the policy still
    // promises to keep.
    expect(retentionCutoff(new Date("2028-02-29T00:00:00.000Z"))).toEqual(
      new Date("2027-02-28T00:00:00.000Z"),
    );
  });

  it("does not mutate the caller's clock", () => {
    const now = new Date("2026-08-03T02:00:00.000Z");
    retentionCutoff(now);
    expect(now.toISOString()).toBe("2026-08-03T02:00:00.000Z");
  });
});

describe("dataRetentionSweep", () => {
  it("prunes at the 12-month cutoff and totals the per-table counts", async () => {
    const pruneOlderThan = vi.fn(async () => ({
      dailyActivity: 4,
      sleep: 3,
      clientDataAccessLog: 11,
    }));

    const summary = await dataRetentionSweep({
      repo: { pruneOlderThan },
      now: new Date("2026-08-03T02:00:00.000Z"),
    });

    expect(pruneOlderThan).toHaveBeenCalledTimes(1);
    expect(pruneOlderThan).toHaveBeenCalledWith(
      new Date("2025-08-03T02:00:00.000Z"),
    );
    expect(summary).toEqual({
      dailyActivity: 4,
      sleep: 3,
      clientDataAccessLog: 11,
      cutoff: "2025-08-03T02:00:00.000Z",
      total: 18,
    });
  });

  it("reports a zero sweep without treating it as a failure", async () => {
    // Deleting nothing is the steady state once the backlog has drained — it
    // must not look like an error to whoever reads the log line.
    const summary = await dataRetentionSweep({
      repo: {
        pruneOlderThan: async () => ({
          dailyActivity: 0,
          sleep: 0,
          clientDataAccessLog: 0,
        }),
      },
      now: new Date("2026-08-03T02:00:00.000Z"),
    });
    expect(summary.total).toBe(0);
  });

  it("propagates a repo failure to the caller", async () => {
    // The cron wraps this in its own try/catch so a retention failure can never
    // affect the compliance-critical account purge; the sweep itself must not
    // swallow the error, or that guard would have nothing to catch and a broken
    // prune would look like a clean run.
    await expect(
      dataRetentionSweep({
        repo: {
          pruneOlderThan: async () => {
            throw new Error("connection terminated");
          },
        },
        now: new Date("2026-08-03T02:00:00.000Z"),
      }),
    ).rejects.toThrow("connection terminated");
  });
});
