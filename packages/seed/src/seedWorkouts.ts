/**
 * Reproducible "template / example workout" seed (ported verbatim from the
 * legacy Supabase repo's supabase/seed.sql, the system-owned workouts block).
 *
 * Run on a dev/ops machine (NOT Lambda):
 *   DATABASE_URL='<supabase pooled prod URI>' bun run seed:workouts
 *
 * What an "example workout" is: a `workouts` row owned by the SYSTEM user
 * with visibility = 'public', plus its `workout_exercises` children. V2
 * already has the query (GET /workouts?type=default -> visibility='public'
 * AND created_by != caller) and the mobile "Templates/Example" section; only
 * the seed data was missing.
 *
 * What it does, idempotently and in FK order:
 *   1. Ensures the system user exists (auth.users -> profiles, id = SYSTEM_USER_ID) —
 *      workouts.created_by -> profiles.id -> auth.users.id, so the catalogue
 *      rows need this user to exist first.
 *   2. Resolves each workout's exercise *names* against the exercise catalogue
 *      owned by the system user (created_by = SYSTEM_USER_ID). Any name with
 *      no matching exercise row is skipped (logged as a warning) rather than
 *      inserted with a null exercise_id.
 *   3. Inserts each workout (visibility='public') then its workout_exercises,
 *      one transaction per workout so a partial failure doesn't leave an
 *      orphaned parent row.
 *
 * Idempotency: skips any workout whose name already exists for the system
 * user (workouts.createdBy = SYSTEM_USER_ID). Re-running is safe — it only
 * inserts workouts that are missing. The data file is the source of truth;
 * exercise UUIDs are resolved per-DB.
 */

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { workouts, workoutExercises, exercises, getDb } from "@persistence/db";
import { SYSTEM_USER_ID, ensureSystemUser } from "./lib/ensureSystemUser";

type WorkoutExerciseSeed = {
  name: string;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds: number;
  notes: string;
};
type WorkoutSeed = {
  name: string;
  description: string;
  estimatedDurationMinutes: number;
  exercises: WorkoutExerciseSeed[];
};

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;
}

async function main(): Promise<void> {
  const db = getDb();
  const catalogue = readJson<WorkoutSeed[]>("../data/workouts.json");

  console.log("[seed:workouts] ensuring system user…");
  await ensureSystemUser(db);

  // Exercise name -> id, scoped to the system catalogue (matches how these
  // workouts are authored: system workouts reference system exercises).
  const exerciseRows = await db
    .select({ name: exercises.name, id: exercises.id })
    .from(exercises)
    .where(eq(exercises.createdBy, SYSTEM_USER_ID));
  const exerciseId = new Map(exerciseRows.map((r) => [r.name, r.id]));

  // Skip any system workout that already exists (idempotent).
  const existingRows = await db
    .select({ name: workouts.name })
    .from(workouts)
    .where(eq(workouts.createdBy, SYSTEM_USER_ID));
  const existing = new Set(existingRows.map((r) => r.name));

  let inserted = 0;
  let skippedExisting = 0;
  let skippedNoExercises = 0;
  const unresolvedExercises = new Set<string>();

  for (const w of catalogue) {
    if (existing.has(w.name)) {
      skippedExisting += 1;
      continue;
    }

    const resolvedExercises = w.exercises
      .map((e, index) => ({
        ...e,
        sortOrder: index + 1,
        id: exerciseId.get(e.name),
      }))
      .filter((e) => {
        if (!e.id) {
          unresolvedExercises.add(e.name);
          console.warn(
            `[seed:workouts] skipping exercise "${e.name}" for workout "${w.name}" — no matching exercise found for the system user`,
          );
          return false;
        }
        return true;
      });

    // A public, system-owned template with no resolvable exercises is worse
    // than no template — and the skip-by-name guard above would then
    // permanently skip backfilling it. Don't publish an empty workout; a later
    // run (once the exercise catalogue is present) inserts it fresh. This also
    // neutralises the `dataset=workouts` workflow path running before exercises.
    if (!resolvedExercises.length) {
      console.warn(
        `[seed:workouts] skipping workout "${w.name}" — no exercises resolved (is the exercise catalogue seeded?)`,
      );
      skippedNoExercises += 1;
      continue;
    }

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(workouts)
        .values({
          name: w.name,
          description: w.description,
          createdBy: SYSTEM_USER_ID,
          visibility: "public",
          estimatedDurationMinutes: w.estimatedDurationMinutes,
        })
        .returning({ id: workouts.id });

      if (resolvedExercises.length) {
        await tx.insert(workoutExercises).values(
          resolvedExercises.map((e) => ({
            workoutId: row.id,
            exerciseId: e.id as string,
            sortOrder: e.sortOrder,
            targetSets: e.targetSets,
            targetRepsMin: e.targetRepsMin,
            targetRepsMax: e.targetRepsMax,
            restSeconds: e.restSeconds,
            notes: e.notes,
          })),
        );
      }
    });

    inserted += 1;
  }

  console.log(
    `[seed:workouts] done — catalogue=${catalogue.length} alreadyPresent=${skippedExisting} inserted=${inserted} skippedNoExercises=${skippedNoExercises} unresolvedExerciseNames=${unresolvedExercises.size}`,
  );
  // postgres.js keeps the event loop alive; exit explicitly.
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:workouts] failed", err);
  process.exit(1);
});
