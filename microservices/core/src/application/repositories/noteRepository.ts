import { and, desc, eq } from "drizzle-orm";
import { noteTypeEnum, trainerClientNotes } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "./personalRecordsRepository";

/** The `note_type` enum union (progress | injury | milestone | concern | general). */
export type NoteType = (typeof noteTypeEnum.enumValues)[number];

/**
 * A coach note row as surfaced to the client-detail Notes card. Mirrors
 * `ClientDetailNote` in `repositories/clientDetail.ts`.
 */
export interface NoteRow {
  id: string;
  noteType: string;
  title: string;
  content: string;
  createdAt: string; // ISO
}

function mapRow(r: {
  id: string;
  noteType: string | null;
  title: string;
  content: string;
  createdAt: Date | string | null;
}): NoteRow {
  return {
    id: r.id,
    // Fallback matches the DB column default + the aggregate read
    // (ClientDetailRepository.getNotes) — the column is NOT NULL so this is
    // only reached defensively, but the two readers must agree.
    noteType: r.noteType ?? "progress",
    title: r.title,
    content: r.content,
    createdAt:
      r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : String(r.createdAt ?? ""),
  };
}

/**
 * Data access for `trainer_client_notes` writes (Coach Mode Phase 12). Reads for
 * the Client Detail card live in `ClientDetailRepository.getNotes`; this owns
 * create / update / delete. Every mutation is scoped to BOTH `trainerId` and
 * `clientId` — a coach can only touch their own notes for a client they train,
 * enforced in the WHERE clause (never by id alone). The optional `tx` threads
 * the on-behalf write + its `trainer_actions_audit` row into ONE transaction
 * (cross-cuts § 1.4.2), the same pattern as `GoalRepository.create`.
 *
 * Constructed directly (not DI-decorated) — same TS2589-avoidance rationale as
 * the other trainer repos.
 */
export class NoteRepository {
  static readonly key = "NoteRepository";

  async create(
    input: {
      trainerId: string;
      clientId: string;
      content: string;
      title: string;
      noteType?: NoteType;
    },
    tx?: DbOrTx,
  ): Promise<NoteRow> {
    const db = tx ?? getDb();
    const rows = await db
      .insert(trainerClientNotes)
      .values({
        trainerId: input.trainerId,
        clientId: input.clientId,
        content: input.content,
        title: input.title,
        // note_type has a DB default ('progress'); default coach notes to
        // 'general' when the caller doesn't specify a type.
        ...(input.noteType ? { noteType: input.noteType } : {}),
      })
      .returning();
    return mapRow(rows[0]);
  }

  /**
   * Update a note the caller owns for this client. Returns the mapped row, or
   * `null` when no row matches (missing / another trainer's) → the handler 404s.
   */
  async update(
    input: {
      noteId: string;
      trainerId: string;
      clientId: string;
      content?: string;
      title?: string;
      noteType?: NoteType;
    },
    tx?: DbOrTx,
  ): Promise<NoteRow | null> {
    const db = tx ?? getDb();
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.content !== undefined) set.content = input.content;
    if (input.title !== undefined) set.title = input.title;
    if (input.noteType !== undefined) set.noteType = input.noteType;

    const rows = await db
      .update(trainerClientNotes)
      .set(set)
      .where(
        and(
          eq(trainerClientNotes.id, input.noteId),
          eq(trainerClientNotes.trainerId, input.trainerId),
          eq(trainerClientNotes.clientId, input.clientId),
        ),
      )
      .returning();
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Delete a note the caller owns for this client. Returns the deleted row (for
   * the audit payload), or `null` when nothing matched → the handler 404s.
   */
  async delete(
    input: { noteId: string; trainerId: string; clientId: string },
    tx?: DbOrTx,
  ): Promise<NoteRow | null> {
    const db = tx ?? getDb();
    const rows = await db
      .delete(trainerClientNotes)
      .where(
        and(
          eq(trainerClientNotes.id, input.noteId),
          eq(trainerClientNotes.trainerId, input.trainerId),
          eq(trainerClientNotes.clientId, input.clientId),
        ),
      )
      .returning();
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /** Newest-first notes for a (trainer, client) pair — used only by tests here;
   * the aggregate's own read is `ClientDetailRepository.getNotes`. */
  async listForClient(trainerId: string, clientId: string): Promise<NoteRow[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(trainerClientNotes)
      .where(
        and(
          eq(trainerClientNotes.trainerId, trainerId),
          eq(trainerClientNotes.clientId, clientId),
        ),
      )
      .orderBy(desc(trainerClientNotes.createdAt));
    return rows.map(mapRow);
  }
}
