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

const repoCreate = vi.fn();
vi.mock("../../../repositories/noteRepository", () => ({
  NoteRepository: vi.fn(() => ({ create: repoCreate })),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { createClientNoteOnBehalf } from "../createClientNote";

function makeDb(txStub: unknown = {}) {
  return {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(txStub),
    ),
  };
}

const ARGS = {
  trainerId: "trainer-1",
  clientId: "client-1",
  body: { content: "Great session today", noteType: "progress" as const },
};

describe("createClientNoteOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockReturnValue(makeDb());
    repoCreate.mockResolvedValue({
      id: "n-1",
      noteType: "progress",
      title: "",
      content: "Great session today",
      createdAt: "2026-07-01T12:00:00.000Z",
    });
    (auditTrainerAction as any).mockResolvedValue(undefined);
  });

  it("403s with wrong_role when the caller isn't a trainer", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "wrong_role",
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    const result = await createClientNoteOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    expect(repoCreate).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("403s with no_relationship when there's no active relationship", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const result = await createClientNoteOnBehalf(ARGS);
    expect(result.ok).toBe(false);
    expect(repoCreate).not.toHaveBeenCalled();
  });

  it("happy path: creates the note and audits (client_note_added) in the same tx", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    const txStub = { marker: "tx" };
    (getDb as any).mockReturnValue(makeDb(txStub));

    const result = await createClientNoteOnBehalf(ARGS);

    expect(result).toEqual({
      ok: true,
      note: expect.objectContaining({ id: "n-1" }),
    });
    expect(repoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        trainerId: "trainer-1",
        clientId: "client-1",
        content: "Great session today",
        noteType: "progress",
      }),
      txStub,
    );
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "client_note_added",
        targetTable: "trainer_client_notes",
        targetRowId: "n-1",
        tx: txStub,
      }),
    );
  });

  it("rolls back (rejects) if the audit write throws", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({ allowed: true });
    (auditTrainerAction as any).mockRejectedValue(new Error("audit failed"));
    await expect(createClientNoteOnBehalf(ARGS)).rejects.toThrow(
      "audit failed",
    );
  });
});
