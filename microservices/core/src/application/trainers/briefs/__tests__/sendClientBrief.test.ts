/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../../relationships/assertTrainerCanActForClient", () => ({
  assertTrainerCanActForClient: vi.fn(),
}));

vi.mock("../../../relationships/auditTrainerAction", () => ({
  auditTrainerAction: vi.fn(),
}));

const notificationCreate = vi.fn();
vi.mock("../../../repositories/notificationRepository", () => ({
  NotificationRepository: vi.fn(() => ({ create: notificationCreate })),
}));

const dispatchExisting = vi.fn();
vi.mock("../../../notifications/push/notificationDispatcher", () => ({
  NotificationDispatcher: vi.fn(() => ({ dispatchExisting })),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import {
  sendClientBriefOnBehalf,
  CLIENT_BRIEF_DEEP_LINK,
} from "../sendClientBrief";

/**
 * getDb stub covering both call shapes the core uses: the trainer-profile
 * name lookup (`select().from().where().limit()`) and the write transaction.
 */
function makeDb(
  trainerRows: Array<{ fullName: string | null; role: string | null }>,
  txStub: unknown = {},
) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => trainerRows),
        })),
      })),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(txStub),
    ),
  };
}

const ARGS = {
  trainerId: "trainer-1",
  clientId: "client-1",
  message: "Your new block starts Monday — check your Training page",
};

const CREATED_ROW = {
  id: "notif-1",
  userId: "client-1",
  type: "coach_brief",
  title: "Brief from Coach Alex",
  message: ARGS.message,
  data: { deepLink: CLIENT_BRIEF_DEEP_LINK },
  isRead: false,
  readAt: null,
  relatedEntityType: null,
  relatedEntityId: null,
  createdAt: "2026-07-09T12:00:00.000Z",
};

describe("sendClientBriefOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockReturnValue(
      makeDb([{ fullName: "Alex", role: "personal_trainer" }]),
    );
    notificationCreate.mockResolvedValue(CREATED_ROW);
    (auditTrainerAction as any).mockResolvedValue(undefined);
    dispatchExisting.mockResolvedValue(undefined);
  });

  it("403s with wrong_role when the caller isn't a trainer — no writes, no push", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    const result = await sendClientBriefOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
    expect(dispatchExisting).not.toHaveBeenCalled();
  });

  it("403s with no_relationship when there's no active relationship", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const result = await sendClientBriefOnBehalf(ARGS);
    expect(result.ok).toBe(false);
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(dispatchExisting).not.toHaveBeenCalled();
  });

  it("happy path: notification row + brief_sent audit in the SAME tx, push after", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    const txStub = { marker: "tx" };
    (getDb as any).mockReturnValue(
      makeDb([{ fullName: "Alex", role: "personal_trainer" }], txStub),
    );

    const result = await sendClientBriefOnBehalf(ARGS);

    expect(result).toEqual({
      ok: true,
      notification: expect.objectContaining({ id: "notif-1" }),
    });
    // The notification is created FOR THE CLIENT, inside the caller's tx.
    expect(notificationCreate).toHaveBeenCalledWith(
      "client-1",
      {
        type: "coach_brief",
        title: "Brief from Coach Alex",
        message: ARGS.message,
        data: { deepLink: CLIENT_BRIEF_DEEP_LINK },
      },
      txStub,
    );
    expect(auditTrainerAction).toHaveBeenCalledWith({
      trainerId: "trainer-1",
      clientId: "client-1",
      actionType: "brief_sent",
      targetTable: "notifications",
      targetRowId: "notif-1",
      payload: { message: ARGS.message },
      tx: txStub,
    });
    // Push is attempted post-commit, against the persisted row.
    expect(dispatchExisting).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({ id: "notif-1" }),
    );
    const txOrder = (getDb as any).mock.results
      .map((r: any) => r.value?.transaction)
      .find(Boolean).mock.invocationCallOrder[0];
    expect(dispatchExisting.mock.invocationCallOrder[0]).toBeGreaterThan(
      txOrder,
    );
  });

  it("titles a physio's brief without the Coach prefix", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    (getDb as any).mockReturnValue(
      makeDb([{ fullName: "Sam", role: "physiotherapist" }]),
    );
    await sendClientBriefOnBehalf(ARGS);
    expect(notificationCreate).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({ title: "Brief from Sam" }),
      expect.anything(),
    );
  });

  it("falls back to generic copy when the trainer profile has no name", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    (getDb as any).mockReturnValue(makeDb([]));
    await sendClientBriefOnBehalf(ARGS);
    expect(notificationCreate).toHaveBeenCalledWith(
      "client-1",
      expect.objectContaining({ title: "Brief from your coach" }),
      expect.anything(),
    );
  });

  it("rolls back (rejects) if the audit write throws — no push attempted", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    (auditTrainerAction as any).mockRejectedValue(new Error("audit failed"));
    await expect(sendClientBriefOnBehalf(ARGS)).rejects.toThrow("audit failed");
    expect(dispatchExisting).not.toHaveBeenCalled();
  });
});
