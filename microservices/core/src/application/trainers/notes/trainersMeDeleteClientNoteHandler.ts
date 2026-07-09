import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { deleteClientNoteOnBehalf } from "./deleteClientNote";

/**
 * DELETE /trainers/me/clients/:clientId/notes/:noteId — a coach deletes one of
 * their own notes for a client. 404 `note_not_found` if it isn't theirs / for
 * this client. Core: `deleteClientNoteOnBehalf`.
 */
export const trainersMeDeleteClientNoteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .delete(
    "/trainers/me/clients/:clientId/notes/:noteId",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId, noteId } = ctx.params as {
        clientId: string;
        noteId: string;
      };

      const result = await deleteClientNoteOnBehalf({
        trainerId,
        clientId,
        noteId,
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }

      return { data: { deleted: true } };
    },
    {
      params: t.Object({
        clientId: t.String({ minLength: 1 }),
        noteId: t.String({ minLength: 1 }),
      }),
    },
  );
