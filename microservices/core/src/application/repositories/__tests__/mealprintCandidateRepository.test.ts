/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import {
  CURATED_FETCH_LIMIT,
  MealprintCandidateRepository,
  textArray,
} from "../mealprintCandidateRepository";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Any `(…)::text[]` — the ROW-constructor cast Postgres rejects.
 *
 * ⚠ This is the `uuidArray` trap with a different element type. ``sql`${arr}::text[]` ``
 * renders a parenthesised placeholder list, so the cast lands on a record and the
 * query dies AT EXECUTION: `cannot cast type record to text[]` with 2+ elements,
 * `malformed array literal` with one. It 500'd Loadout's preview on a real device
 * and two call sites carried it for three months because nothing executed them.
 * A mocked `getDb` cannot catch it, so the shape is banned mechanically here
 * rather than left to whoever remembers.
 */
const PAREN_CAST = /\(\$\d+(,\s*\$\d+)*\)::text\[\]/;

function render(fragment: unknown) {
  return new PgDialect().sqlToQuery(fragment as never);
}

function makeChain(capture: { where?: unknown; orderBy?: unknown[] }) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn((w: unknown) => {
    capture.where = w;
    return chain;
  });
  chain.orderBy = vi.fn((...args: unknown[]) => {
    capture.orderBy = args;
    return chain;
  });
  chain.limit = vi.fn().mockResolvedValue([]);
  return chain;
}

describe("textArray", () => {
  // ⚠ BOTH ARITIES on purpose. A one-element array renders `($1)`, which is not a
  // record at all — a scalar in parentheses — so it fails with a DIFFERENT
  // Postgres error and would survive a test that only ever passed two values.
  it.each([
    [["en:milk"]],
    [["en:milk", "en:gluten"]],
    [["en:milk", "en:gluten", "en:peanuts"]],
  ])("renders %j as an executable ARRAY[…]::text[] literal", (values) => {
    const { sql, params } = render(textArray(values));
    expect(sql).toMatch(/ARRAY\[\$\d+(,\s*\$\d+)*\]::text\[\]/);
    expect(sql).not.toMatch(PAREN_CAST);
    expect(params).toEqual(values);
  });

  it("renders the empty case as a TYPED empty array, not bare ARRAY[]", () => {
    // Bare `ARRAY[]` is untyped and Postgres rejects it outright.
    const { sql } = render(textArray([]));
    expect(sql).toContain("ARRAY[]::text[]");
  });

  it("parameterises values rather than interpolating them", () => {
    // A tag string reaching the SQL text would be an injection channel; the OFF
    // taxonomy is external data.
    const { sql, params } = render(textArray(["en:'; DROP TABLE foods --"]));
    expect(sql).not.toContain("DROP TABLE");
    expect(params).toEqual(["en:'; DROP TABLE foods --"]);
  });
});

