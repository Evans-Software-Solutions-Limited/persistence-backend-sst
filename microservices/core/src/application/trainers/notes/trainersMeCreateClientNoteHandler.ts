import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { createClientNoteOnBehalf } from "./createClientNote";
import type { NoteType } from "../../repositories/noteRepository";

const NOTE_TYPE_SCHEMA = t.Union([
  t.Literal("progress"),
  t.Literal("injury"),
  t.Literal("milestone"),
  t.Literal("concern"),
  t.Literal("general"),
]);

/**
 * POST /trainers/me/clients/:clientId/notes — a coach adds a PRIVATE note to a
 * client they train (Phase 12). Authorization + insert + audit live in the
 * shared `createClientNoteOnBehalf` core.
 */
export const trainersMeCreateClientNoteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/trainers/me/clients/:clientId/notes",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };
      const body = ctx.body as {
        content: string;
        title?: string;
        noteType?: NoteType;
      };

      const result = await createClientNoteOnBehalf({
        trainerId,
        clientId,
        body,
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }

      ctx.set.status = 201;
      return { data: result.note };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      body: t.Object({
        content: t.String({ minLength: 1 }),
        title: t.Optional(t.String()),
        noteType: t.Optional(NOTE_TYPE_SCHEMA),
      }),
    },
  );
