import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Loadout (spec-21) Phase 0 ships four migrations. CI never executes SQL and
// `getDb` is mocked in every unit test, so nothing else in this repo would catch
// a wrong FK action, a non-idempotent statement, or an accidental duplicate
// index. Each assertion below locks a decision whose reversal is a real defect,
// not a style preference. Precedent: `premiumPlusTierMigration.test.ts`.
//
// Every assertion runs against COMMENT-STRIPPED SQL. The comment prose in these
// files deliberately names the things being asserted ("ON DELETE SET NULL",
// "no new index"), so a test reading the raw text could pass on the explanation
// while the statement itself was wrong.

const MIGRATIONS = {
  savedGyms: "20260726120000_saved_gyms.sql",
  workoutLinkage: "20260726120100_workouts_loadout_variations.sql",
  provenance: "20260726120200_workout_exercises_provenance.sql",
  equipmentCategory: "20260726120300_equipment_types_category.sql",
} as const;

function migrationDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, "supabase/migrations");
    if (existsSync(resolve(candidate, MIGRATIONS.savedGyms))) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("Could not locate supabase/migrations");
}

/** File contents with every `--` comment line removed. */
function read(name: string): string {
  const sql = readFileSync(resolve(migrationDir(), name), "utf8");
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
}

describe("saved_gyms migration", () => {
  const sql = read(MIGRATIONS.savedGyms);

  it("creates the table idempotently", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS saved_gyms");
  });

  it("cascades on profile delete — a deleted account leaves no orphan gyms", () => {
    expect(sql).toMatch(
      /user_id\s+uuid NOT NULL REFERENCES profiles\(id\) ON DELETE CASCADE/,
    );
  });

  // AC-7.4. The index must be case- AND whitespace-insensitive, or "Hotel gym"
  // and "hotel gym " become two gyms. It must also be NAMED, because the
  // repository maps a unique violation to 409 by matching the constraint name.
  it("enforces per-user name uniqueness case- and whitespace-insensitively", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS saved_gyms_user_name_key",
    );
    expect(sql).toMatch(/ON saved_gyms \(user_id, lower\(btrim\(name\)\)\)/);
  });

  it("defaults the kit to an empty array, not NULL", () => {
    // A NULL uuid[] would make `@>` containment checks return NULL in Phase 1 —
    // the same NULL-propagation class of bug the exercise repository already
    // documents for equipment_required.
    expect(sql).toMatch(/equipment_type_ids uuid\[\] NOT NULL DEFAULT '\{\}'/);
  });

  it("backs the list query with a (user_id, created_at DESC) index", () => {
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS saved_gyms_user_created_idx",
    );
  });

  // RLS-on with zero policies = closed to PostgREST, open to the backend's
  // RLS-bypassing pooler connection. Without it, any `authenticated` Supabase
  // user could read every other user's gyms over the auto-generated REST API.
  it("enables RLS and declares no policy", () => {
    expect(sql).toContain("ALTER TABLE saved_gyms ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toContain("CREATE POLICY");
  });
});

