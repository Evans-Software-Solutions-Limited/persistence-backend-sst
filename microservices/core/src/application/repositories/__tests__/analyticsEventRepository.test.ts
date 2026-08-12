/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { AnalyticsEventRepository } from "../analyticsEventRepository";

describe("AnalyticsEventRepository.insert", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps the event onto the row with defaults for source/properties", async () => {
    const onConflictDoNothing = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    (getDb as any).mockReturnValue({ insert: vi.fn(() => ({ values })) });

    await new AnalyticsEventRepository().insert({
      name: "subscription_purchased",
      userId: "u1",
      eventId: "evt-1",
      properties: { value: 9.99 },
    });

    expect(values).toHaveBeenCalledWith({
      userId: "u1",
      eventName: "subscription_purchased",
      properties: { value: 9.99 },
      source: "server",
      eventId: "evt-1",
    });
    // idempotency guard on the at-least-once emit paths
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it("passes occurredAt through only when provided, nulls missing userId/eventId", async () => {
    const onConflictDoNothing = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    (getDb as any).mockReturnValue({ insert: vi.fn(() => ({ values })) });
    const when = new Date("2026-08-12T00:00:00.000Z");

    await new AnalyticsEventRepository().insert({
      name: "lead_captured",
      occurredAt: when,
      source: "web",
    });

    expect(values).toHaveBeenCalledWith({
      userId: null,
      eventName: "lead_captured",
      occurredAt: when,
      properties: {},
      source: "web",
      eventId: null,
    });
  });
});

describe("AnalyticsEventRepository.listPendingMetaForward", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns [] without touching the DB for an empty name list", async () => {
    const getDbMock = getDb as any;
    expect(
      await new AnalyticsEventRepository().listPendingMetaForward([], 10),
    ).toEqual([]);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("maps joined rows, coalescing null email/properties", async () => {
    const rows = [
      {
        id: "r1",
        userId: "u1",
        email: "a@b.com",
        eventName: "renewal",
        occurredAt: new Date("2026-08-12T00:00:00.000Z"),
        properties: { value: 1 },
        source: "app",
        eventId: "e1",
      },
      {
        id: "r2",
        userId: null,
        email: null,
        eventName: "lead_captured",
        occurredAt: new Date("2026-08-12T00:00:00.000Z"),
        properties: null,
        source: "web",
        eventId: null,
      },
    ];
    const limit = vi.fn(async () => rows);
    (getDb as any).mockReturnValue({
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({ orderBy: () => ({ limit }) }),
          }),
        }),
      }),
    });

    const out = await new AnalyticsEventRepository().listPendingMetaForward(
      ["renewal", "lead_captured"],
      50,
    );
    expect(limit).toHaveBeenCalledWith(50);
    expect(out[0]).toMatchObject({ id: "r1", email: "a@b.com" });
    expect(out[1]).toMatchObject({ id: "r2", email: null, properties: {} });
  });
});

describe("AnalyticsEventRepository.markMetaForwarded", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-ops for an empty id list", async () => {
    const getDbMock = getDb as any;
    await new AnalyticsEventRepository().markMetaForwarded([]);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("stamps meta_forwarded_at for the given ids", async () => {
    const where = vi.fn(async () => undefined);
    const set = vi.fn(() => ({ where }));
    (getDb as any).mockReturnValue({ update: vi.fn(() => ({ set })) });

    await new AnalyticsEventRepository().markMetaForwarded(["r1", "r2"]);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ metaForwardedAt: expect.any(Date) }),
    );
    expect(where).toHaveBeenCalledTimes(1);
  });
});

describe("AnalyticsEventRepository.markExpiredForwarded", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bulk-marks pending rows older than the cutoff and returns the count", async () => {
    const returning = vi.fn(async () => [
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    (getDb as any).mockReturnValue({ update: vi.fn(() => ({ set })) });

    const n = await new AnalyticsEventRepository().markExpiredForwarded(
      new Date("2026-08-05T00:00:00.000Z"),
    );
    expect(n).toBe(3);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ metaForwardedAt: expect.any(Date) }),
    );
    expect(where).toHaveBeenCalledTimes(1);
  });
});
