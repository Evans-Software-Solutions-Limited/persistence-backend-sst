/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

function makeInsertChain(resolvedValue: unknown) {
  return {
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(resolvedValue),
      }),
    }),
  };
}

function makeDeleteChain(resolvedValue: unknown) {
  return {
    where: vi.fn().mockResolvedValue(resolvedValue),
  };
}

describe("StripeWebhookEventsRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("claim", () => {
    it("returns true when the event_id was newly inserted", async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue(makeInsertChain([{ id: "evt_test" }])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { StripeWebhookEventsRepository } =
        await import("../stripeWebhookEventsRepository");
      const repo = new StripeWebhookEventsRepository();
      const claimed = await repo.claim(
        "evt_test",
        "customer.subscription.updated",
        {
          id: "evt_test",
        },
      );
      expect(claimed).toBe(true);
    });

    it("returns false when the event_id already existed (ON CONFLICT DO NOTHING returned no row)", async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue(makeInsertChain([])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { StripeWebhookEventsRepository } =
        await import("../stripeWebhookEventsRepository");
      const repo = new StripeWebhookEventsRepository();
      const claimed = await repo.claim("evt_dup", "invoice.payment_succeeded", {
        id: "evt_dup",
      });
      expect(claimed).toBe(false);
    });

    it("passes event_id + type + payload to the insert builder", async () => {
      const mockDb = {
        insert: vi.fn().mockReturnValue(makeInsertChain([{ id: "evt_test" }])),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { StripeWebhookEventsRepository } =
        await import("../stripeWebhookEventsRepository");
      const repo = new StripeWebhookEventsRepository();
      const payload = { id: "evt_test", livemode: false };
      await repo.claim("evt_test", "customer.subscription.created", payload);

      const insertResult = mockDb.insert.mock.results[0]?.value as {
        values: ReturnType<typeof vi.fn>;
      };
      expect(insertResult.values).toHaveBeenCalledWith({
        eventId: "evt_test",
        type: "customer.subscription.created",
        payload,
      });
    });
  });

  describe("release", () => {
    it("deletes the row by event_id (best-effort rollback)", async () => {
      const mockDb = {
        delete: vi.fn().mockReturnValue(makeDeleteChain({ rowCount: 1 })),
      };
      (getDb as any).mockReturnValue(mockDb);

      const { StripeWebhookEventsRepository } =
        await import("../stripeWebhookEventsRepository");
      const repo = new StripeWebhookEventsRepository();
      await repo.release("evt_test");
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