describe("MealprintCandidateRepository.buildCuratedWhere", () => {
  const repo = new MealprintCandidateRepository();

  it("scopes to curated provenance and the locale tag", () => {
    const { sql, params } = render(
      repo.buildCuratedWhere({
        locale: "en-GB",
        maxServingKcal: 600,
        forbiddenAllergenTags: [],
        requireKnownAllergens: false,
      }),
    );
    expect(sql).toContain('"source"');
    expect(params).toContain("openfoodfacts");
    // AC 7.3 — the pool draws only locale-curated rows.
    expect(params).toContain("en:united-kingdom");
    expect(sql).toContain("&&");
    expect(sql).not.toMatch(PAREN_CAST);
  });

  it("adds the NOT NULL allergen predicate only when an allergen chip is set", () => {
    const without = render(
      repo.buildCuratedWhere({
        locale: "en-GB",
        maxServingKcal: 600,
        forbiddenAllergenTags: [],
        requireKnownAllergens: false,
      }),
    ).sql;
    const with_ = render(
      repo.buildCuratedWhere({
        locale: "en-GB",
        maxServingKcal: 600,
        forbiddenAllergenTags: ["en:peanuts"],
        requireKnownAllergens: true,
      }),
    ).sql;

    // ⚠ Fail closed in SQL as well as in JS. Without this predicate the fetch
    // limit is spent on unknown-tag rows that `avoidanceFilter` will reject to a
    // row, so the pool comes back EMPTY for exactly the users who need it full.
    expect(without).not.toContain("is not null");
    expect(with_).toContain("is not null");
  });

  it("excludes forbidden allergen tags by overlap, with an executable literal", () => {
    const { sql, params } = render(
      repo.buildCuratedWhere({
        locale: "en-GB",
        maxServingKcal: 600,
        forbiddenAllergenTags: ["en:peanuts", "en:nuts"],
        requireKnownAllergens: true,
      }),
    );
    expect(sql).toContain("NOT (");
    expect(sql).toMatch(/ARRAY\[\$\d+,\s*\$\d+\]::text\[\]/);
    expect(sql).not.toMatch(PAREN_CAST);
    expect(params).toContain("en:peanuts");
    expect(params).toContain("en:nuts");
  });

  // ⚠ THREE-VALUED-LOGIC REGRESSION. `NULL && ARRAY[…]` is NULL, `NOT NULL` is
  // NULL, and a NULL predicate EXCLUDES the row. Without the `IS NULL OR` guard,
  // a user with `dietaryPatterns: ['vegan']` and no allergen chip (non-empty
  // forbidden list, `requireKnownAllergens: false`) had every untagged row
  // dropped in SQL even though `avoidanceFilter` would keep it — breaking this
  // class's stated invariant, and pre-backfill emptying the pool for every
  // pattern user.
  it("keeps untagged rows when the forbidden list came from a PATTERN, not a chip", () => {
    const { sql } = render(
      repo.buildCuratedWhere({
        locale: "en-GB",
        maxServingKcal: 600,
        forbiddenAllergenTags: ["en:milk", "en:fish"],
        requireKnownAllergens: false,
      }),
    );
    expect(sql).toMatch(/"allergen_tags" is null or NOT \(/i);
  });

  it("still excludes untagged rows when an allergen CHIP is set", () => {
    // The two predicates coexist: `IS NULL OR NOT (…)` would readmit unknown rows
    // on its own, so the fail-closed `IS NOT NULL` must still be present.
    const { sql } = render(
      repo.buildCuratedWhere({
        locale: "en-GB",
        maxServingKcal: 600,
        forbiddenAllergenTags: ["en:peanuts"],
        requireKnownAllergens: true,
      }),
    );
    expect(sql).toContain("is not null");
    expect(sql).toMatch(/is null or NOT \(/i);
  });

  it("bounds one serving's kcal against the remaining budget", () => {
    // Macros are per-100g and `serving_quantity` is the real pack serving in
    // grams, so the serving's kcal is kcal * q / 100 — the arithmetic has to be
    // in the SQL, and it has to COALESCE because OFF often omits the quantity.
    const { sql, params } = render(
      repo.buildCuratedWhere({
        locale: "en-GB",
        maxServingKcal: 620,
        forbiddenAllergenTags: [],
        requireKnownAllergens: false,
      }),
    );
    expect(sql).toContain("COALESCE");
    // ⚠ Divided by `serving_size`, NOT a hardcoded 100. The two coincide only
    // when `serving_size = 100` — true of every OFF row, false of a user's own
    // food — so a hardcoded 100 filtered a `serving_size = 500, kcal = 100` row
    // as 500 kcal (excluded from a budget it fits) and a
    // `serving_size = 30, kcal = 150` row as 45 (let into a budget it blows).
    // It must also match `toFoodCandidate`'s `quantity / serving_size` scaling,
    // or the pool and the returned macros disagree.
    expect(sql).toContain('NULLIF("foods"."serving_size", 0)');
    expect(sql).not.toContain("/ 100.0");
    expect(params).toContain(620);
  });
});

describe("MealprintCandidateRepository queries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("orders curated candidates deterministically by protein density", async () => {
    // Determinism is a prerequisite for evaluating the model stage above this
    // one: the same request twice must see the same pool. Protein density alone
    // ties on plenty of rows, hence the id tiebreak.
    const capture: { orderBy?: unknown[] } = {};
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(makeChain(capture)),
    });

    await new MealprintCandidateRepository().listCuratedCandidates({
      locale: "en-GB",
      maxServingKcal: 600,
      forbiddenAllergenTags: [],
      requireKnownAllergens: false,
    });

    expect(capture.orderBy).toHaveLength(2);
    const first = render(capture.orderBy?.[0]).sql;
    expect(first).toContain("NULLIF");
    expect(first).toContain("DESC");
    const second = render(capture.orderBy?.[1]).sql;
    expect(second).toContain("ASC");
  });

  it("over-fetches relative to the model's cap", async () => {
    // The precise filter runs AFTER this query, so fetching only 200 would hand a
    // restricted user a pool of six. See the class docstring.
    const chain = makeChain({});
    (getDb as any).mockReturnValue({ select: vi.fn().mockReturnValue(chain) });

    await new MealprintCandidateRepository().listCuratedCandidates({
      locale: "en-GB",
      maxServingKcal: 600,
      forbiddenAllergenTags: [],
      requireKnownAllergens: false,
    });

    expect(chain.limit).toHaveBeenCalledWith(CURATED_FETCH_LIMIT);
    expect(CURATED_FETCH_LIMIT).toBeGreaterThan(200);
  });

  it("scopes own-food candidates to created_by = the caller", async () => {
    const capture: { where?: unknown } = {};
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(makeChain(capture)),
    });

    await new MealprintCandidateRepository().listOwnFoodCandidates(USER_A, 600);
    const { sql, params } = render(capture.where);
    // ⚠ Assert the COLUMN, not just the bound value. `expect(params).not.toContain(USER_B)`
    // was the first version and it cannot fail — USER_B is never passed to the
    // call, so no implementation, correct or broken, could put it there. The
    // load-bearing question is which column the caller's id is bound to: bound to
    // the wrong one, the query would return another user's rows with USER_A still
    // in the params.
    expect(sql).toContain('"created_by" = $');
    expect(params).toContain(USER_A);
  });

  it("does not scope own foods by anything but created_by", async () => {
    // A second user's id must never appear, and the only user-scoped predicate
    // must be the ownership one.
    const capture: { where?: unknown } = {};
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(makeChain(capture)),
    });
    await new MealprintCandidateRepository().listOwnFoodCandidates(USER_B, 600);
    const { sql, params } = render(capture.where);
    expect(params.filter((p) => p === USER_B)).toHaveLength(1);
    expect(sql).not.toContain('"user_id"');
  });

  it("scopes own recipes and meals to the caller", async () => {
    const repo = new MealprintCandidateRepository();

    for (const call of [
      () => repo.listOwnRecipeCandidates(USER_A, 9999),
      () => repo.listOwnMealCandidates(USER_A, 9999),
    ]) {
      const capture: { where?: unknown } = {};
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeChain(capture)),
      });
      await call();
      expect(render(capture.where).params).toContain(USER_A);
    }
  });
});

