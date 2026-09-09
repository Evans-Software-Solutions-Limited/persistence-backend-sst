import { describe, it, expect, vi } from "vitest";
import {
  forwardPendingToMeta,
  META_EVENT_MAX_AGE_MS,
} from "../metaCapiForward";
import type { PendingMetaEvent } from "../../repositories/analyticsEventRepository";

// Default: a CONSENTED, anonymous, WEB-origin row — the shape that forwards
// after the R2.7/R2.8 gates in `mapPendingToMetaEvents` (which this drainer runs
// for real).
function pending(over: Partial<PendingMetaEvent>): PendingMetaEvent {
  return {
    id: "row-1",
    userId: null,
    email: null,
    marketingConsent: null,
    eventName: "lead_captured",
    occurredAt: new Date("2026-08-12T00:00:00.000Z"),
    properties: { marketing_consent: true, fbp: "fb.1.1.default" },
    source: "web",
    eventId: "evt-1",
    ...over,
  };
}

const NOW = new Date("2026-08-12T12:00:00.000Z");

/** A clean Graph response: batch POSTed, Meta kept everything, no warnings. */
const CLEAN_RECEIPT = {
  sent: true,
  eventsReceived: 1,
  messages: [] as string[],
};

describe("forwardPendingToMeta", () => {
  it("no-ops (no expire, no DB read, no send) when unconfigured", async () => {
    const markExpired = vi.fn();
    const listPending = vi.fn();
    const send = vi.fn();
    const summary = await forwardPendingToMeta({
      markExpired,
      listPending,
      markForwarded: vi.fn(),
      send,
      configured: () => false,
    });
    expect(summary).toEqual({
      configured: false,
      pending: 0,
      forwarded: 0,
      skipped: 0,
      metaEvents: 0,
      eventsReceived: null,
      metaMessages: [],
    });
    expect(markExpired).not.toHaveBeenCalled();
    expect(listPending).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("expires rows past Meta's 7-day window (no send) at the right cutoff", async () => {
    const markExpired = vi.fn(async () => 4);
    const send = vi.fn();
    const summary = await forwardPendingToMeta({
      markExpired,
      listPending: vi.fn(async () => []),
      markForwarded: vi.fn(),
      send,
      configured: () => true,
      now: NOW,
    });
    expect(markExpired).toHaveBeenCalledWith(
      new Date(NOW.getTime() - META_EVENT_MAX_AGE_MS),
    );
    expect(summary).toMatchObject({ skipped: 4, pending: 0, forwarded: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the mapped fresh events and marks the whole batch forwarded", async () => {
    const rows = [
      pending({ id: "r1" }), // lead_captured → Lead (1)
      pending({ id: "r2", eventName: "store_click" }), // → AppStoreClick (1)
    ];
    // Its own receipt, not CLEAN_RECEIPT: this batch maps to TWO events, and a
    // count that disagreed would trip the escalation branch and dirty stderr
    // for a case that is not about escalation at all.
    const send = vi.fn(async () => ({
      sent: true,
      eventsReceived: 2,
      messages: [] as string[],
    }));
    const markForwarded = vi.fn(async () => {});
    const summary = await forwardPendingToMeta({
      markExpired: vi.fn(async () => 1),
      listPending: vi.fn(async () => rows),
      markForwarded,
      send,
      configured: () => true,
      now: NOW,
    });
    expect(summary).toEqual({
      configured: true,
      pending: 2,
      forwarded: 2,
      skipped: 1,
      metaEvents: 2,
      eventsReceived: 2,
      metaMessages: [],
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(markForwarded).toHaveBeenCalledWith(["r1", "r2"]);
  });

  it("an all-skipped batch (app-origin / no consent) sends nothing but STILL stamps forwarded — no re-scan loop", async () => {
    // These rows all map to [] (app-origin + unconsented), so nothing is sent —
    // but they must still be marked forwarded or the drainer re-pulls them every
    // drain forever.
    const rows = [
      pending({ id: "a1", source: "app", eventName: "subscription_purchased" }),
      pending({ id: "a2", properties: { marketing_consent: false } }),
    ];
    const send = vi.fn(async () => CLEAN_RECEIPT);
    const markForwarded = vi.fn(async () => {});
    const summary = await forwardPendingToMeta({
      markExpired: vi.fn(async () => 0),
      listPending: vi.fn(async () => rows),
      markForwarded,
      send,
      configured: () => true,
      now: NOW,
    });
    expect(summary).toMatchObject({ pending: 2, forwarded: 2, metaEvents: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(markForwarded).toHaveBeenCalledWith(["a1", "a2"]);
  });

  it("marks fresh rows nothing when send throws (they retry; expired stay retired)", async () => {
    const markExpired = vi.fn(async () => 2);
    const markForwarded = vi.fn(async () => {});
    await expect(
      forwardPendingToMeta({
        markExpired,
        listPending: vi.fn(async () => [pending({})]),
        markForwarded,
        send: vi.fn(async () => {
          throw new Error("graph 500");
        }),
        configured: () => true,
        now: NOW,
      }),
    ).rejects.toThrow("graph 500");
    expect(markExpired).toHaveBeenCalledTimes(1);
    expect(markForwarded).not.toHaveBeenCalled();
  });

  it("respects a custom batchLimit", async () => {
    const listPending = vi.fn(async () => []);
    await forwardPendingToMeta({
      markExpired: vi.fn(async () => 0),
      listPending,
      markForwarded: vi.fn(),
      send: vi.fn(),
      configured: () => true,
      batchLimit: 25,
    });
    expect(listPending).toHaveBeenCalledWith(expect.any(Array), 25);
  });

  it("reports Meta's OWN count back in the summary, not just what it sent", async () => {
    // The gap this closes: a 2xx that Meta kept nothing from used to log a
    // summary indistinguishable from a clean send, so a silently-dropped
    // server-side event was invisible from the logs.
    // Silenced, not because the log line is wrong — this receipt SHOULD
    // escalate — but so a deliberate case does not read as noise in the run.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const summary = await forwardPendingToMeta({
        markExpired: vi.fn(async () => 0),
        listPending: vi.fn(async () => [pending({})]),
        markForwarded: vi.fn(async () => {}),
        send: vi.fn(async () => ({
          sent: true,
          eventsReceived: 0,
          messages: ["Missing event_source_url"],
        })),
        configured: () => true,
        now: NOW,
      });
      expect(summary.metaEvents).toBe(1);
      expect(summary.eventsReceived).toBe(0);
      expect(summary.metaMessages).toEqual(["Missing event_source_url"]);
    } finally {
      error.mockRestore();
    }
  });

  it("refuses to retire rows when the send reports it POSTed nothing", async () => {
    // "We mapped events, nothing went out, mark them done" is a silent
    // data-loss shape. The rows must stay pending for the next drain.
    const markForwarded = vi.fn(async () => {});
    await expect(
      forwardPendingToMeta({
        markExpired: vi.fn(async () => 0),
        listPending: vi.fn(async () => [pending({})]),
        markForwarded,
        send: vi.fn(async () => ({
          sent: false,
          eventsReceived: null,
          messages: [],
        })),
        configured: () => true,
        now: NOW,
      }),
    ).rejects.toThrow(/no send for a non-empty batch/);
    expect(markForwarded).not.toHaveBeenCalled();
  });

  it("escalates a receipt carrying warnings out of the info-level summary", async () => {
    // `messages` is the only place a data-quality drop surfaces, and Sentry only
    // sees throws — so it must not be buried in a console.log nobody greps.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await forwardPendingToMeta({
        markExpired: vi.fn(async () => 0),
        listPending: vi.fn(async () => [pending({})]),
        markForwarded: vi.fn(async () => {}),
        send: vi.fn(async () => ({
          sent: true,
          eventsReceived: 1,
          messages: ["Missing event_source_url"],
        })),
        configured: () => true,
        now: NOW,
      });
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("[meta-capi-forward:receipt]"),
      );
      expect(error.mock.calls[0]![0]).toContain("Missing event_source_url");
    } finally {
      error.mockRestore();
    }
  });

  it("escalates an UNVERIFIABLE receipt rather than assuming it landed", async () => {
    // A 200 with a body we could not parse. `null` must not read as "Meta took
    // all of them": that silences the alarm in the one state where we know
    // nothing, and the rows are stamped unretryable straight after.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await forwardPendingToMeta({
        markExpired: vi.fn(async () => 0),
        listPending: vi.fn(async () => [pending({})]),
        markForwarded: vi.fn(async () => {}),
        send: vi.fn(async () => ({
          sent: true,
          eventsReceived: null,
          messages: [],
        })),
        configured: () => true,
        now: NOW,
      });
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("[meta-capi-forward:receipt]"),
      );
    } finally {
      error.mockRestore();
    }
  });

  it("escalates a batch Meta took only part of", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await forwardPendingToMeta({
        markExpired: vi.fn(async () => 0),
        listPending: vi.fn(async () => [pending({}), pending({ id: "b2" })]),
        markForwarded: vi.fn(async () => {}),
        send: vi.fn(async () => ({
          sent: true,
          eventsReceived: 1,
          messages: [],
        })),
        configured: () => true,
        now: NOW,
      });
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('"eventsReceived":1'),
      );
    } finally {
      error.mockRestore();
    }
  });

  it("stays quiet on a clean receipt", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await forwardPendingToMeta({
        markExpired: vi.fn(async () => 0),
        listPending: vi.fn(async () => [pending({})]),
        markForwarded: vi.fn(async () => {}),
        send: vi.fn(async () => CLEAN_RECEIPT),
        configured: () => true,
        now: NOW,
      });
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it("leaves the receipt fields null when nothing was sent", async () => {
    const summary = await forwardPendingToMeta({
      markExpired: vi.fn(async () => 0),
      listPending: vi.fn(async () => []),
      markForwarded: vi.fn(async () => {}),
      send: vi.fn(),
      configured: () => true,
      now: NOW,
    });
    expect(summary).toMatchObject({ eventsReceived: null, metaMessages: [] });
  });
});
