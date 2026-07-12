import type { Workout } from "@/domain/models/workout";

/**
 * Pure derivations for the workout-detail hero — muscle pills + the dominant
 * equipment eyebrow token.
 *
 * The V2 `Workout` wire shape carries no muscle/equipment data (the trimmed
 * `WorkoutExerciseRef` has none), so both are DERIVED client-side from the
 * cached exercise library — the same join the Train > Workouts list uses for
 * `classifyWorkoutSplit` (`WorkoutsListContainer`). The caller injects the
 * per-exercise lookups; these functions stay pure + deterministic (no I/O).
 *
 * Equipment: if no exercise resolves an equipment label (library not cached
 * yet, or genuinely bodyweight), `deriveDominantEquipment` returns null and
 * the hero eyebrow renders just "WORKOUT" (per the locked v1 decision — no
 * DTO/backend field added for it).
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/design.md § 10 (Detail hero)
 */

/**
 * Distinct muscle-group labels across the workout's exercises, ordered by how
 * many exercises hit each (desc), ties broken by first appearance. Readable
 * labels only ("Chest", "Back") — the caller passes
 * `exercise.primaryMuscleGroupLabels` from the cache. Empty when nothing is
 * resolvable yet.
 */
export function deriveWorkoutMuscles(
  workout: Workout,
  getMuscleLabels: (exerciseId: string) => readonly string[] | undefined,
): string[] {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  for (const we of workout.exercises) {
    const labels = getMuscleLabels(we.exerciseId);
    if (!labels) continue;
    // A single exercise counts a muscle at most once (a dedup within the
    // exercise) so multi-listed groups don't double-weight.
    const seenThisExercise = new Set<string>();
    for (const raw of labels) {
      const label = raw.trim();
      if (label.length === 0 || seenThisExercise.has(label)) continue;
      seenThisExercise.add(label);
      counts.set(label, (counts.get(label) ?? 0) + 1);
      if (!firstSeen.has(label)) firstSeen.set(label, order++);
    }
  }
  return [...counts.keys()].sort((a, b) => {
    const byCount = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
    if (byCount !== 0) return byCount;
    return (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0);
  });
}

/**
 * The single most common equipment label across the workout's exercises, or
 * null when none resolves. Ties broken by first appearance. The caller passes
 * `exercise.equipmentLabels` (readable) from the cache.
 */
export function deriveDominantEquipment(
  workout: Workout,
  getEquipmentLabels: (exerciseId: string) => readonly string[] | undefined,
): string | null {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;
  for (const we of workout.exercises) {
    const labels = getEquipmentLabels(we.exerciseId);
    if (!labels) continue;
    const seenThisExercise = new Set<string>();
    for (const raw of labels) {
      const label = raw.trim();
      if (label.length === 0 || seenThisExercise.has(label)) continue;
      seenThisExercise.add(label);
      counts.set(label, (counts.get(label) ?? 0) + 1);
      if (!firstSeen.has(label)) firstSeen.set(label, order++);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount &&
        best !== null &&
        (firstSeen.get(label) ?? 0) < (firstSeen.get(best) ?? 0))
    ) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}
