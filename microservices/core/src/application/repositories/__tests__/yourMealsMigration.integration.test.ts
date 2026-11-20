import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  USER_A,
  USER_B,
  YOUR_MEALS_MIGRATION,
  migrationSql,
  resetNutritionSchema,
} from "../../nutrition/__tests__/nutritionTestDb";

/**
 * Design D test 8 — migration 6 (your meals + entries part), applied for real:
 * forward twice, down/up, and existing entries untouched. Plus the index and
 * constraint shapes the repositories depend on (PER-109).
 */

const FORWARD = migrationSql("migrations", YOUR_MEALS_MIGRATION);
const ROLLBACK = migrationSql("rollbacks", YOUR_MEALS_MIGRATION);

const ENTRY_COLUMNS = `id, user_id, food_id, recipe_id, meal_id, meal_slot,
  servings::text, kcal::text, protein_g::text, carbs_g::text, fat_g::text,
  logged_at, logged_by_user_id, ai_estimated, ai_confidence::text, custom_name`;

let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create();
});
afterAll(async () => {
  await pg.close();
});

/** Entries as a 1.2.0 phone logs them today, before the migration exists. */
async function seedExistingEntries(): Promise<void> {
  await pg.exec(`
    INSERT INTO nutrition_entries
      (user_id, meal_slot, servings, kcal, protein_g, carbs_g, fat_g, logged_at, custom_name, ai_estimated, ai_confidence)
    VALUES
      ('${USER_A}', 'breakfast', 1, 320, 20, 40, 9, '2026-11-19T08:00:00Z', 'Porridge', false, NULL),
      ('${USER_A}', 'dinner', 2, 900.5, 55, 80, 30, '2026-11-19T19:00:00Z', NULL, true, 0.8),
      ('${USER_B}', 'snack', 1, 150, 3, 20, 7, '2026-11-19T15:00:00Z', 'Apple', false, NULL);
  `);
}

async function existingEntries(): Promise<unknown[]> {
  const res = await pg.query(
    `SELECT ${ENTRY_COLUMNS} FROM nutrition_entries ORDER BY logged_at`,
  );
  return res.rows;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await pg.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return res.rows.length === 1;
}

async function indexDef(name: string): Promise<string | null> {
  const res = await pg.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes WHERE indexname = $1`,
    [name],
  );
  return res.rows[0]?.indexdef ?? null;
}

async function insertMeal(
  userId: string,
  fields: Partial<{
    name: string;
    log_slot: string;
    default_key: string | null;
    client_request_id: string | null;
  }> = {},
): Promise<string> {
  const res = await pg.query<{ id: string }>(
    `INSERT INTO user_meals (user_id, name, log_slot, default_key, client_request_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      userId,
      fields.name ?? "Pre-workout",
      fields.log_slot ?? "snack",
      fields.default_key ?? null,
      fields.client_request_id ?? null,
    ],
  );
  return res.rows[0]!.id;
}

