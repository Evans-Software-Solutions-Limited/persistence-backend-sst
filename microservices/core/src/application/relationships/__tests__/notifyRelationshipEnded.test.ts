/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

const createAndDispatch = vi.fn(async () => ({}) as any);
vi.mock("../../notifications/push/notificationDispatcher", () => ({
  NotificationDispatcher: vi.fn(() => ({ createAndDispatch })),
}));

/** Thenable select builder — one queued row-set per awaited query. */
function selectDb(rows: unknown[]) {
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.from = vi.fn(self);
  chain.where = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.then = (
    resolve: (v: unknown[]) => unknown,
    reject: (e: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

describe("notifyRelationshipEnded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initiatedBy 'trainer' → dispatches to the CLIENT, copy names the coach", async () => {
    (getDb as any).mockReturnValue(selectDb([{ fullName: "Carter" }]));
    const { notifyRelationshipEnded } =
      await import("../notifyRelationshipEnded");

    await notifyRelationshipEnded({
      recipientId: "client-1",
      otherPartyId: "trainer-1",
      initiatedBy: "trainer",
      relationshipId: "rel-1",
    });

    expect(createAndDispatch).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        type: "coaching_relationship_ended",
        relatedEntityType: "pt_client_relationship",
        relatedEntityId: "rel-1",
        message: expect.stringContaining("Carter"),
      }),
    );
  });

  it("initiatedBy 'client' → dispatches to the COACH, copy names the client", async () => {
    (getDb as any).mockReturnValue(selectDb([{ fullName: "Jamie" }]));
    const { notifyRelationshipEnded } =
      await import("../notifyRelationshipEnded");

    await notifyRelationshipEnded({
      recipientId: "trainer-1",
      otherPartyId: "client-1",
      initiatedBy: "client",
      relationshipId: "rel-2",
    });

    expect(createAndDispatch).toHaveBeenCalledWith(
      "trainer-1",
      expect.objectContaining({
        type: "coaching_relationship_ended",
        message: expect.stringContaining("Jamie"),
      }),
    );
  });

  it("falls back to 'Your coach' when the coach's profile lookup returns no row", async () => {
    (getDb as any).mockReturnValue(selectDb([]));
    const { notifyRelationshipEnded } =
      await import("../notifyRelationshipEnded");

    await notifyRelationshipEnded({
      recipientId: "client-1",
      otherPartyId: "trainer-1",
      initiatedBy: "trainer",
      relationshipId: "rel-1",
    });

    expect(createAndDispatch).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({
        message: expect.stringContaining("Your coach"),
      }),
    );
  });

  it("falls back to 'A client' when the client's profile lookup returns no row", async () => {
    (getDb as any).mockReturnValue(selectDb([]));
    const { notifyRelationshipEnded } =
      await import("../notifyRelationshipEnded");

    await notifyRelationshipEnded({
      recipientId: "trainer-1",
      otherPartyId: "client-1",
      initiatedBy: "client",
      relationshipId: "rel-2",
    });

    expect(createAndDispatch).toHaveBeenCalledWith(
      "trainer-1",
      expect.objectContaining({
        message: expect.stringContaining("A client"),
      }),
    );
  });

  it("NEVER throws: a dispatcher failure is swallowed (best-effort)", async () => {
    (getDb as any).mockReturnValue(selectDb([{ fullName: "Carter" }]));
    createAndDispatch.mockRejectedValueOnce(new Error("push infra down"));
    const { notifyRelationshipEnded } =
      await import("../notifyRelationshipEnded");

    await expect(
      notifyRelationshipEnded({
        recipientId: "client-1",
        otherPartyId: "trainer-1",
        initiatedBy: "trainer",
        relationshipId: "rel-1",
      }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
