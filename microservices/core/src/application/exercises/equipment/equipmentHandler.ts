import Elysia from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";

/**
 * GET /exercises/equipment — reference-list endpoint.
 *
 * Spec: design.md § Reference-list endpoints · AC 7.9
 *
 * The equipment_types table has no `display_name` column; we project
 * `display_name: null` so every reference-list endpoint yields a
 * consistent { id, name, display_name } shape. Mobile falls back to
 * `name` when `display_name` is null.
 *
 * `category` (spec-21 § 2.3b, AC-2.2) lets Loadout's equipment picker group its
 * chips from the API instead of a hardcoded client-side list. Nullable and
 * additive — existing consumers ignore the extra field, and a row with no
 * category renders under "Other" rather than vanishing from the picker.
 */
export const equipmentHandler = new Elysia()
  .use(ExerciseService)
  .get("/exercises/equipment", async (ctx) => {
    const equipment = await ctx.ExerciseRepository.getEquipmentTypes();
    return {
      data: equipment.map((row) => ({
        id: row.id,
        name: row.name,
        display_name: null,
        // `?? null` so the key is ALWAYS present on the wire. A bare
        // `undefined` is dropped by JSON serialisation, and the picker's
        // "Other" bucket keys off an explicit null rather than a missing field.
        category: row.category ?? null,
      })),
    };
  });
