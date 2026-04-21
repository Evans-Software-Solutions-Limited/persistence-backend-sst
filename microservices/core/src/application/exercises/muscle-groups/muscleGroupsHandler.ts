import Elysia from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";

/**
 * GET /exercises/muscle-groups — reference-list endpoint.
 *
 * Spec: design.md § Reference-list endpoints · AC 7.9
 *
 * Projects the Drizzle camelCase row into the legacy snake_case wire
 * shape the mobile adapter expects: `{ id, name, display_name }`.
 */
export const muscleGroupsHandler = new Elysia()
  .use(ExerciseService)
  .get("/exercises/muscle-groups", async (ctx) => {
    const rows = await ctx.ExerciseRepository.getMuscleGroups();
    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        display_name: row.displayName,
      })),
    };
  });
