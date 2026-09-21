import { and, eq } from "drizzle-orm";
import { exercises, type TogetherExerciseDefinition } from "@persistence/db";
import { requireTogether, type TogetherTx } from "./shared";
import { SYSTEM_USER_ID } from "../repositories/exerciseRepository";
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
  const clientRequestId = `together-recovery:${sourceId}`;
  await tx
    .insert(exercises)
    .values({
      createdBy: userId,
      clientRequestId,
      name: definition.name,
      category: definition.category,
      primaryMuscles: definition.primaryMuscles,
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
