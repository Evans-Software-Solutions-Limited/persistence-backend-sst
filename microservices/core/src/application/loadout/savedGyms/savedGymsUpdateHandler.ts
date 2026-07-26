import Elysia, { t } from "elysia";
import { SavedGymService } from "../../repositories/savedGymService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * PATCH /saved-gyms/:id — rename a gym and/or change its kit.
 *
 * Loadout (spec-21) AC-7.1. Present-only: an omitted field is left untouched.
 *
 * Ownership is folded into the UPDATE's WHERE inside the repository, so another
 * user's gym and a nonexistent gym are BOTH `404` — the caller cannot tell them
 * apart, which is the intended data-isolation posture (no 403/404 distinction).
 *
 * Re-kitting a gym does NOT re-adapt the variations built from it: variations
 * are point-in-time snapshots (`source_equipment_type_ids`), and
 * auto-re-adaptation is an explicit non-goal.
 */
export const savedGymsUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SavedGymService)
  .patch(
    "/saved-gyms/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { name, equipmentTypeIds } = ctx.body;

      if (name === undefined && equipmentTypeIds === undefined) {
        ctx.set.status = 400;
        return { error: "Nothing to update" };
      }
      if (name !== undefined && name.trim().length === 0) {
        ctx.set.status = 400;
        return { error: "Gym name is required" };
      }

      const result = await ctx.SavedGymRepository.update(
        ctx.params.id,
        userId,
        // Rebuilt rather than spread so an explicit `undefined` in the body
        // can't turn into a present-but-undefined patch key.
        {
          ...(name !== undefined ? { name } : {}),
          ...(equipmentTypeIds !== undefined ? { equipmentTypeIds } : {}),
        },
      );

      if (result.status === "duplicate_name") {
        ctx.set.status = 409;
        return {
          code: "SAVED_GYM_NAME_TAKEN",
          message: "You already have a saved gym with that name",
        };
      }
      if (result.status === "unknown_equipment") {
        ctx.set.status = 400;
        return {
          code: "UNKNOWN_EQUIPMENT_TYPE",
          message: "One or more equipment types do not exist",
          unknownEquipmentTypeIds: result.unknownEquipmentTypeIds,
        };
      }
      if (result.status === "not_found") {
        ctx.set.status = 404;
        return { code: "not_found", message: "Saved gym not found" };
      }

      return { data: result.gym };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
        equipmentTypeIds: t.Optional(t.Array(t.String({ format: "uuid" }))),
      }),
    },
  );
