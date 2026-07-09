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

const repoUpdate = vi.fn();
vi.mock("../../../repositories/noteRepository", () => ({
  NoteRepository: vi.fn(() => ({ update: repoUpdate })),
}));

import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../../relationships/auditTrainerAction";
import { updateClientNoteOnBehalf } from "../updateClientNote";

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
  body: { content: "edited" },
};

describe("updateClientNoteOnBehalf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDb as any).mockReturnValue(makeDb());
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: true,
    });
    repoUpdate.mockResolvedValue({
      id: "n-1",
      noteType: "general",
      title: "",
      content: "edited",
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
    const result = await updateClientNoteOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 403,
      body: { code: "not_a_trainer", message: "nope" },
    });
    expect(repoUpdate).not.toHaveBeenCalled();
  });

  it("403s with no_relationship when there's no active relationship", async () => {
    (assertTrainerCanActForClient as any).mockResolvedValue({
      allowed: false,
      reason: "no_relationship",
      status: 403,
      body: { code: "not_your_client", message: "nope" },
    });
    const result = await updateClientNoteOnBehalf(ARGS);
    expect(result.ok).toBe(false);
    expect(repoUpdate).not.toHaveBeenCalled();
  });

  it("400s with no_fields when content/title/noteType are all undefined", async () => {
    const result = await updateClientNoteOnBehalf({
      ...ARGS,
      body: {},
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(repoUpdate).not.toHaveBeenCalled();
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("happy path: updates the note and audits (client_note_updated) in the same tx", async () => {
    const txStub = { marker: "tx" };
    (getDb as any).mockReturnValue(makeDb(txStub));

    const result = await updateClientNoteOnBehalf(ARGS);

    expect(result).toEqual({
      ok: true,
      note: expect.objectContaining({ id: "n-1", content: "edited" }),
    });
    expect(repoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        noteId: "n-1",
        trainerId: "trainer-1",
        clientId: "client-1",
        content: "edited",
      }),
      txStub,
    );
    expect(auditTrainerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "client_note_updated",
        targetTable: "trainer_client_notes",
        targetRowId: "n-1",
        tx: txStub,
      }),
    );
  });

  it("404s when the note doesn't exist / isn't the caller's, without writing an audit row", async () => {
    repoUpdate.mockResolvedValue(null);
    const result = await updateClientNoteOnBehalf(ARGS);
    expect(result).toEqual({
      ok: false,
      status: 404,
      body: expect.objectContaining({ code: "note_not_found" }),
    });
    expect(auditTrainerAction).not.toHaveBeenCalled();
  });

  it("rolls back (rejects) if the audit write throws", async () => {
    (auditTrainerAction as any).mockRejectedValue(new Error("audit failed"));
    await expect(updateClientNoteOnBehalf(ARGS)).rejects.toThrow(
      "audit failed",
    );
  });
});
