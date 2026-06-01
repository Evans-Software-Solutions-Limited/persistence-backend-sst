import {
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUPS,
  type MuscleGroup,
} from "@/domain/models/exercise";
import type { Workout } from "@/domain/models/workout";

/**
 * Workout split classification — drives the colored tile + badge on the
 * Train > Workouts rows (prototype-hubs.jsx `TrainWorkoutsContent`).
 *
 * The V2 `Workout` wire shape carries no split field, and the trimmed
 * `WorkoutExerciseRef` has no muscle groups — so the split is DERIVED
 * client-side from the cached exercise library: each exercise's `category`
 * (on the workout ref) gives a cardio/mobility override, and the cached
 * library supplies the muscle groups used to resolve the PPL / upper / lower
 * / full / core splits.
 *
 * IMPORTANT: `Exercise.primaryMuscleGroups` holds DB **UUIDs** at runtime,
 * not enum keys — the readable values live in `primaryMuscleGroupLabels`.
 * So callers pass whatever muscle tokens they have (labels and/or enum keys
 * and/or UUIDs); `normaliseMuscle` maps labels + enum keys back to the
 * `MuscleGroup` enum and drops anything unresolvable (UUIDs without a label).
 * An exercise that resolves to zero regions is excluded from the tally
 * rather than diluting it (which previously sank every workout to `full`).
 *
 * Pure + deterministic — no I/O. The caller injects `getMuscleTokens`.
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

type Region = "push" | "pull" | "legs" | "core";

const REGION_MUSCLES: Record<Region, ReadonlySet<MuscleGroup>> = {
  push: new Set<MuscleGroup>(["chest", "shoulders", "triceps"]),
  pull: new Set<MuscleGroup>(["back", "lats", "biceps", "traps", "forearms"]),
  legs: new Set<MuscleGroup>([
    "quadriceps",
    "hamstrings",
    "glutes",
    "calves",
    "hip_flexors",
    "abductors",
    "adductors",
  ]),
  core: new Set<MuscleGroup>(["core"]),
};

const ENUM_KEYS = new Set<string>(MUSCLE_GROUPS);
const LABEL_TO_GROUP = new Map<string, MuscleGroup>(
  MUSCLE_GROUPS.map((g) => [MUSCLE_GROUP_LABELS[g], g]),
);

/** Resolve a muscle token (enum key OR display label) to the enum; UUIDs
 * (and anything else) resolve to `undefined`. */
function normaliseMuscle(token: string): MuscleGroup | undefined {
  if (ENUM_KEYS.has(token)) return token as MuscleGroup;
  return LABEL_TO_GROUP.get(token);
}

function regionOf(group: MuscleGroup): Region | undefined {
  if (REGION_MUSCLES.push.has(group)) return "push";
  if (REGION_MUSCLES.pull.has(group)) return "pull";
  if (REGION_MUSCLES.legs.has(group)) return "legs";
  if (REGION_MUSCLES.core.has(group)) return "core";
  return undefined;
}

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
 * (no exercises, or no muscle data resolvable + no category majority).
 *
 * `getMuscleTokens(exerciseId)` returns that exercise's muscle tokens — any
 * mix of display labels ("Chest"), enum keys ("chest"), or UUIDs. Labels +
 * enum keys are matched; UUIDs are ignored.
 *
 * Priority (per owner direction — PPL specifics beat upper/lower so a pure
 * push day reads PUSH, not UPPER):
 *   cardio/mobility category majority → legs/lower → push → pull → upper →
 *   full → core → full (mixed fallback).
 */
export function classifyWorkoutSplit(
  workout: Workout,
  getMuscleTokens: (exerciseId: string) => readonly string[] | undefined,
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

  // Muscle-based pass — needs the cached library. Only exercises that
  // resolve to ≥1 region count toward `total` (unresolved UUID-only rows
  // are skipped so they don't drag the fractions down).
  let total = 0;
  let push = 0;
  let pull = 0;
  let legs = 0;
  let core = 0;
  for (const we of exercises) {
    const tokens = getMuscleTokens(we.exerciseId);
    if (!tokens || tokens.length === 0) continue;
    const regions = new Set<Region>();
    for (const token of tokens) {
      const group = normaliseMuscle(token);
      if (!group) continue;
      const region = regionOf(group);
      if (region) regions.add(region);
    }
    if (regions.size === 0) continue;
    total += 1;
    if (regions.has("push")) push += 1;
    if (regions.has("pull")) pull += 1;
    if (regions.has("legs")) legs += 1;
    if (regions.has("core")) core += 1;
  }
  if (total === 0) return null; // muscle data not resolvable yet → fallback

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
