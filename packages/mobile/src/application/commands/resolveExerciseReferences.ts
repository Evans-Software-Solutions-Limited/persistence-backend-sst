import {
  looksLikeUuidArray,
  resolveEquipmentIds,
  resolveMuscleGroupIds,
} from "@/domain/services/exerciseCatalogue";
import type { StoragePort } from "@/domain/ports/storage.port";

/** Wire fields on an `/exercises` body that carry catalogue references. */
const MUSCLE_FIELDS = ["primary_muscles", "secondary_muscles"] as const;
const EQUIPMENT_FIELDS = ["equipment_required"] as const;

export type ExercisePayloadResolution =
  | { status: "resolved"; payload: Record<string, unknown> }
  | { status: "unchanged"; payload: Record<string, unknown> }
  /**
   * The reference catalogue isn't cached yet, so the enum members cannot be
   * translated. The caller must DEFER the entry (keep it retryable), never send
   * it — sending would 422 and, being a 4xx, would be classified permanent and
   * strand the user's exercise for good.
   */
  | { status: "catalogue_unavailable"; kinds: string[] }
  /**
   * The catalogue is present but one or more members have no row. This is a
   * data/mapping bug, not a transient condition, and it is reported loudly
   * rather than silently dropping the member — the T-E.10 lesson.
   */
  | { status: "unresolvable"; unresolved: string[] };

/**
 * Translate the domain enum members in a queued `/exercises` payload into
 * catalogue UUIDs, immediately before the drain sends it.
 *
 * Resolution happens HERE rather than at enqueue time for two reasons:
 *
 *  1. The reference catalogue is fetched lazily by whichever screen needs it
 *     (`useReferenceLists` is mounted by the exercise library, Loadout and Saved
 *     Gyms — not at bootstrap), so at the moment a user saves an exercise the
 *     catalogue may never have been loaded. Resolving at send time means the
 *     payload waits for the catalogue instead of being frozen wrong.
 *  2. It retroactively repairs entries queued by earlier builds. A user who
 *     already hit the 422 has the enum-shaped payload sitting in their queue;
 *     once it is reset from the sync-failed screen it now resolves and lands.
 *
 * Idempotent: a payload whose arrays are already UUIDs is returned unchanged, so
 * a re-read after a partial rewrite (or a payload from a future build that
 * resolves earlier) is not "resolved" twice.
 */
export function resolveExercisePayloadReferences(
  storage: StoragePort,
  payload: Record<string, unknown>,
): ExercisePayloadResolution {
  const muscleFieldsPresent = MUSCLE_FIELDS.filter((f) =>
    Array.isArray(payload[f]),
  );
  const equipmentFieldsPresent = EQUIPMENT_FIELDS.filter((f) =>
    Array.isArray(payload[f]),
  );

  // Nothing to translate: a PATCH that touches only name/instructions.
  if (muscleFieldsPresent.length === 0 && equipmentFieldsPresent.length === 0) {
    return { status: "unchanged", payload };
  }

  // Already-resolved (or empty) arrays need no catalogue. Checking this BEFORE
  // reading the cache matters: otherwise a payload that needs no work would be
  // deferred forever on a device whose catalogue never loaded.
  const needsMuscles = muscleFieldsPresent.filter((f) => {
    const arr = payload[f] as unknown[];
    return arr.length > 0 && !looksLikeUuidArray(arr);
  });
  const needsEquipment = equipmentFieldsPresent.filter((f) => {
    const arr = payload[f] as unknown[];
    return arr.length > 0 && !looksLikeUuidArray(arr);
  });
  if (needsMuscles.length === 0 && needsEquipment.length === 0) {
    return { status: "unchanged", payload };
  }

  const missingKinds: string[] = [];
  const muscleEntries =
    needsMuscles.length > 0
      ? storage.getCachedReferenceList("muscle_groups")?.entries
      : [];
  const equipmentEntries =
    needsEquipment.length > 0
      ? storage.getCachedReferenceList("equipment")?.entries
      : [];
  if (needsMuscles.length > 0 && (muscleEntries?.length ?? 0) === 0) {
    missingKinds.push("muscle_groups");
  }
  if (needsEquipment.length > 0 && (equipmentEntries?.length ?? 0) === 0) {
    missingKinds.push("equipment");
  }
  if (missingKinds.length > 0) {
    return { status: "catalogue_unavailable", kinds: missingKinds };
  }

  const next: Record<string, unknown> = { ...payload };
  const unresolved: string[] = [];

  for (const field of needsMuscles) {
    const result = resolveMuscleGroupIds(
      muscleEntries ?? [],
      (payload[field] as unknown[]).filter(
        (v): v is string => typeof v === "string",
      ),
    );
    unresolved.push(...result.unresolved);
    next[field] = result.ids;
  }
  for (const field of needsEquipment) {
    const result = resolveEquipmentIds(
      equipmentEntries ?? [],
      (payload[field] as unknown[]).filter(
        (v): v is string => typeof v === "string",
      ),
    );
    unresolved.push(...result.unresolved);
    next[field] = result.ids;
  }

  // Fail loudly on an unmapped member instead of sending a shorter array. A
  // partial send is worse than a visible failure: the exercise would be created
  // with a muscle group or its equipment silently missing, and nothing would
  // ever tell the user or us.
  if (unresolved.length > 0) {
    return { status: "unresolvable", unresolved: [...new Set(unresolved)] };
  }

  return { status: "resolved", payload: next };
}
