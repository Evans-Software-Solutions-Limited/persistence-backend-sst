import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { updateClientNoteOnBehalf } from "./updateClientNote";
import type { NoteType } from "../../repositories/noteRepository";

const NOTE_TYPE_SCHEMA = t.Union([
  t.Literal("progress"),
  t.Literal("injury"),
  t.Literal("milestone"),
  t.Literal("concern"),
  t.Literal("general"),
]);

/**
 * PUT /trainers/me/clients/:clientId/notes/:noteId — a coach edits one of their
 * own notes for a client. 404 `note_not_found` if the note isn't theirs / for
 * this client; 400 `no_fields` on an empty patch. Core: `updateClientNoteOnBehalf`.
 */
export const trainersMeUpdateClientNoteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .put(
    "/trainers/me/clients/:clientId/notes/:noteId",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId, noteId } = ctx.params as {
        clientId: string;
        noteId: string;
      };
      const body = ctx.body as {
        content?: string;
        title?: string;
        noteType?: NoteType;
      };

      const result = await updateClientNoteOnBehalf({
        trainerId,
        clientId,
        noteId,
        body,
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }

      return { data: result.note };
    },
    {
      params: t.Object({
        clientId: t.String({ minLength: 1 }),
        noteId: t.String({ minLength: 1 }),
      }),
      body: t.Object({
        content: t.Optional(t.String()),
        title: t.Optional(t.String()),
        noteType: t.Optional(NOTE_TYPE_SCHEMA),
      }),
    },
  );
