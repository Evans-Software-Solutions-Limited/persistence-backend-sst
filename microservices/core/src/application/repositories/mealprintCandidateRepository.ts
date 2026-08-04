import { and, eq, gt, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { foods, meals, recipes } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { LOCALE_OFF_TAG } from "../nutrition/mealprint/preferences/vocabulary";
import type { SupportedLocale } from "../nutrition/mealprint/preferences/vocabulary";

/**
 * Mealprint (spec-26 design § 1 stage 1) — CANDIDATE ASSEMBLY.
 *
 * Stage 1 of the pipeline: build, deterministically and in SQL, the set of
 * things the model is allowed to choose from. The model never names a food; it
 * returns ids from this list, every id is re-resolved server-side, and every
 * macro is recomputed from these rows. "Accuracy is a database property, not a
 * model property."
 *
 * ## The SQL / JS split, and why it is not arbitrary
 *
 * SQL does the CHEAP, CONSERVATIVE narrowing — locale, provenance, a macro-fit
 * window, and a coarse forbidden-allergen-tag exclusion. `avoidanceFilter` then
 * applies the EXACT semantics in JS: tag interpretability, dietary patterns,
 * free-from negation, dislike name matching.
 *
 * The division is safe in one direction only, and that direction is deliberate:
 * SQL may let through a row JS will reject (JS is authoritative and runs on
 * every row), but SQL must never reject a row JS would keep for a reason JS
 * cannot see. That is why the allergen predicate here is a plain tag-overlap
 * exclusion and not an attempt to reimplement interpretability in SQL — and why
 * the same `avoidanceFilter` call runs again after the model, so the two passes
 * cannot drift apart.
 *
 * ⚠ **This means the SQL cap is applied BEFORE the precise filter**, so a
 * heavily-restricted user can end up with a thin pool even though the raw
 * catalogue is large. `assembleSuggestCandidates` therefore over-fetches and
 * reports what it dropped, rather than silently returning six candidates.
 */

/** One thing the model may select, with everything needed to re-resolve it. */
export interface MealprintCandidate {
  kind: "food" | "recipe" | "meal";
  id: string;
  name: string;
  /**
   * Macros for ONE SERVING of this candidate — already scaled out of the
   * per-100g basis for foods. The model multiplies by a servings count; the
   * server recomputes from these numbers, never from anything the model returns.
   */
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Human serving description for the prompt ("220 g", "1 serving"). */
  servingLabel: string;
  /** ⚠ `null` = UNKNOWN. Never `[]`. Fed straight to `avoidanceFilter`. */
  allergenTags: string[] | null;
  categoryTags: string[] | null;
  /** TRUE for the caller's own rows — used for the like/own bias in the prompt. */
  isOwn: boolean;
}

/**
 * How many rows the CURATED-catalogue query pulls before the precise filter
 * runs. Larger than the final cap on purpose (see the class docstring): the
 * exact filter can reject most of a page, and a user with allergen chips plus a
 * dietary pattern is exactly the person who must not be handed a six-item pool.
 */
export const CURATED_FETCH_LIMIT = 600;

/** Per-user row caps. Own data is small; these only bound a pathological account. */
export const OWN_FOOD_LIMIT = 200;
export const OWN_RECIPE_LIMIT = 100;
export const OWN_MEAL_LIMIT = 100;

export interface CuratedQueryInput {
  locale: SupportedLocale;
  /** Serving kcal ceiling — a candidate that alone blows the budget is noise. */
  maxServingKcal: number;
  /** OFF allergen tags to exclude by overlap. Empty = no allergen constraint. */
  forbiddenAllergenTags: string[];
  /** When true, rows with UNKNOWN (`NULL`) allergen tags are excluded in SQL. */
  requireKnownAllergens: boolean;
  limit?: number;
}

/**
 * Render a JS string array as a Postgres `ARRAY[...]::text[]` literal.
 *
 * ⚠ **Do NOT interpolate the array directly.** ``sql`${arr}::text[]` `` renders a
 * parenthesised placeholder list — a ROW constructor — and dies at execution
 * (`cannot cast type record to text[]`, or `malformed array literal` at arity
 * one). This is the exact trap `uuidArray()` in `exerciseRepository.ts` exists
 * for; it 500'd Loadout's preview on device, and two call sites carried the bug
 * for three months because nothing executed them. Same shape, different element
 * type, so it gets its own helper rather than a cast through the uuid one.
 */
export function textArray(values: readonly string[]) {
  if (values.length === 0) {
    // `ARRAY[]` is untyped and Postgres rejects it; the empty case is guarded by
    // the callers, but returning a typed empty literal makes this total.
    return sql`ARRAY[]::text[]`;
  }
  const parts = values.map((value) => sql`${value}`);
  return sql`ARRAY[${sql.join(parts, sql`, `)}]::text[]`;
}

export class MealprintCandidateRepository {
  static readonly key = "MealprintCandidateRepository";

  /**
   * The locale-curated catalogue slice (AC 7.3). Only non-user rows tagged for
   * the locale — so a user's private foods cannot leak into another user's pool,
   * and a US-only staple cannot be suggested to a UK athlete.
   */
  buildCuratedWhere(input: CuratedQueryInput) {
    const localeTag = LOCALE_OFF_TAG[input.locale];
    const conditions = [
      // Curated provenance only. `foods.source` is 'user' | 'openfoodfacts' |
      // 'ai_recognized'; the last is someone's photo guess, which has no
      // catalogue standing and no tags, so it is excluded here and reaches the
      // pool only via the owner's own-foods query.
      eq(foods.source, "openfoodfacts"),
      // Locale containment. NULL locale_tags are excluded by `&&` semantics,
      // which is correct: an untagged row has no established UK availability.
      sql`${foods.localeTags} && ${textArray([localeTag])}`,
      // Zero-kcal rows (water, spices, some drinks) can never help hit a macro
      // target and only consume prompt budget.
      gt(foods.kcal, "0"),
      // One serving must not alone exceed the budget. `serving_quantity` is the
      // real pack serving in grams when OFF has it; macros are per-100g, so the
      // serving's kcal is kcal * q / 100.
      // ⚠ Divided by `serving_size`, NOT a hardcoded 100 — it must agree with
      // `toFoodCandidate`, which scales by `quantity / serving_size`. The two
      // coincide only when `serving_size = 100`, which holds for every OFF row
      // and NOT for a user's own food: a row with `serving_size = 500,
      // kcal = 100` has a real per-serving figure of 100 kcal but was filtered
      // as 500 (excluded from a budget it fits), and `serving_size = 30,
      // kcal = 150` was filtered as 45 (let into a budget it blows).
      lte(
        sql`${foods.kcal} * COALESCE(${foods.servingQuantity}, ${foods.servingSize}) / NULLIF(${foods.servingSize}, 0)`,
        sql`${input.maxServingKcal}`,
      ),
    ];

    if (input.requireKnownAllergens) {
      // ⚠ Fail closed in SQL as well as in JS. Fetching unknown-tag rows only to
      // have `avoidanceFilter` reject every one of them would spend the whole
      // fetch limit on rows that cannot be used — the pool would come back empty
      // for the exact users who most need it to be full.
      conditions.push(isNotNull(foods.allergenTags));
    }

    if (input.forbiddenAllergenTags.length > 0) {
      // Coarse exclusion. Interpretability and pattern rules are JS's job.
      //
      // ⚠ THE `IS NULL OR` IS LOAD-BEARING, and its absence broke this class's
      // own stated invariant ("SQL must never reject a row JS would keep").
      // Postgres three-valued logic: `NULL && ARRAY[…]` is NULL, `NOT NULL` is
      // NULL, and a NULL predicate EXCLUDES the row. The handler builds
      // `forbiddenAllergenTags` from allergen chips UNION dietary-pattern tags,
      // while `requireKnownAllergens` is true only for allergen chips — so a
      // user with `dietaryPatterns: ['vegan']` and no allergen chip got a
      // non-empty forbidden list with `requireKnownAllergens: false`, and every
      // untagged row was silently dropped in SQL even though `avoidanceFilter`
      // would have kept it. Pre-backfill, when ALL ~144k rows are NULL, that is
      // an empty pool and a `no_candidates` 200 for every pattern user.
      conditions.push(
        sql`(${foods.allergenTags} IS NULL OR NOT (${foods.allergenTags} && ${textArray(input.forbiddenAllergenTags)}))`,
      );
    }

    return and(...conditions);
  }

  /**
   * Curated candidates, ordered by PROTEIN DENSITY descending.
   *
   * ⚠ This ordering is a product judgement and should be read as one. The
   * catalogue is ~144k rows and cannot be fetched whole, so something has to
   * choose which 600 the model sees. Protein-per-kcal is that choice because the
   * requirement this feature exists for is stated in those terms — "hitting
   * protein with the calories left after dinner is a puzzle" (requirements §
   * Overview) — and because in a lifting app protein is nearly always the binding
   * macro. It is NOT claimed to be optimal for every run: a user who asked for
   * "something sweet" is served by the model's selection over this pool, not by
   * the retrieval. If suggestion quality disappoints, this ordering is the first
   * thing to measure, and it should be measured rather than argued about.
   *
   * Ordering is deterministic (protein density, then id) so the same request
   * twice sees the same pool — a prerequisite for any eval of the stage above it.
   */
  async listCuratedCandidates(
    input: CuratedQueryInput,
  ): Promise<MealprintCandidate[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: foods.id,
        name: foods.name,
        brand: foods.brand,
        kcal: foods.kcal,
        proteinG: foods.proteinG,
        carbsG: foods.carbsG,
        fatG: foods.fatG,
        servingSize: foods.servingSize,
        servingUnit: foods.servingUnit,
        servingQuantity: foods.servingQuantity,
        allergenTags: foods.allergenTags,
        categoryTags: foods.categoryTags,
      })
      .from(foods)
      .where(this.buildCuratedWhere(input))
      .orderBy(
        sql`${foods.proteinG} / NULLIF(${foods.kcal}, 0) DESC`,
        sql`${foods.id} ASC`,
      )
      .limit(input.limit ?? CURATED_FETCH_LIMIT);

    return rows.map((row) => toFoodCandidate(row, false));
  }

  /**
   * The caller's OWN foods — every source, including `ai_recognized`, because a
   * food the user themselves logged is one they eat. `created_by = userId` is the
   * whole authorization story: there is no branch of this query that can return
   * another user's private row.
   */
  async listOwnFoodCandidates(
    userId: string,
    maxServingKcal: number,
  ): Promise<MealprintCandidate[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: foods.id,
        name: foods.name,
        brand: foods.brand,
        kcal: foods.kcal,
        proteinG: foods.proteinG,
        carbsG: foods.carbsG,
        fatG: foods.fatG,
        servingSize: foods.servingSize,
        servingUnit: foods.servingUnit,
        servingQuantity: foods.servingQuantity,
        allergenTags: foods.allergenTags,
        categoryTags: foods.categoryTags,
      })
      .from(foods)
      .where(
        and(
          eq(foods.createdBy, userId),
          // Own rows are not required to be locale-tagged (they never are) but
          // the same budget and non-zero rules apply.
          gt(foods.kcal, "0"),
          // Same `serving_size` divisor as the curated query — and this is the
          // path where it actually matters, because own foods are the rows whose
          // `serving_size` is not 100.
          lte(
            sql`${foods.kcal} * COALESCE(${foods.servingQuantity}, ${foods.servingSize}) / NULLIF(${foods.servingSize}, 0)`,
            sql`${maxServingKcal}`,
          ),
          // A user CAN own a row whose source is 'user' or 'ai_recognized'; an
          // 'openfoodfacts' row is never owned, but the predicate is harmless and
          // documents the intent.
          or(ne(foods.source, "openfoodfacts"), isNotNull(foods.createdBy)),
        ),
      )
      .limit(OWN_FOOD_LIMIT);

    return rows.map((row) => toFoodCandidate(row, true));
  }

  /**
   * The caller's saved recipes. Macros are per-serving, materialised on write.
   *
   * ⚠ `maxServingKcal` is applied IN THE MAP, not in SQL, and that is forced by
   * the data: the comparable figure is `total_kcal / servings`, which only exists
   * after the divide-by-zero guard below has run. Filtering on `total_kcal` in SQL
   * would reject a 6-serving batch-cook whose per-serving figure fits.
   *
   * Without the filter at all, a user with 250 kcal left and a library of
   * 600-kcal saved meals got a pool the verifier then rejected wholesale for
   * `kcal_overshoot` — a 422 that consumed a daily run for a state that was
   * knowable before the model was ever called. Both foods queries already
   * enforced this ceiling; recipes and meals bypassed it.
   */
  async listOwnRecipeCandidates(
    userId: string,
    maxServingKcal: number,
  ): Promise<MealprintCandidate[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        servings: recipes.servings,
        totalKcal: recipes.totalKcal,
        totalProteinG: recipes.totalProteinG,
        totalCarbsG: recipes.totalCarbsG,
        totalFatG: recipes.totalFatG,
      })
      .from(recipes)
      .where(and(eq(recipes.userId, userId), isNotNull(recipes.totalKcal)))
      .limit(OWN_RECIPE_LIMIT);

    return rows
      .map((row): MealprintCandidate | null => {
        // `servings` guards a divide-by-zero AND a nonsense per-serving figure.
        const servings = Number(row.servings);
        if (!Number.isFinite(servings) || servings <= 0) return null;
        const kcal = Number(row.totalKcal) / servings;
        if (!Number.isFinite(kcal) || kcal <= 0) return null;
        if (kcal > maxServingKcal) return null;
        return {
          kind: "recipe",
          id: row.id,
          name: row.name,
          kcal,
          proteinG: Number(row.totalProteinG ?? 0) / servings,
          carbsG: Number(row.totalCarbsG ?? 0) / servings,
          fatG: Number(row.totalFatG ?? 0) / servings,
          servingLabel: "1 serving",
          // ⚠ A recipe has no OFF tags, so its allergen content is UNKNOWN and
          // `avoidanceFilter` will exclude it from any allergen-filtered pool.
          // That is the correct answer for a free-text recipe: we cannot vouch
          // for what is in it. Deriving tags from its ingredient rows is a real
          // improvement and a separate slice — it needs the ingredient join and
          // a decision about partially-tagged ingredients.
          allergenTags: null,
          categoryTags: null,
          isOwn: true,
        };
      })
      .filter(
        (candidate): candidate is MealprintCandidate => candidate !== null,
      );
  }

  /**
   * The caller's saved meal presets. Macros are absolute, not per-serving.
   *
   * ⚠ Same `maxServingKcal` reasoning as `listOwnRecipeCandidates` — see there.
   * Applied in the map for symmetry and because the finite/positive guard has to
   * run first regardless.
   */
  async listOwnMealCandidates(
    userId: string,
    maxServingKcal: number,
  ): Promise<MealprintCandidate[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: meals.id,
        name: meals.name,
        totalKcal: meals.totalKcal,
        totalProteinG: meals.totalProteinG,
        totalCarbsG: meals.totalCarbsG,
        totalFatG: meals.totalFatG,
      })
      .from(meals)
      .where(eq(meals.userId, userId))
      .limit(OWN_MEAL_LIMIT);

    return rows
      .map((row): MealprintCandidate | null => {
        const kcal = Number(row.totalKcal);
        if (!Number.isFinite(kcal) || kcal <= 0) return null;
        if (kcal > maxServingKcal) return null;
        return {
          kind: "meal",
          id: row.id,
          name: row.name,
          kcal,
          proteinG: Number(row.totalProteinG),
          carbsG: Number(row.totalCarbsG),
          fatG: Number(row.totalFatG),
          servingLabel: "1 portion",
          allergenTags: null,
          categoryTags: null,
          isOwn: true,
        };
      })
      .filter(
        (candidate): candidate is MealprintCandidate => candidate !== null,
      );
  }

  /**
   * Re-resolve specific ids to authoritative per-serving macros — the ACCEPT and
   * SWAP paths' recompute step (spec-26 design § 3: "server re-verifies +
   * recomputes before insert; clients never set macros").
   *
   * ⚠ **This is the boundary that makes a stored plan trustworthy.** The mobile
   * client posts references — `{ foodId, servings }`, a recipe id, a meal id —
   * and never numbers. Every macro written to `meal_plan_meals` is derived here
   * from the DB row. A handler that trusted a client-supplied `kcal` would let a
   * user (or a stale cache, or a replayed request) store 3000 kcal as 300 and
   * silently corrupt their own adherence data.
   *
   * ⚠ **No `maxServingKcal` filter, deliberately** — unlike the four `list*`
   * methods. Those are assembling a pool to offer, where an item that alone
   * blows the day's budget is noise. This method answers "what IS this id",
   * and applying a budget ceiling here would silently drop a meal the user has
   * explicitly chosen, producing a plan quietly missing rows. Budget fit is the
   * verifier's job, not the resolver's.
   *
   * ⚠ **Ownership: recipes and meals are scoped to `userId`; foods are NOT.**
   * That asymmetry is correct and matches the `list*` methods — the `foods`
   * catalogue is shared (every OFF row is readable by everyone), while recipes
   * and meals are personal. A missing id is simply absent from the result, so
   * the caller decides whether that is a 400 or a dropped row.
   */
  async resolveByIds(
    userId: string,
    ids: { foodIds?: string[]; recipeIds?: string[]; mealIds?: string[] },
  ): Promise<MealprintCandidate[]> {
    const db = getDb();
    const foodIds = [...new Set(ids.foodIds ?? [])];
    const recipeIds = [...new Set(ids.recipeIds ?? [])];
    const mealIds = [...new Set(ids.mealIds ?? [])];

    // ⚠ Each query is skipped when its id list is empty: `inArray(col, [])`
    // renders `IN ()`, a Postgres syntax error. A mocked-DB test would never
    // catch it.
    const [foodRows, recipeRows, mealRows] = await Promise.all([
      foodIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: foods.id,
              name: foods.name,
              brand: foods.brand,
              kcal: foods.kcal,
              proteinG: foods.proteinG,
              carbsG: foods.carbsG,
              fatG: foods.fatG,
              servingSize: foods.servingSize,
              servingUnit: foods.servingUnit,
              servingQuantity: foods.servingQuantity,
              allergenTags: foods.allergenTags,
              categoryTags: foods.categoryTags,
              createdBy: foods.createdBy,
            })
            .from(foods)
            .where(inArray(foods.id, foodIds)),
      recipeIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: recipes.id,
              name: recipes.name,
              servings: recipes.servings,
              totalKcal: recipes.totalKcal,
              totalProteinG: recipes.totalProteinG,
              totalCarbsG: recipes.totalCarbsG,
              totalFatG: recipes.totalFatG,
            })
            .from(recipes)
            .where(
              and(eq(recipes.userId, userId), inArray(recipes.id, recipeIds)),
            ),
      mealIds.length === 0
        ? Promise.resolve([])
        : db
            .select({
              id: meals.id,
              name: meals.name,
              totalKcal: meals.totalKcal,
              totalProteinG: meals.totalProteinG,
              totalCarbsG: meals.totalCarbsG,
              totalFatG: meals.totalFatG,
            })
            .from(meals)
            .where(and(eq(meals.userId, userId), inArray(meals.id, mealIds))),
    ]);

    const resolved: MealprintCandidate[] = foodRows.map((row) =>
      toFoodCandidate(row, row.createdBy === userId),
    );

    for (const row of recipeRows) {
      const servings = Number(row.servings);
      if (!Number.isFinite(servings) || servings <= 0) continue;
      const kcal = Number(row.totalKcal) / servings;
      if (!Number.isFinite(kcal) || kcal <= 0) continue;
      resolved.push({
        kind: "recipe",
        id: row.id,
        name: row.name,
        kcal,
        proteinG: Number(row.totalProteinG ?? 0) / servings,
        carbsG: Number(row.totalCarbsG ?? 0) / servings,
        fatG: Number(row.totalFatG ?? 0) / servings,
        servingLabel: "1 serving",
        // Same reasoning as `listOwnRecipeCandidates`: a free-text recipe has no
        // OFF tags, so its allergen content is UNKNOWN — never `[]`.
        allergenTags: null,
        categoryTags: null,
        isOwn: true,
      });
    }

    for (const row of mealRows) {
      const kcal = Number(row.totalKcal);
      if (!Number.isFinite(kcal) || kcal <= 0) continue;
      resolved.push({
        kind: "meal",
        id: row.id,
        name: row.name,
        kcal,
        proteinG: Number(row.totalProteinG),
        carbsG: Number(row.totalCarbsG),
        fatG: Number(row.totalFatG),
        servingLabel: "1 portion",
        allergenTags: null,
        categoryTags: null,
        isOwn: true,
      });
    }

    return resolved;
  }
}