describe("workouts variation-linkage migration", () => {
  const sql = read(MIGRATIONS.workoutLinkage);

  it("adds all four columns idempotently", () => {
    for (const col of [
      "parent_workout_id",
      "variation_kind",
      "source_gym_id",
      "source_equipment_type_ids",
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  // The single most consequential line in the file. CASCADE would delete a
  // user's whole set of adapted workouts behind one parent delete; RESTRICT
  // would make any adapted workout undeletable. SET NULL promotes variations to
  // standalone workouts, which is what makes the `parent IS NULL` library
  // predicate correct (AC-5.4).
  it("uses ON DELETE SET NULL on the parent FK, never CASCADE", () => {
    expect(sql).toMatch(
      /parent_workout_id uuid\s+REFERENCES workouts\(id\) ON DELETE SET NULL/,
    );
    expect(sql).not.toMatch(/REFERENCES workouts\(id\) ON DELETE CASCADE/);
  });

  // AC-7.3: deleting a saved gym must not delete the variations built from it.
  it("uses ON DELETE SET NULL on the saved-gym FK", () => {
    expect(sql).toMatch(
      /source_gym_id uuid\s+REFERENCES saved_gyms\(id\) ON DELETE SET NULL/,
    );
  });

  // A bare `ALTER TABLE … ADD CONSTRAINT` is NOT idempotent and fails on a
  // re-run, which would break a replayed migration set.
  it("adds the variation_kind CHECK inside a pg_constraint existence guard", () => {
    expect(sql).toContain("SELECT 1 FROM pg_constraint WHERE conname =");
    expect(sql).toContain("workouts_variation_kind_check");
    expect(sql).toMatch(
      /CHECK \(variation_kind IS NULL OR variation_kind IN \('loadout'\)\)/,
    );
  });

  it("indexes the parent FK partially", () => {
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS workouts_parent_idx");
    expect(sql).toContain("WHERE parent_workout_id IS NOT NULL");
  });
});

describe("workout_exercises provenance migration", () => {
  const sql = read(MIGRATIONS.provenance);

  it("adds all three provenance columns idempotently", () => {
    for (const col of [
      "substituted_from_exercise_id",
      "substitution_reason",
      "is_user_override",
    ]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  // jsonb, not text (design § 7.2): the reason is a structured, localisable code
  // `{ code, missingEquipment, matchedOn }`. text would force JSON-in-string.
  it("stores the reason as jsonb", () => {
    expect(sql).toMatch(/substitution_reason jsonb/);
    expect(sql).not.toMatch(/substitution_reason text/);
  });

  // SET NULL, not CASCADE: deleting the exercise that was swapped OUT must not
  // delete the row that replaced it.
  it("uses ON DELETE SET NULL on the substituted-from FK", () => {
    expect(sql).toMatch(
      /substituted_from_exercise_id uuid\s+REFERENCES exercises\(id\) ON DELETE SET NULL/,
    );
  });

  it("defaults is_user_override to false and NOT NULL", () => {
    expect(sql).toMatch(/is_user_override boolean NOT NULL DEFAULT false/);
  });

  // 001_initial_schema.sql:699-702 already creates two workout_id indexes plus a
  // composite. `CREATE INDEX IF NOT EXISTS` matches on NAME, not definition, so
  // a differently-named index here would silently become a THIRD duplicate on a
  // hot write path.
  it("creates NO index at all", () => {
    expect(sql).not.toContain("CREATE INDEX");
    expect(sql).not.toContain("CREATE UNIQUE INDEX");
  });
});

describe("equipment_types.category migration", () => {
  const sql = read(MIGRATIONS.equipmentCategory);

  it("adds the column idempotently and nullable", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS category text");
    // Nullable on purpose — an uncategorised row renders under "Other" rather
    // than disappearing from the picker (AC-2.2).
    expect(sql).not.toMatch(/category text NOT NULL/);
  });

  it("backfills into the six agreed groups", () => {
    for (const group of [
      "free_weights",
      "machines",
      "cables",
      "bodyweight",
      "cardio",
      "accessories",
    ]) {
      expect(sql).toContain(`SET category = '${group}'`);
    }
  });

  // Two-way idempotency: `WHERE category IS NULL` makes a re-run a no-op AND
  // stops it stomping a row somebody has since recategorised by hand.
  it("guards every backfill on category IS NULL", () => {
    const updates = sql.split("\n").filter((l) => l.includes("SET category ="));
    expect(updates.length).toBe(6);
    const guards = sql
      .split("\n")
      .filter((l) => l.includes("WHERE category IS NULL"));
    expect(guards.length).toBe(6);
  });

  // Bands are one of Loadout's four canonical equipment contexts ("bands only",
  // requirements § Eval spike) — they must not be left uncategorised.
  it("categorises resistance bands", () => {
    expect(sql).toContain("'Resistance Bands'");
  });

  it("covers all 28 seeded equipment names exactly once", () => {
    const seeded = [
      "Barbell",
      "Dumbbells",
      "Kettlebell",
      "Resistance Bands",
      "Pull-up Bar",
      "Bench",
      "Cable Machine",
      "Smith Machine",
      "Squat Rack",
      "Leg Press Machine",
      "Leg Curl Machine",
      "Leg Extension Machine",
      "Lat Pulldown Machine",
      "Rowing Machine",
      "Treadmill",
      "Exercise Bike",
      "Elliptical",
      "Medicine Ball",
      "Foam Roller",
      "Yoga Mat",
      "Box / Step",
      "TRX / Suspension Trainer",
      "EZ Bar",
      "Dip Station",
      "Bodyweight",
      "Battle Ropes",
      "Sled",
      "Ab Wheel",
    ];

    for (const name of seeded) {
      const occurrences = sql.split(`'${name}'`).length - 1;
      // Exactly once: zero means the row stays uncategorised and lands in
      // "Other"; twice means it is claimed by two groups and the second UPDATE's
      // `category IS NULL` guard silently drops it, making the grouping depend
      // on statement order.
      expect(
        occurrences,
        `${name} should appear exactly once, found ${occurrences}`,
      ).toBe(1);
    }
  });
});
