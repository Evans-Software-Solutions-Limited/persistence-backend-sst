/**
 * Exercise-catalogue muscle names (`muscle_groups.name`, seeded from
 * `packages/seed/data/reference.json`) → the app's muscle keys, which is
 * what `muscleCredit` takes. Mirrors the phone's read path
 * (`resolveMuscles` in `domain/services/workoutSummary.ts`): `Abs` is
 * `core`; the two rows the app has no key for shade their nearest one
 * (`Obliques` → core, `Lower Back` → back); `Full Body` earns nothing.
 */
const CATALOGUE_MUSCLE_KEY: Readonly<Record<string, string>> = {
  chest: "chest",
  back: "back",
  shoulders: "shoulders",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  abs: "core",
  obliques: "core",
  "lower back": "back",
  quadriceps: "quadriceps",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
  "hip flexors": "hip_flexors",
  traps: "traps",
  lats: "lats",
};

/** A catalogue muscle name (any case) as an app muscle key, or null. */
export function muscleKeyFromCatalogueName(
  name: string | null | undefined,
): string | null {
  const key = name?.trim().toLowerCase();
  return (key && CATALOGUE_MUSCLE_KEY[key]) || null;
}

/** App muscle key → catalogue name, for seeding test databases. */
export const CATALOGUE_NAME_FOR_KEY: Readonly<Record<string, string>> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  core: "Abs",
  quadriceps: "Quadriceps",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  hip_flexors: "Hip Flexors",
  traps: "Traps",
  lats: "Lats",
};