describe("20261120143109_your_meals_entry_idempotency.sql", () => {
  beforeEach(async () => {
    await resetNutritionSchema(pg, { withYourMeals: false });
    await seedExistingEntries();
  });

  it("applies forward twice and leaves existing entries untouched", async () => {
    const before = await existingEntries();

    await pg.exec(FORWARD);
    await pg.exec(FORWARD);

    expect(await existingEntries()).toEqual(before);
    const added = await pg.query(
      `SELECT user_meal_id, source_plan_id, source_plan_meal_id, client_request_id
       FROM nutrition_entries`,
    );
    expect(added.rows).toHaveLength(3);
    for (const row of added.rows) {
      expect(row).toEqual({
        user_meal_id: null,
        source_plan_id: null,
        source_plan_meal_id: null,
        client_request_id: null,
      });
    }
  });

  it("rolls back and forward again without touching existing entries", async () => {
    const before = await existingEntries();
    await pg.exec(FORWARD);
    const mealId = await insertMeal(USER_A);
    await pg.query(
      `UPDATE nutrition_entries SET user_meal_id = $1, client_request_id = 'k1'
       WHERE custom_name = 'Porridge'`,
      [mealId],
    );

    await pg.exec(ROLLBACK);
    expect(await columnExists("nutrition_entries", "user_meal_id")).toBe(false);
    expect(await columnExists("nutrition_entries", "client_request_id")).toBe(
      false,
    );
    expect(await indexDef("nutrition_entries_user_client_request_idx")).toBe(
      null,
    );
    const tables = await pg.query(
      `SELECT 1 FROM pg_tables WHERE tablename = 'user_meals'`,
    );
    expect(tables.rows).toEqual([]);
    expect(await existingEntries()).toEqual(before);

    await pg.exec(ROLLBACK); // a rollback is re-runnable too
    await pg.exec(FORWARD);
    expect(await existingEntries()).toEqual(before);
    expect(await columnExists("nutrition_entries", "user_meal_id")).toBe(true);
  });

  describe("after migrating", () => {
    beforeEach(async () => {
      await pg.exec(FORWARD);
    });

    it("keeps the entry key index FULL, so Drizzle's predicate-less ON CONFLICT can infer it", async () => {
      const def = await indexDef("nutrition_entries_user_client_request_idx");
      expect(def).toContain("UNIQUE INDEX");
      expect(def).toContain("(user_id, client_request_id)");
      expect(def).not.toContain("WHERE");
      const mealsDef = await indexDef("user_meals_user_client_request_idx");
      expect(mealsDef).toContain("(user_id, client_request_id)");
      expect(mealsDef).not.toContain("WHERE");
      // And the conflict target really resolves (42P10 otherwise).
      await expect(
        pg.query(
          `INSERT INTO nutrition_entries
             (user_id, meal_slot, servings, kcal, protein_g, carbs_g, fat_g, logged_at, client_request_id)
           VALUES ($1, 'lunch', 1, 1, 1, 1, 1, now(), 'key-1')
           ON CONFLICT (user_id, client_request_id) DO NOTHING`,
          [USER_A],
        ),
      ).resolves.toBeDefined();
    });

    it("makes a food-log key unique per user, not globally, and leaves NULL keys free", async () => {
      const insert = (userId: string, key: string | null) =>
        pg.query(
          `INSERT INTO nutrition_entries
             (user_id, meal_slot, servings, kcal, protein_g, carbs_g, fat_g, logged_at, client_request_id)
           VALUES ($1, 'lunch', 1, 1, 1, 1, 1, now(), $2)`,
          [userId, key],
        );
      await insert(USER_A, "same-key");
      await expect(insert(USER_A, "same-key")).rejects.toThrow();
      await expect(insert(USER_B, "same-key")).resolves.toBeDefined();
      await insert(USER_A, null);
      await expect(insert(USER_A, null)).resolves.toBeDefined();
    });

    it("allows one seeded default per key per user, and any number of custom meals", async () => {
      await insertMeal(USER_A, {
        name: "Breakfast",
        log_slot: "breakfast",
        default_key: "breakfast",
      });
      await expect(
        insertMeal(USER_A, {
          name: "Breakfast",
          log_slot: "breakfast",
          default_key: "breakfast",
        }),
      ).rejects.toThrow();
      await expect(
        insertMeal(USER_B, {
          name: "Breakfast",
          log_slot: "breakfast",
          default_key: "breakfast",
        }),
      ).resolves.toBeDefined();
      await insertMeal(USER_A);
      await expect(insertMeal(USER_A)).resolves.toBeDefined();
    });

    it.each([
      ["an empty name", { name: "" }],
      ["a 41-character name", { name: "x".repeat(41) }],
      ["an unknown slot", { log_slot: "brunch" }],
      ["an unknown default key", { default_key: "brunch" }],
    ])("rejects a meal with %s", async (_label, fields) => {
      await expect(insertMeal(USER_A, fields)).rejects.toThrow();
    });

    it("accepts a 40-character name", async () => {
      await expect(
        insertMeal(USER_A, { name: "x".repeat(40) }),
      ).resolves.toBeDefined();
    });

    it("rejects a negative sort order", async () => {
      await expect(
        pg.query(
          `INSERT INTO user_meals (user_id, name, log_slot, sort_order) VALUES ($1, 'x', 'lunch', -1)`,
          [USER_A],
        ),
      ).rejects.toThrow();
    });

    it("keeps a logged entry when its meal row goes (SET NULL), and removes meals with the account", async () => {
      const mealId = await insertMeal(USER_A);
      await pg.query(
        `UPDATE nutrition_entries SET user_meal_id = $1 WHERE custom_name = 'Porridge'`,
        [mealId],
      );
      await pg.query(`DELETE FROM user_meals WHERE id = $1`, [mealId]);
      const entry = await pg.query(
        `SELECT user_meal_id, kcal::text FROM nutrition_entries WHERE custom_name = 'Porridge'`,
      );
      expect(entry.rows).toEqual([{ user_meal_id: null, kcal: "320" }]);

      const lonely = "00000000-0000-4000-8000-0000000000cc";
      await pg.query(`INSERT INTO profiles (id) VALUES ($1)`, [lonely]);
      await insertMeal(lonely);
      await pg.query(`DELETE FROM profiles WHERE id = $1`, [lonely]);
      const left = await pg.query(
        `SELECT 1 FROM user_meals WHERE user_id = $1`,
        [lonely],
      );
      expect(left.rows).toEqual([]);
    });

    it("enables row-level security on user_meals with no policies (service role only)", async () => {
      const rls = await pg.query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'user_meals'`,
      );
      expect(rls.rows).toEqual([{ relrowsecurity: true }]);
      const policies = await pg.query(
        `SELECT 1 FROM pg_policies WHERE tablename = 'user_meals'`,
      );
      expect(policies.rows).toEqual([]);
    });

    it("leaves the old meal_slot CHECK exactly as it was", async () => {
      await expect(
        pg.query(
          `INSERT INTO nutrition_entries
             (user_id, meal_slot, servings, kcal, protein_g, carbs_g, fat_g, logged_at)
           VALUES ($1, 'brunch', 1, 1, 1, 1, 1, now())`,
          [USER_A],
        ),
      ).rejects.toThrow();
    });
  });
});