/** Per-100g `foods` row → per-serving candidate. */
function toFoodCandidate(
  row: {
    id: string;
    name: string;
    brand: string | null;
    kcal: string;
    proteinG: string;
    carbsG: string;
    fatG: string;
    servingSize: string;
    servingUnit: string;
    servingQuantity: string | null;
    allergenTags: string[] | null;
    categoryTags: string[] | null;
  },
  isOwn: boolean,
): MealprintCandidate {
  // `serving_quantity` is the real pack serving when OFF has it; otherwise the
  // stored `serving_size` (100 for every OFF row). Macros are per-`serving_size`
  // grams, so the scale factor is quantity / serving_size.
  const servingSize = Number(row.servingSize) || 100;
  const quantity =
    row.servingQuantity != null ? Number(row.servingQuantity) : servingSize;
  const scale =
    Number.isFinite(quantity) && quantity > 0 ? quantity / servingSize : 1;

  return {
    kind: "food",
    id: row.id,
    // The brand is part of the identity for a branded catalogue row — "Protein
    // Yogurt" alone is not something a user can find in a shop, and it is also
    // what makes near-duplicate rows distinguishable in the prompt.
    name: row.brand ? `${row.name} (${row.brand})` : row.name,
    kcal: Number(row.kcal) * scale,
    proteinG: Number(row.proteinG) * scale,
    carbsG: Number(row.carbsG) * scale,
    fatG: Number(row.fatG) * scale,
    servingLabel: `${Math.round(quantity)} ${row.servingUnit}`,
    allergenTags: row.allergenTags,
    categoryTags: row.categoryTags,
    isOwn,
  };
}
