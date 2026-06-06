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

describe("StripeWebhookEventsRepository (durable claim — spec 17 / Phase B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("claim", () => {
    it("returns true when a row was inserted/re-claimed (RETURNING non-empty)", async () => {
      const insert = makeInsertChain([{ id: "evt_test" }]);
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue(insert.chain),
      });

      const { StripeWebhookEventsRepository } =
        await import("../stripeWebhookEventsRepository");
      const claimed = await new StripeWebhookEventsRepository().claim(
        "evt_test",
        "customer.subscription.updated",
        { id: "evt_test" },
      );
      expect(claimed).toBe(true);
    });

    it("returns false when the row is already done (DO UPDATE WHERE skipped → empty RETURNING)", async () => {
      const insert = makeInsertChain([]);
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue(insert.chain),
      });

      const { StripeWebhookEventsRepository } =
        await import("../stripeWebhookEventsRepository");
      const claimed = await new StripeWebhookEventsRepository().claim(
        "evt_dup",
        "invoice.payment_succeeded",
        { id: "evt_dup" },
      );
      expect(claimed).toBe(false);
    });

    it("inserts with status='processing' + attempts=1 and a re-claim WHERE predicate", async () => {
      const insert = makeInsertChain([{ id: "evt_test" }]);
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue(insert.chain),
      });

      const { StripeWebhookEventsRepository } =
        await import("../stripeWebhookEventsRepository");
      const payload = { id: "evt_test", livemode: false };
      await new StripeWebhookEventsRepository().claim(
        "evt_test",
        "customer.subscription.created",
        payload,
      );

      expect(insert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "evt_test",
          type: "customer.subscription.created",
          payload,
          status: "processing",
          attempts: 1,
        }),
      );
      // The conflict path must carry a setWhere so a `done` row is NOT
      // re-claimed (only failed / stale-processing).
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

      const { StripeWebhookEventsRepository } =
        await import("../stripeWebhookEventsRepository");
      await new StripeWebhookEventsRepository().markDone("evt_test");
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

      const { StripeWebhookEventsRepository } =
        await import("../stripeWebhookEventsRepository");
      await new StripeWebhookEventsRepository().markFailed("evt_test", "boom");
      expect(update.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", lastError: "boom" }),
      );
    });
  });
});