describe("MealprintCandidateRepository row mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  function withRows(rows: unknown[]) {
    const chain: any = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockResolvedValue(rows);
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(chain),
    });
  }

  it("scales per-100g macros out to the real pack serving", async () => {
    withRows([
      {
        id: "f1",
        name: "Greek Yogurt",
        brand: "Fage",
        kcal: "100",
        proteinG: "10",
        carbsG: "4",
        fatG: "0.4",
        servingSize: "100",
        servingUnit: "g",
        servingQuantity: "170",
        allergenTags: ["en:milk"],
        categoryTags: ["en:yogurts"],
      },
    ]);

    const [candidate] =
      await new MealprintCandidateRepository().listCuratedCandidates({
        locale: "en-GB",
        maxServingKcal: 600,
        forbiddenAllergenTags: [],
        requireKnownAllergens: false,
      });

    expect(candidate.kcal).toBeCloseTo(170);
    expect(candidate.proteinG).toBeCloseTo(17);
    expect(candidate.servingLabel).toBe("170 g");
    // The brand is part of a branded row's identity — "Greek Yogurt" alone is not
    // something a user can find in a shop, and it is what makes near-duplicate
    // catalogue rows distinguishable in the prompt.
    expect(candidate.name).toBe("Greek Yogurt (Fage)");
    expect(candidate.allergenTags).toEqual(["en:milk"]);
  });

  it("falls back to serving_size when OFF omits the pack serving", async () => {
    withRows([
      {
        id: "f1",
        name: "Oats",
        brand: null,
        kcal: "379",
        proteinG: "13",
        carbsG: "67",
        fatG: "8",
        servingSize: "100",
        servingUnit: "g",
        servingQuantity: null,
        allergenTags: null,
        categoryTags: null,
      },
    ]);

    const [candidate] =
      await new MealprintCandidateRepository().listCuratedCandidates({
        locale: "en-GB",
        maxServingKcal: 600,
        forbiddenAllergenTags: [],
        requireKnownAllergens: false,
      });
    expect(candidate.kcal).toBeCloseTo(379);
    // ⚠ Preserved as null, not coerced to []: `avoidanceFilter` reads this as
    // UNKNOWN and excludes the row from allergen-filtered pools.
    expect(candidate.allergenTags).toBeNull();
  });

  it("divides recipe totals by servings and drops unusable rows", async () => {
    withRows([
      {
        id: "r1",
        name: "Chilli",
        servings: "4",
        totalKcal: "2000",
        totalProteinG: "160",
        totalCarbsG: "200",
        totalFatG: "60",
      },
      // servings = 0 would divide by zero; servings = null and kcal = 0 are both
      // "we cannot state a per-serving figure", which must not become NaN or
      // Infinity in a prompt the model reads as truth.
      {
        id: "r2",
        name: "Broken",
        servings: "0",
        totalKcal: "500",
        totalProteinG: "10",
        totalCarbsG: "10",
        totalFatG: "10",
      },
      {
        id: "r3",
        name: "Zero",
        servings: "2",
        totalKcal: "0",
        totalProteinG: "0",
        totalCarbsG: "0",
        totalFatG: "0",
      },
    ]);

    const out =
      await new MealprintCandidateRepository().listOwnRecipeCandidates(
        USER_A,
        9999,
      );
    expect(out.map((c) => c.id)).toEqual(["r1"]);
    expect(out[0].kcal).toBeCloseTo(500);
    expect(out[0].proteinG).toBeCloseTo(40);
    // A free-text recipe has no OFF tags, so its allergen content is UNKNOWN.
    expect(out[0].allergenTags).toBeNull();
    expect(out[0].isOwn).toBe(true);
  });

  it("drops meals with unusable totals", async () => {
    withRows([
      {
        id: "m1",
        name: "Post-gym",
        totalKcal: "600",
        totalProteinG: "50",
        totalCarbsG: "60",
        totalFatG: "15",
      },
      {
        id: "m2",
        name: "Empty",
        totalKcal: "0",
        totalProteinG: "0",
        totalCarbsG: "0",
        totalFatG: "0",
      },
    ]);

    const out = await new MealprintCandidateRepository().listOwnMealCandidates(
      USER_A,
      9999,
    );
    expect(out.map((c) => c.id)).toEqual(["m1"]);
    expect(out[0].kind).toBe("meal");
  });
});
