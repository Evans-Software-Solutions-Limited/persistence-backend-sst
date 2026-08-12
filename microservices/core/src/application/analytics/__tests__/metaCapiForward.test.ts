import { describe, it, expect, vi } from "vitest";
import {
  forwardPendingToMeta,
  META_EVENT_MAX_AGE_MS,
} from "../metaCapiForward";
import type { PendingMetaEvent } from "../../repositories/analyticsEventRepository";

function pending(over: Partial<PendingMetaEvent>): PendingMetaEvent {
  return {
    id: "row-1",
    userId: "user-1",
    email: "a@b.com",
    eventName: "subscription_purchased",
    occurredAt: new Date("2026-08-12T00:00:00.000Z"),
    properties: { value: 9.99, currency: "GBP" },
    source: "app",
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
      pending({ id: "r1" }),
      pending({ id: "r2", eventName: "renewal" }),
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
    // r1 → Purchase+Subscribe (2), r2 → Purchase (1) = 3 Meta events
    expect(summary).toEqual({
      configured: true,
      pending: 2,
      forwarded: 2,
      skipped: 1,
      metaEvents: 3,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(markForwarded).toHaveBeenCalledWith(["r1", "r2"]);
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
    // expired retired BEFORE the send, so they don't accumulate...
    expect(markExpired).toHaveBeenCalledTimes(1);
    // ...but the fresh batch is left for the next drain.
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
