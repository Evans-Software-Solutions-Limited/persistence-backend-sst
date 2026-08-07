import Elysia, { t } from "elysia";
import { SavedGymService } from "../../repositories/savedGymService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  assertEntitlement,
  EntitlementError,
} from "../../entitlement/assertEntitlement";

/**
 * POST /saved-gyms — create a named equipment set for the caller.
 *
 * Loadout (spec-21) AC-2.4 / AC-7.1 / AC-7.4.
 *
 * - `409` on a duplicate name. Uniqueness is per-user, case- and
 *   whitespace-insensitive, and enforced by the `saved_gyms_user_name_key`
 *   expression index — so two concurrent creates of "Hotel gym" cannot both
 *   win (the repository catches the unique violation rather than pre-checking).
 * - `400` naming the unknown ids when the kit references equipment that isn't
 *   in `equipment_types`. There is no FK to lean on: Postgres has no
 *   array-element FKs.
 * - An EMPTY kit is allowed here. A saved gym with nothing in it is a
 *   half-finished setup the user can come back to; it is the ADAPTATION that
 *   rejects an empty equipment context (AC-2.5, Phase 1).
 */
export const savedGymsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SavedGymService)
  .post(
    "/saved-gyms",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const verdict = await assertEntitlement(userId, "loadout");
      if (!verdict.allowed) throw new EntitlementError(verdict, "loadout");
      const { name, equipmentTypeIds } = ctx.body;

      if (name.trim().length === 0) {
        ctx.set.status = 400;
        return { error: "Gym name is required" };
      }

      const result = await ctx.SavedGymRepository.create(userId, {
        name,
        equipmentTypeIds: equipmentTypeIds ?? [],
      });

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
      ctx.set.status = 201;
      return { data: result.gym };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 120 }),
        // `format: "uuid"` keeps a malformed id a 422 at the edge rather than a
        // Postgres 22P02 deeper in (which the global error handler would map to
        // 400, but with a far less useful body).
        equipmentTypeIds: t.Optional(t.Array(t.String({ format: "uuid" }))),
      }),
    },
  );
