/**
 * Phase E eval — in-memory stand-in for stage 1's SQL library.
 *
 * The exercise library the eval ranks over is the SEEDED catalogue
 * (`packages/seed/data/exercises.json`, 2281 rows) resolved through
 * `reference.json`'s `equipmentTypes` EXACTLY the way `seedExercises.ts`
 * resolves it — `resolve()` there silently DROPS an equipment name with no
 * `equipment_types` row (`packages/seed/src/seedExercises.ts:123-130`), so a
 * faithful eval must drop them too. Two rows lose their only requirement that
 * way; see `equipmentUnmapped` and README § Data-quality findings.
 *
 * Ids are slugs of the exercise name rather than uuids. The eval never touches
 * a database, and stage 1's real behaviour (containment + muscle overlap +
 * visibility) is not id-shaped. Every seeded row is `is_public = true` and owned
 * by the system user, so the visibility predicate is a no-op across this
 * corpus — recorded in the verdict as a limitation of the fixture, not of the
 * design.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Difficulty = "beginner" | "intermediate" | "advanced";

export type Exercise = {
  id: string;
  name: string;
  category: string;
  difficulty: Difficulty;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  /** Resolved against `equipment_types` — unmapped names dropped (seeder parity). */
  equipmentRequired: string[];
  /** Names the seeder would drop. Non-empty means the row under-declares its kit. */
  equipmentUnmapped: string[];
};

type SeedExercise = {
  name: string;
  category?: string;
  difficultyLevel?: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipmentRequired: string[];
};

const SEED_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "packages",
  "seed",
  "data",
);

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type Library = {
  exercises: Exercise[];
  byId: Map<string, Exercise>;
  byName: Map<string, Exercise>;
  equipmentTypes: { name: string; category: string }[];
};

/** Mirrors `20260726120300_equipment_types_category.sql` — six groups. */
const EQUIPMENT_CATEGORY: Record<string, string> = {
  Barbell: "free_weights",
  Dumbbells: "free_weights",
  Kettlebell: "free_weights",
  "EZ Bar": "free_weights",
  "Medicine Ball": "free_weights",
  Bench: "free_weights",
  "Squat Rack": "free_weights",
  "Smith Machine": "machines",
  "Leg Press Machine": "machines",
  "Leg Curl Machine": "machines",
  "Leg Extension Machine": "machines",
  "Cable Machine": "cables",
  "Lat Pulldown Machine": "cables",
  Bodyweight: "bodyweight",
  "Pull-up Bar": "bodyweight",
  "Dip Station": "bodyweight",
  "TRX / Suspension Trainer": "bodyweight",
  "Ab Wheel": "bodyweight",
  "Rowing Machine": "cardio",
  Treadmill: "cardio",
  "Exercise Bike": "cardio",
  Elliptical: "cardio",
  "Resistance Bands": "accessories",
  "Foam Roller": "accessories",
  "Yoga Mat": "accessories",
  "Box / Step": "accessories",
  "Battle Ropes": "accessories",
  Sled: "accessories",
};

export function loadLibrary(): Library {
  const seed = JSON.parse(
    readFileSync(join(SEED_DIR, "exercises.json"), "utf8"),
  ) as SeedExercise[];
  const reference = JSON.parse(
    readFileSync(join(SEED_DIR, "reference.json"), "utf8"),
  ) as { equipmentTypes: { name: string }[] };

  const known = new Set(reference.equipmentTypes.map((r) => r.name));

  const exercises: Exercise[] = [];
  const seenIds = new Set<string>();
  for (const row of seed) {
    const id = slugify(row.name);
    // The real table has a uuid PK and no name-uniqueness constraint; two
    // catalogue rows could slug-collide. Suffix rather than silently overwrite.
    let uniqueId = id;
    let n = 2;
    while (seenIds.has(uniqueId)) uniqueId = `${id}-${n++}`;
    seenIds.add(uniqueId);

    exercises.push({
      id: uniqueId,
      name: row.name,
      category: row.category ?? "strength",
      difficulty: (row.difficultyLevel ?? "beginner") as Difficulty,
      primaryMuscles: row.primaryMuscles,
      secondaryMuscles: row.secondaryMuscles,
      equipmentRequired: row.equipmentRequired.filter((e) => known.has(e)),
      equipmentUnmapped: row.equipmentRequired.filter((e) => !known.has(e)),
    });
  }

  return {
    exercises,
    byId: new Map(exercises.map((e) => [e.id, e])),
    byName: new Map(exercises.map((e) => [e.name, e])),
    equipmentTypes: reference.equipmentTypes.map((r) => ({
      name: r.name,
      category: EQUIPMENT_CATEGORY[r.name] ?? "other",
    })),
  };
}

/**
 * Stage 1's containment predicate, in TypeScript:
 * `context::uuid[] @> COALESCE(equipment_required, '{}')` (design § 6.1).
 * `x @> '{}'` is always true, so a row with no declared kit passes every
 * context — correct for bodyweight, and the mechanism by which the two
 * unmapped-equipment rows leak (README § Data-quality findings).
 */
export function isLegal(
  exercise: Exercise,
  context: ReadonlySet<string>,
): boolean {
  return exercise.equipmentRequired.every((e) => context.has(e));
}
