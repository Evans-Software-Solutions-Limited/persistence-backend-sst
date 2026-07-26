import Elysia, { t } from "elysia";
import { SavedGymService } from "../../repositories/savedGymService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * DELETE /saved-gyms/:id — Loadout (spec-21) AC-7.1 / AC-7.3.
 *
 * Variations built from this gym SURVIVE the delete: `workouts.source_gym_id` is
 * `ON DELETE SET NULL` and each variation keeps the frozen
 * `source_equipment_type_ids` snapshot it was adapted for, so it can still say
 * what kit it was built for after the gym is gone.
 *
 * Ownership is in the DELETE's WHERE — another user's gym is `404`, and so is a
 * concurrent double-delete (rather than a 500).
 */
export const savedGymsDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SavedGymService)
  .delete(
    "/saved-gyms/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const deleted = await ctx.SavedGymRepository.delete(
        ctx.params.id,
        userId,
      );

      if (!deleted) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Saved gym not found" };
      }

      return { data: { deleted: true } };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  );
