import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  ACCOUNT_DELETION_STEPS,
  buildStatement,
  type AccountDeletionStep,
} from "../accountDeletionPlan";

const dialect = new PgDialect();
const render = (step: AccountDeletionStep, userId: string) =>
  dialect.sqlToQuery(buildStatement(step, userId));

describe("ACCOUNT_DELETION_STEPS", () => {
  it("deletes the profile row LAST so the cascade FKs fire after the NO-ACTION cleanup", () => {
    const last = ACCOUNT_DELETION_STEPS[ACCOUNT_DELETION_STEPS.length - 1];
    expect(last).toEqual({ kind: "delete", table: "profiles", column: "id" });
    // `profiles` must appear exactly once, and only as the final step.
    const profileSteps = ACCOUNT_DELETION_STEPS.filter(
      (s) => s.table === "profiles",
    );
    expect(profileSteps).toHaveLength(1);
  });

  it("nullifies every cross-user attribution column (NO ACTION on other users' rows)", () => {
    const nullified = ACCOUNT_DELETION_STEPS.filter(
      (s) => s.kind === "nullify",
    ).map((s) => `${s.table}.${s.column}`);
    expect(nullified).toEqual([
      "body_measurements.logged_by_user_id",
      "workout_sessions.logged_by_user_id",
      "nutrition_entries.logged_by_user_id",
      "nutrition_targets.set_by_user_id",
      "user_goals.assigned_by_user_id",
      "subscription_price_history.changed_by",
    ]);
  });

  it("deletes the user's own rows behind NO-ACTION FKs (children cascade off these)", () => {
    const deletedOwners = ACCOUNT_DELETION_STEPS.filter(
      (s) => s.kind === "delete" && s.table !== "profiles",
    ).map((s) => `${s.table}.${s.column}`);
    expect(deletedOwners).toEqual([
      "nutrition_entries.user_id",
      "water_log.user_id",
      "meals.user_id",
      "recipes.user_id",
      "foods.created_by",
      "nutrition_targets.user_id",
      "ai_usage_log.user_id",
      "subscription_status_transitions.user_id",
      "trainer_actions_audit.trainer_id",
      "trainer_actions_audit.client_id",
      "client_ai_summaries.trainer_id",
      "client_ai_summaries.client_id",
    ]);
  });

  it("deletes trainer_actions_audit + client_ai_summaries on BOTH the trainer_id and client_id side (Coach-Mode crash fix — the deleting user can be either party) BEFORE the final profiles delete", () => {
    const tableNames = ACCOUNT_DELETION_STEPS.map((s) => s.table);
    const profilesIdx = tableNames.lastIndexOf("profiles");

    for (const table of ["trainer_actions_audit", "client_ai_summaries"]) {
      const steps = ACCOUNT_DELETION_STEPS.filter(
        (s) => s.kind === "delete" && s.table === table,
      );
      expect(steps.map((s) => (s as { column: string }).column).sort()).toEqual(
        ["client_id", "trainer_id"],
      );
      const idxs = ACCOUNT_DELETION_STEPS.reduce<number[]>((acc, s, i) => {
        if (s.kind === "delete" && s.table === table) acc.push(i);
        return acc;
      }, []);
      for (const idx of idxs) {
        expect(idx).toBeLessThan(profilesIdx);
      }
    }
  });

  it("nullifies cross-user references to owned rows (NO-ACTION FKs on other users' children)", () => {
    const refOwned = ACCOUNT_DELETION_STEPS.filter(
      (s) => s.kind === "nullify-referencing-owned",
    );
    expect(refOwned).toEqual([
      {
        kind: "nullify-referencing-owned",
        table: "recipe_ingredients",
        column: "food_id",
        ownerTable: "foods",
        ownerColumn: "created_by",
      },
    ]);
  });

  it("nullifies recipe_ingredients.food_id BEFORE deleting foods", () => {
    const nullRefIdx = ACCOUNT_DELETION_STEPS.findIndex(
      (s) =>
        s.kind === "nullify-referencing-owned" &&
        s.table === "recipe_ingredients",
    );
    const foodsDeleteIdx = ACCOUNT_DELETION_STEPS.findIndex(
      (s) => s.kind === "delete" && s.table === "foods",
    );
    expect(nullRefIdx).toBeGreaterThan(-1);
    expect(nullRefIdx).toBeLessThan(foodsDeleteIdx);
  });

  it("orders meals/recipes before foods so recipe_ingredients/meal_items clear first", () => {
    const order = ACCOUNT_DELETION_STEPS.filter((s) => s.kind === "delete").map(
      (s) => s.table,
    );
    expect(order.indexOf("meals")).toBeLessThan(order.indexOf("foods"));
    expect(order.indexOf("recipes")).toBeLessThan(order.indexOf("foods"));
  });
});

describe("buildStatement", () => {
  it("renders a parameterized DELETE with a quoted identifier and no value interpolation", () => {
    const { sql, params } = render(
      { kind: "delete", table: "profiles", column: "id" },
      "user-123",
    );
    expect(sql).toBe('delete from "profiles" where "id" = $1');
    expect(params).toEqual(["user-123"]);
    expect(sql).not.toContain("user-123");
  });

  it("renders a parameterized UPDATE … SET NULL for attribution nullify steps", () => {
    const { sql, params } = render(
      {
        kind: "nullify",
        table: "nutrition_entries",
        column: "logged_by_user_id",
      },
      "user-123",
    );
    expect(sql).toBe(
      'update "nutrition_entries" set "logged_by_user_id" = null where "logged_by_user_id" = $1',
    );
    expect(params).toEqual(["user-123"]);
  });

  it("renders a subquery-based SET NULL for nullify-referencing-owned steps", () => {
    const { sql, params } = render(
      {
        kind: "nullify-referencing-owned",
        table: "recipe_ingredients",
        column: "food_id",
        ownerTable: "foods",
        ownerColumn: "created_by",
      },
      "user-123",
    );
    expect(sql).toBe(
      'update "recipe_ingredients" set "food_id" = null where "food_id" in (select id from "foods" where "created_by" = $1)',
    );
    expect(params).toEqual(["user-123"]);
  });
});
