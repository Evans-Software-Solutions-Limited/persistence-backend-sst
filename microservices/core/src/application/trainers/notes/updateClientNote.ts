import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import {
  NoteRepository,
  type NoteRow,
  type NoteType,
} from "../../repositories/noteRepository";

export interface UpdateClientNoteBody {
  content?: string;
  title?: string;
  noteType?: NoteType;
}

export interface UpdateClientNoteArgs {
  trainerId: string;
  clientId: string;
  noteId: string;
  body: UpdateClientNoteBody;
}

export type UpdateClientNoteResult =
  | { ok: true; note: NoteRow }
  | { ok: false; status: 403 | 404 | 400; body: { code: string; message: string } };

/**
 * Shared core for a coach editing one of their own private notes for a client.
 *   1. `assertTrainerCanActForClient` gate (403).
 *   2. Reject an empty patch (400 `no_fields`).
 *   3. Update (scoped to trainer+client+id) + `client_note_updated` audit in ONE
 *      transaction. A no-match update (missing / another trainer's note) → 404
 *      `note_not_found`, and the transaction is rolled back so no audit row is
 *      written for a note that wasn't touched.
 */
export async function updateClientNoteOnBehalf({
  trainerId,
  clientId,
  noteId,
  body,
}: UpdateClientNoteArgs): Promise<UpdateClientNoteResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  if (
    body.content === undefined &&
    body.title === undefined &&
    body.noteType === undefined
  ) {
    return {
      ok: false,
      status: 400,
      body: { code: "no_fields", message: "Change at least one field." },
    };
  }

  const notes = new NoteRepository();

  try {
    const note = await getDb().transaction(async (tx) => {
      const updated = await notes.update(
        { noteId, trainerId, clientId, ...body },
        tx,
      );
      if (!updated) {
        // Roll the tx back — nothing to audit for a note that wasn't ours.
        throw new NoteNotFound();
      }
      await auditTrainerAction({
        trainerId,
        clientId,
        actionType: "client_note_updated",
        targetTable: "trainer_client_notes",
        targetRowId: updated.id,
        payload: { noteType: updated.noteType },
        tx,
      });
      return updated;
    });
    return { ok: true, note };
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
