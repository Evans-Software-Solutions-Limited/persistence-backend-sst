/**
 * Reproducible exercise-library seed (ported from the legacy Supabase repo's
 * supabase/seed.sql + supabase/seed_exercises.sql).
 *
 * Run on a dev/ops machine (NOT Lambda):
 *   DATABASE_URL='<supabase pooled prod URI>' bun run seed:exercises
 *
 * What it does, idempotently and in FK order:
 *   1. Ensures the system user exists (auth.users -> profiles, id = SYSTEM_USER_ID).
 *      exercises.created_by -> profiles.id -> auth.users.id, so the catalogue
 *      rows need this user to exist first.
 *   2. Upserts reference data (muscle_groups, equipment_types, accessibility_tags)
 *      from ../data/reference.json — ON CONFLICT (name) DO NOTHING.
 *   3. Inserts the exercise catalogue from ../data/exercises.json, resolving the
 *      muscle/equipment/accessibility *names* to per-DB UUIDs. Names with no
 *      matching reference row are dropped — this matches the legacy SQL's
 *      `ANY(ARRAY[...])` subselect (and therefore prod) exactly.
 *
 * Idempotency: exercises.name has no unique constraint, so we skip any catalogue
 * exercise whose name already exists for the system user. Re-running is safe and
 * non-destructive (it only inserts what's missing). For a true wipe, reset the DB
 * first. The data files are the source of truth; UUIDs are resolved per-DB.
 */

import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import {
  exercises,
  muscleGroups,
  equipmentTypes,
  accessibilityTags,
  getDb,
} from "@persistence/db";

/**
 * Sentinel UUID for system-authored catalogue rows — must match
 * SYSTEM_USER_ID in microservices/core/src/application/repositories/exerciseRepository.ts.
 * That predicate is load-bearing: the backend treats rows with this created_by
 * as the stock catalogue every user can see. DO NOT change it.
 */
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
const BATCH_SIZE = 500;

type NewExercise = typeof exercises.$inferInsert;

type RefRow = {
  name: string;
  description?: string | null;
  category?: string | null;
};
type Reference = {
  muscleGroups: RefRow[];
  equipmentTypes: RefRow[];
  accessibilityTags: RefRow[];
};
type ExerciseSeed = {
  name: string;
  description: string | null;
  instructions: string | null;
  category: string | null;
  difficultyLevel: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipmentRequired: string[];
  accessibilityRequirements: string[];
};

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;
}

async function ensureSystemUser(db: ReturnType<typeof getDb>): Promise<void> {
  // auth.users first (profiles.id FKs to it). Best-effort: on prod this row
  // already exists so the insert is a no-op; on a fresh local stack it creates
  // the minimal system user. Wrapped because some managed setups restrict DML
  // on the auth schema — if so, the profiles insert below will surface the gap.
  try {
    await db.execute(sql`
      insert into auth.users
        (instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
      values
        ('00000000-0000-0000-0000-000000000000', ${SYSTEM_USER_ID},
         'authenticated', 'authenticated', 'system@persistence.local', '',
         now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
      on conflict (id) do nothing
    `);
  } catch (err) {
    console.warn(
      "[seed:exercises] could not write auth.users system row (may be fine if it already exists):",
      (err as Error).message,
    );
  }
  await db.execute(sql`
    insert into profiles (id, email, full_name, username, role)
    values (${SYSTEM_USER_ID}, 'system@persistence.local', 'System', '__system__', 'admin')
    on conflict (id) do nothing
  `);
}

async function main(): Promise<void> {
  const db = getDb();
  const reference = readJson<Reference>("../data/reference.json");
  const catalogue = readJson<ExerciseSeed[]>("../data/exercises.json");

  console.log("[seed:exercises] ensuring system user…");
  await ensureSystemUser(db);

  // 1. Reference data (idempotent on the unique name column).
  console.log("[seed:exercises] upserting reference data…");
  if (reference.muscleGroups.length)
    await db
      .insert(muscleGroups)
      .values(
        reference.muscleGroups.map((r) => ({
          name: r.name,
          description: r.description ?? null,
        })),
      )
      .onConflictDoNothing({ target: muscleGroups.name });
  if (reference.equipmentTypes.length)
    await db
      .insert(equipmentTypes)
      .values(
        reference.equipmentTypes.map((r) => ({
          name: r.name,
          description: r.description ?? null,
        })),
      )
      .onConflictDoNothing({ target: equipmentTypes.name });
  if (reference.accessibilityTags.length)
    await db
      .insert(accessibilityTags)
      .values(
        reference.accessibilityTags.map((r) => ({
          name: r.name,
          description: r.description ?? null,
          category: r.category ?? null,
        })),
      )
      .onConflictDoNothing({ target: accessibilityTags.name });

  // 2. Build name -> id maps from what's actually in the DB now.
  const [mg, eq2, ac] = await Promise.all([
    db
      .select({ name: muscleGroups.name, id: muscleGroups.id })
      .from(muscleGroups),
    db
      .select({ name: equipmentTypes.name, id: equipmentTypes.id })
      .from(equipmentTypes),
    db
      .select({ name: accessibilityTags.name, id: accessibilityTags.id })
      .from(accessibilityTags),
  ]);
  const muscleId = new Map(mg.map((r) => [r.name, r.id]));
  const equipId = new Map(eq2.map((r) => [r.name, r.id]));
  const accessId = new Map(ac.map((r) => [r.name, r.id]));
  const resolve = (names: string[], map: Map<string, string>): string[] => {
    const out: string[] = [];
    for (const n of names) {
      const id = map.get(n);
      if (id) out.push(id);
    }
    return out;
  };

  // 3. Skip catalogue exercises already present for the system user (idempotent).
  const existingRows = await db
    .select({ name: exercises.name })
    .from(exercises)
    .where(eq(exercises.createdBy, SYSTEM_USER_ID));
  const existing = new Set(existingRows.map((r) => r.name));

  const toInsert: NewExercise[] = catalogue
    .filter((e) => e.name && !existing.has(e.name))
    .map((e) => ({
      name: e.name,
      description: e.description ?? null,
      instructions: e.instructions ?? null,
      category: (e.category ?? "strength") as NewExercise["category"],
      difficultyLevel: (e.difficultyLevel ??
        "beginner") as NewExercise["difficultyLevel"],
      primaryMuscles: resolve(e.primaryMuscles, muscleId),
      secondaryMuscles: resolve(e.secondaryMuscles, muscleId),
      equipmentRequired: resolve(e.equipmentRequired, equipId),
      accessibilityRequirements: resolve(e.accessibilityRequirements, accessId),
      createdBy: SYSTEM_USER_ID,
      isPublic: true,
    }));

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    await db.insert(exercises).values(batch);
    inserted += batch.length;
  }

  console.log(
    `[seed:exercises] done — catalogue=${catalogue.length} alreadyPresent=${existing.size} inserted=${inserted}`,
  );
  // postgres.js keeps the event loop alive; exit explicitly.
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed:exercises] failed", err);
  process.exit(1);
});
