import type { MuscleGroup } from "@/domain/models/exercise";
import type { Workout } from "@/domain/models/workout";

/**
 * Workout split classification — drives the colored tile + badge on the
 * Train > Workouts rows (prototype-hubs.jsx `TrainWorkoutsContent`).
 *
 * The V2 `Workout` wire shape carries no category/split field, and the
 * trimmed `WorkoutExerciseRef` has no muscle groups — so the split is
 * DERIVED client-side: each exercise's `category` (on the workout ref) gives
 * a cardio/mobility override, and the cached exercise library supplies the
 * primary muscle groups used to resolve the PPL / upper / lower / full / core
 * splits. When muscle data isn't cached yet (cold start) the classifier
 * returns `null` and the row falls back to a neutral tile with no badge.
 *
 * Pure + deterministic — no I/O. The caller injects `getMuscles` (a lookup
 * over the cached library).
 */

export type WorkoutSplit =
  | "push"
  | "pull"
  | "legs"
  | "upper"
  | "lower"
  | "full"
  | "core"
  | "mobility"
  | "cardio";

/** Short uppercase badge label per split (prototype: PUSH / PULL / FULL / MOB). */
export const SPLIT_BADGE: Record<WorkoutSplit, string> = {
  push: "PUSH",
  pull: "PULL",
  legs: "LEGS",
  upper: "UPPER",
  lower: "LOWER",
  full: "FULL",
  core: "CORE",
  mobility: "MOB",
  cardio: "CARDIO",
};

const PUSH_MUSCLES = new Set<MuscleGroup>(["chest", "shoulders", "triceps"]);
const PULL_MUSCLES = new Set<MuscleGroup>([
  "back",
  "lats",
  "biceps",
  "traps",
  "forearms",
]);
const LEGS_MUSCLES = new Set<MuscleGroup>([
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "hip_flexors",
  "abductors",
  "adductors",
]);
const CORE_MUSCLES = new Set<MuscleGroup>(["core"]);

/** Categories that read as a "mobility" day (vs strength/PPL). */
const MOBILITY_CATEGORIES = new Set<string>([
  "flexibility",
  "mobility",
  "balance",
]);

/** A muscle region counts as "active" when it's hit by ≥ this fraction of
 * the workout's (muscle-resolved) exercises. */
const ACTIVE_THRESHOLD = 0.34;

/**
 * Classify a workout into a split, or `null` when there isn't enough signal
 * (no exercises, or no muscle data cached + no category majority).
 *
 * Priority (per owner direction — PPL specifics beat upper/lower so a pure
 * push day reads as PUSH, not UPPER):
 *   cardio/mobility category majority → legs/lower → push → pull → upper →
 *   full → core → full (mixed fallback).
 */
export function classifyWorkoutSplit(
  workout: Workout,
  getMuscles: (exerciseId: string) => readonly MuscleGroup[] | undefined,
): WorkoutSplit | null {
  const exercises = workout.exercises;
  if (exercises.length === 0) return null;

  // Category override — available on the workout exercise ref (no cache
  // needed). A strict majority wins so a 50/50 mixed day falls through to
  // the muscle-based pass.
  let cardio = 0;
  let mobility = 0;
  let categorised = 0;
  for (const we of exercises) {
    const cat = we.exercise?.category;
    if (!cat) continue;
    categorised += 1;
    if (cat === "cardio") cardio += 1;
    else if (MOBILITY_CATEGORIES.has(cat)) mobility += 1;
  }
  if (categorised > 0) {
    if (cardio / categorised > 0.5) return "cardio";
    if (mobility / categorised > 0.5) return "mobility";
  }

  // Muscle-based pass — needs the cached library.
  let total = 0;
  let push = 0;
  let pull = 0;
  let legs = 0;
  let core = 0;
  for (const we of exercises) {
    const muscles = getMuscles(we.exerciseId);
    if (!muscles || muscles.length === 0) continue;
    total += 1;
    if (muscles.some((m) => PUSH_MUSCLES.has(m))) push += 1;
    if (muscles.some((m) => PULL_MUSCLES.has(m))) pull += 1;
    if (muscles.some((m) => LEGS_MUSCLES.has(m))) legs += 1;
    if (muscles.some((m) => CORE_MUSCLES.has(m))) core += 1;
  }
  if (total === 0) return null; // muscle data not cached yet → fallback

  const pushA = push / total >= ACTIVE_THRESHOLD;
  const pullA = pull / total >= ACTIVE_THRESHOLD;
  const legsA = legs / total >= ACTIVE_THRESHOLD;
  const coreA = core / total >= ACTIVE_THRESHOLD;

  if (legsA && !pushA && !pullA) return coreA ? "lower" : "legs";
  if (pushA && !pullA && !legsA) return "push";
  if (pullA && !pushA && !legsA) return "pull";
  if (pushA && pullA && !legsA) return "upper";
  if ((pushA || pullA) && legsA) return "full";
  if (coreA && !pushA && !pullA && !legsA) return "core";
  return "full";
}
