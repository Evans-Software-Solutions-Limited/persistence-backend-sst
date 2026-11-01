import { and, eq } from "drizzle-orm";
import { exercises, type TogetherExerciseDefinition } from "@persistence/db";
import { requireTogether, type TogetherTx } from "./shared";
import { SYSTEM_USER_ID } from "../repositories/exerciseRepository";
/**
 * The exercise fields a Together snapshot captures at authorization time
 * (PER-60). Every caller that authorizes an exercise selects these, so a
 * partner's copy reflects what they were allowed to see then, not later edits.
 */
export const togetherDefinitionColumns = {
  name: exercises.name,
  category: exercises.category,
  primaryMuscles: exercises.primaryMuscles,
  createdBy: exercises.createdBy,
  description: exercises.description,
  instructions: exercises.instructions,
  difficultyLevel: exercises.difficultyLevel,
  secondaryMuscles: exercises.secondaryMuscles,
  equipmentRequired: exercises.equipmentRequired,
  videoUrl: exercises.videoUrl,
  thumbnailUrl: exercises.thumbnailUrl,
};
type DefinitionRow = {
  [K in keyof typeof togetherDefinitionColumns]:
    | (typeof togetherDefinitionColumns)[K]["_"]["data"]
    | null;
};
export function togetherDefinition(
  row: DefinitionRow,
): TogetherExerciseDefinition {
  return {
    ...row,
    name: row.name!,
    primaryMuscles: row.primaryMuscles ?? [],
  };
}
/** Caller supplies a definition captured only after shared exercise visibility authorization. */
export async function materializeTogetherExercise(
  tx: TogetherTx,
  userId: string,
  sourceId: string,
  definition: TogetherExerciseDefinition,
) {
  requireTogether(definition, "INVALID_STATE", 409);
  const [source] = await tx
    .select({ id: exercises.id, createdBy: exercises.createdBy })
    .from(exercises)
    .where(eq(exercises.id, sourceId))
    .for("key share");
  if (
    source &&
    (source.createdBy === null ||
      source.createdBy === SYSTEM_USER_ID ||
      source.createdBy === userId)
  ) {
    definition.recordingExerciseId = source.id;
    return source.id;
  }
  // Foreign custom exercises get an independently owned copy even while
  // the source exists: a later creator purge must not cascade this result.
  // The copy is made from the authorized snapshot only, never the live row,
  // so edits made after access ended never reach it (PER-60). Never public,
  // and never the source's own idempotency key.
  const clientRequestId = `together-recovery:${sourceId}`;
  await tx
    .insert(exercises)
    .values({
      name: definition.name,
      category: definition.category,
      primaryMuscles: definition.primaryMuscles,
      description: definition.description ?? null,
      instructions: definition.instructions ?? null,
      difficultyLevel: definition.difficultyLevel ?? undefined,
      secondaryMuscles: definition.secondaryMuscles ?? [],
      equipmentRequired: definition.equipmentRequired ?? [],
      videoUrl: definition.videoUrl ?? null,
      thumbnailUrl: definition.thumbnailUrl ?? null,
      createdBy: userId,
      clientRequestId,
      isPublic: false,
    })
    .onConflictDoNothing({
      target: [exercises.createdBy, exercises.clientRequestId],
    });
  const [copy] = await tx
    .select({ id: exercises.id })
    .from(exercises)
    .where(
      and(
        eq(exercises.createdBy, userId),
        eq(exercises.clientRequestId, clientRequestId),
      ),
    )
    .for("key share");
  requireTogether(copy, "INVALID_STATE", 409);
  definition.recordingExerciseId = copy.id;
  return copy.id;
}
