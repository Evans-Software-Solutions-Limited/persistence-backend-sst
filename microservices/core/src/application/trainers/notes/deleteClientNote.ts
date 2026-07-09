import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import { NoteRepository } from "../../repositories/noteRepository";

export interface DeleteClientNoteArgs {
  trainerId: string;
  clientId: string;
  noteId: string;
}

export type DeleteClientNoteResult =
  | { ok: true }
  | { ok: false; status: 403 | 404; body: { code: string; message: string } };

/**
 * Shared core for a coach deleting one of their own private notes for a client.
 *   1. `assertTrainerCanActForClient` gate (403).
 *   2. Delete (scoped to trainer+client+id) + `client_note_deleted` audit in ONE
 *      transaction. A no-match delete → 404 `note_not_found` with the tx rolled
 *      back (no audit for a note that wasn't ours). The deleted row's id is
 *      captured for the audit payload before the tx commits.
 */
export async function deleteClientNoteOnBehalf({
  trainerId,
  clientId,
  noteId,
}: DeleteClientNoteArgs): Promise<DeleteClientNoteResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const notes = new NoteRepository();

  try {
    await getDb().transaction(async (tx) => {
      const deleted = await notes.delete({ noteId, trainerId, clientId }, tx);
      if (!deleted) {
        throw new NoteNotFound();
      }
      await auditTrainerAction({
        trainerId,
        clientId,
        actionType: "client_note_deleted",
        targetTable: "trainer_client_notes",
        targetRowId: deleted.id,
        payload: { noteType: deleted.noteType },
        tx,
      });
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof NoteNotFound) {
      return {
        ok: false,
        status: 404,
        body: { code: "note_not_found", message: "That note no longer exists." },
      };
    }
    throw err;
  }
}

class NoteNotFound extends Error {
  constructor() {
    super("note_not_found");
    this.name = "NoteNotFound";
    Object.setPrototypeOf(this, NoteNotFound.prototype);
  }
}
