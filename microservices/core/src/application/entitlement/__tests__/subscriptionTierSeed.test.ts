import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Workout Authoring v2 D8: coaches/trainers get UNLIMITED workouts. That is
// pure tier config — every trainer tier is seeded with workout_limit = NULL
// (unlimited). This guard reads the authoritative seed and fails if anyone
// ever caps a trainer tier, which would silently start 402-ing coaches on
// POST /workouts. There is no runtime change to lock, so we lock the SEED.
//
// Row shape in 004 (VALUES tuple, one field-line per row):
//   <workout_limit>, <ai_access>, <ai_workout_limit>, <gym_buddy_access>,
//   <gym_buddy_can_create>, <gym_buddy_can_suggest>, <trainer_client_limit>,
//   <is_trainer_tier>,
// i.e. workout_limit is the FIRST field and is_trainer_tier the LAST on the
// line. When is_trainer_tier is true, workout_limit must be NULL.

function findSeedFile(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const rel =
    "../../../../../../supabase/migrations/004_subscriptions_and_roles.sql";
  const direct = resolve(here, rel);
  if (existsSync(direct)) return direct;
  // Fallback: walk up until we find the migrations dir (robust to layout).
  let dir = here;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(
      dir,
      "supabase/migrations/004_subscriptions_and_roles.sql",
    );
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("Could not locate 004_subscriptions_and_roles.sql");
}

// Matches the 8-field VALUES field-line: workout_limit first, is_trainer_tier
// last (all on one line, trailing comma before the features JSON on the next
// line).
const FIELD_LINE =
  /^(NULL|\d+),\s*(?:true|false),\s*\d+,\s*(?:true|false),\s*(?:true|false),\s*(?:true|false),\s*(?:NULL|\d+),\s*(true|false),$/;

describe("subscription_tiers seed — trainer tiers are unlimited (D8)", () => {
  const sql = readFileSync(findSeedFile(), "utf8");
  const rows = sql
    .split("\n")
    .map((l) => l.trim())
    .map((l) => l.match(FIELD_LINE))
    .filter((m): m is RegExpMatchArray => m !== null);

  it("parses the seeded tier field-lines", () => {
    // Sanity: the free/basic/premium + 6 trainer rows = 9 tuples.
    expect(rows.length).toBe(9);
  });

  it("every trainer tier (is_trainer_tier = true) has workout_limit = NULL", () => {
    const trainerRows = rows.filter((m) => m[2] === "true");
    // 6 trainer tiers seeded (individual/small/medium × standard/pro).
    expect(trainerRows.length).toBe(6);
    for (const m of trainerRows) {
      expect(m[1]).toBe("NULL");
    }
  });

  it("only the free tier carries a finite workout_limit", () => {
    const finite = rows.filter((m) => m[1] !== "NULL");
    expect(finite).toHaveLength(1);
    expect(finite[0][1]).toBe("3");
    // ...and it is NOT a trainer tier.
    expect(finite[0][2]).toBe("false");
  });
});
