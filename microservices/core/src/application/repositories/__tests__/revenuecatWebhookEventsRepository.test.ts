/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeInsertChain(resolvedValue: unknown) {
  const returning = vi.fn().mockResolvedValue(resolvedValue);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  return { chain: { values }, onConflictDoUpdate, values };
}

function makeUpdateChain() {
  const where = vi.fn().mockResolvedValue({ rowCount: 1 });
  const set = vi.fn().mockReturnValue({ where });
  return { chain: { set }, set, where };
}

describe("RevenueCatWebhookEventsRepository (durable claim — M12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("claim", () => {
    it("returns true when a row was inserted/re-claimed (RETURNING non-empty)", async () => {
      const insert = makeInsertChain([{ id: "evt_1" }]);
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue(insert.chain),
      });

      const { RevenueCatWebhookEventsRepository } =
        await import("../revenuecatWebhookEventsRepository");
      const claimed = await new RevenueCatWebhookEventsRepository().claim(
        "evt_1",
        "INITIAL_PURCHASE",
        { id: "evt_1" },
      );
      expect(claimed).toBe(true);
    });

    it("returns false when the row is already done (empty RETURNING)", async () => {
      const insert = makeInsertChain([]);
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue(insert.chain),
      });

      const { RevenueCatWebhookEventsRepository } =
        await import("../revenuecatWebhookEventsRepository");
      const claimed = await new RevenueCatWebhookEventsRepository().claim(
        "evt_dup",
        "RENEWAL",
        { id: "evt_dup" },
      );
      expect(claimed).toBe(false);
    });

    it("inserts status='processing' + attempts=1 and a re-claim WHERE predicate", async () => {
      const insert = makeInsertChain([{ id: "evt_1" }]);
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue(insert.chain),
      });

      const { RevenueCatWebhookEventsRepository } =
        await import("../revenuecatWebhookEventsRepository");
      const payload = { id: "evt_1", type: "INITIAL_PURCHASE" };
      await new RevenueCatWebhookEventsRepository().claim(
        "evt_1",
        "INITIAL_PURCHASE",
        payload,
      );

      expect(insert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "evt_1",
          type: "INITIAL_PURCHASE",
          payload,
          status: "processing",
          attempts: 1,
        }),
      );
      expect(insert.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ setWhere: expect.anything() }),
      );
    });
  });

  describe("markDone", () => {
    it("updates the row to status='done'", async () => {
      const update = makeUpdateChain();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue(update.chain),
      });

      const { RevenueCatWebhookEventsRepository } =
        await import("../revenuecatWebhookEventsRepository");
      await new RevenueCatWebhookEventsRepository().markDone("evt_1");
      expect(update.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "done" }),
      );
    });
  });

  describe("markFailed", () => {
    it("updates the row to status='failed' and records the (truncated) error", async () => {
      const update = makeUpdateChain();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue(update.chain),
      });

      const { RevenueCatWebhookEventsRepository } =
        await import("../revenuecatWebhookEventsRepository");
      await new RevenueCatWebhookEventsRepository().markFailed("evt_1", "boom");
      expect(update.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", lastError: "boom" }),
      );
    });

    it("truncates a very long error to 2000 chars", async () => {
      const update = makeUpdateChain();
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue(update.chain),
      });

      const { RevenueCatWebhookEventsRepository } =
        await import("../revenuecatWebhookEventsRepository");
      await new RevenueCatWebhookEventsRepository().markFailed(
        "evt_1",
        "x".repeat(5000),
      );
      const arg = update.set.mock.calls[0][0] as { lastError: string };
      expect(arg.lastError.length).toBe(2000);
    });
  });
});
