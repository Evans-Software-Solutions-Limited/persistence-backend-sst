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
    const send = vi.fn(async () => true);
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
    const send = vi.fn(async () => true);
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
});
