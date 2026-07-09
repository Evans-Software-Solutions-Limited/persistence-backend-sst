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

const repoDelete = vi.fn();
vi.mock("../../../repositories/noteRepository", () => ({
  NoteRepository: vi.fn(() => ({ delete: repoDelete })),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { deleteClientNoteOnBehalf } from "../deleteClientNote";

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
  noteId: "n-1",
};

describe("deleteClientNoteOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockReturnValue(makeDb());
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: true,
    });
    repoDelete.mockResolvedValue({
      id: "n-1",
      noteType: "general",
      title: "",
      content: "deleted me",
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
    const result = await deleteClientNoteOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    expect(repoDelete).not.toHaveBeenCalled();
  });

  it("403s with no_relationship when there's no active relationship", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const result = await deleteClientNoteOnBehalf(ARGS);
    expect(result.ok).toBe(false);
    expect(repoDelete).not.toHaveBeenCalled();
  });

  it("happy path: deletes the note and audits (client_note_deleted) in the same tx", async () => {
    const txStub = { marker: "tx" };
    (getDb as any).mockReturnValue(makeDb(txStub));

    const result = await deleteClientNoteOnBehalf(ARGS);

    expect(result).toEqual({ ok: true });
    expect(repoDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: "n-1",
        trainerId: "trainer-1",
        clientId: "client-1",
      }),
      txStub,
    );
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "client_note_deleted",
        targetTable: "trainer_client_notes",
        targetRowId: "n-1",
        tx: txStub,
      }),
    );
  });

  it("404s when the note doesn't exist / isn't the caller's, without writing an audit row", async () => {
    repoDelete.mockResolvedValue(null);
    const result = await deleteClientNoteOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 404,
      body: expect.objectContaining({ code: "note_not_found" }),
    });
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("rolls back (rejects) if the audit write throws", async () => {
    (auditTrainerAction as any).mockRejectedValue(new Error("audit failed"));
    await expect(deleteClientNoteOnBehalf(ARGS)).rejects.toThrow(
      "audit failed",
    );
  });
});
