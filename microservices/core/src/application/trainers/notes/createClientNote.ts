import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import {
  NoteRepository,
  type NoteRow,
  type NoteType,
} from "../../repositories/noteRepository";

export interface CreateClientNoteBody {
  content: string;
  title?: string;
  noteType?: NoteType;
}

export interface CreateClientNoteArgs {
  trainerId: string;
  clientId: string;
  body: CreateClientNoteBody;
}

export type CreateClientNoteResult =
  | { ok: true; note: NoteRow }
  | { ok: false; status: 403; body: { code: string; message: string } };

/**
 * Shared core for a coach adding a PRIVATE note to a client they train
 * (10-trainer-features Phase 12). Same on-behalf shape as goals:
 *   1. `assertTrainerCanActForClient` gate (cross-cuts § 1.3).
 *   2. Note insert + `trainer_actions_audit` (`client_note_added`) in ONE
 *      transaction (cross-cuts § 1.4.2).
 * Notes are private — NO client notification (unlike goals/measurements).
 */
export async function createClientNoteOnBehalf({
  trainerId,
  clientId,
  body,
}: CreateClientNoteArgs): Promise<CreateClientNoteResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const notes = new NoteRepository();

  const note = await getDb().transaction(async (tx) => {
    const created = await notes.create(
      {
        trainerId,
        clientId,
        content: body.content,
        // The prototype's note rows are date + body (no title); persist an
        // empty title when the caller omits one (the column is NOT NULL).
        title: body.title ?? "",
        noteType: body.noteType,
      },
      tx,
    );

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "client_note_added",
      targetTable: "trainer_client_notes",
      targetRowId: created.id,
      payload: { noteType: created.noteType },
      tx,
    });

    return created;
  });

  return { ok: true, note };
}
