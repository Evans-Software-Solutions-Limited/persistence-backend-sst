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
 */
export const equipmentHandler = new Elysia()
  .use(ExerciseService)
  .get("/exercises/equipment", async (ctx) => {
    const equipment = await ctx.ExerciseRepository.getEquipmentTypes();
    return {
      data: equipment.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        display_name: null,
      })),
    };
  });
