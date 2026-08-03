/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import {
  DEFAULT_PREFERENCES,
  MAX_FREE_TEXT_ENTRIES,
  MAX_FREE_TEXT_LENGTH,
  NutritionPreferenceRepository,
  normaliseFreeTextList,
  PreferenceValidationError,
  validatePreferenceInput,
} from "../nutritionPreferenceRepository";
import { HARD_TO_FIND_PREFIX } from "../../nutrition/mealprint/preferences/vocabulary";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const VALID = {
  dietaryPatterns: ["vegetarian"],
  avoidAllergens: ["peanuts"],
  avoidFoods: ["mushrooms"],
  likedFoods: ["greek yogurt"],
  mealsPerDay: 4,
  effortLevel: "balanced",
  locale: "en-GB",
};

/** A select-chain stub that records the WHERE it was handed. */
function makeSelectDb(rows: unknown[], capture: { where?: unknown } = {}) {
  const chain: any = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn((w: unknown) => {
    capture.where = w;
    return chain;
  });
  chain.limit = vi.fn().mockResolvedValue(rows);
  return { select: vi.fn().mockReturnValue(chain) };
}

function render(where: unknown): string {
  return new PgDialect().sqlToQuery(where as never).sql;
}

// ── validation ──────────────────────────────────────────────────────────────

describe("validatePreferenceInput", () => {
  it("accepts and dedupes a valid payload", () => {
    const out = validatePreferenceInput({
      ...VALID,
      dietaryPatterns: ["vegetarian", "vegetarian", "gluten_free"],
      avoidAllergens: ["peanuts", "peanuts"],
    });
    expect(out.dietaryPatterns).toEqual(["vegetarian", "gluten_free"]);
    expect(out.avoidAllergens).toEqual(["peanuts"]);
  });

  // ⚠ The whole point of this layer. A pattern stored without a matching rule in
  // DIETARY_PATTERN_RULES is silently ignored at generation time — the user picks
  // it and gets exactly the food they excluded.
  it("rejects an unknown dietary pattern, naming the value", () => {
    try {
      validatePreferenceInput({ ...VALID, dietaryPatterns: ["carnivore"] });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PreferenceValidationError);
      const e = error as PreferenceValidationError;
      expect(e.field).toBe("dietaryPatterns");
      expect(e.value).toBe("carnivore");
    }
  });

  it("rejects an allergen outside the UK FIC 14 vocabulary", () => {
    expect(() =>
      validatePreferenceInput({ ...VALID, avoidAllergens: ["strawberries"] }),
    ).toThrow(PreferenceValidationError);
  });

  it("rejects an unknown effort level", () => {
    expect(() =>
      validatePreferenceInput({ ...VALID, effortLevel: "extreme" }),
    ).toThrow(PreferenceValidationError);
  });

  it("rejects an unsupported locale rather than silently coercing it", () => {
    // Serving UK candidates under a fr-FR label would be worse than a 400.
    expect(() =>
      validatePreferenceInput({ ...VALID, locale: "fr-FR" }),
    ).toThrow(PreferenceValidationError);
  });

  it.each([1, 7, 0, -1, 3.5, Number.NaN])(
    "rejects mealsPerDay = %s",
    (meals) => {
      expect(() =>
        validatePreferenceInput({ ...VALID, mealsPerDay: meals }),
      ).toThrow(PreferenceValidationError);
    },
  );

  it.each([2, 3, 4, 5, 6])("accepts mealsPerDay = %s", (meals) => {
    expect(
      validatePreferenceInput({ ...VALID, mealsPerDay: meals }).mealsPerDay,
    ).toBe(meals);
  });

  it("normalises free text on write so matching is a comparison, not a guess", () => {
    const out = validatePreferenceInput({
      ...VALID,
      avoidFoods: ["  Crème FRAÎCHE  ", "Olives"],
    });
    expect(out.avoidFoods).toEqual(["creme fraiche", "olives"]);
  });
});

describe("normaliseFreeTextList", () => {
  it("drops blank and duplicate entries", () => {
    expect(
      normaliseFreeTextList("avoidFoods", ["Olives", " olives ", "", "   "]),
    ).toEqual(["olives"]);
  });

  it("preserves the hardtofind: prefix through a round trip", () => {
    // STORY-007 writes this prefix; stripping it would destroy the curation
    // signal the first time the user opened their preferences editor.
    const out = normaliseFreeTextList("avoidFoods", [
      `${HARD_TO_FIND_PREFIX}Liquid Egg Whites`,
    ]);
    expect(out).toEqual([`${HARD_TO_FIND_PREFIX}liquid egg whites`]);
  });

  it("treats a prefixed and an unprefixed entry as distinct", () => {
    const out = normaliseFreeTextList("avoidFoods", [
      "olives",
      `${HARD_TO_FIND_PREFIX}olives`,
    ]);
    expect(out).toHaveLength(2);
  });

  it("rejects an over-long entry rather than truncating it", () => {
    // A truncated dislike would match the wrong foods, silently.
    expect(() =>
      normaliseFreeTextList("avoidFoods", [
        "x".repeat(MAX_FREE_TEXT_LENGTH + 1),
      ]),
    ).toThrow(PreferenceValidationError);
  });

  it("rejects more than the entry cap", () => {
    // Every entry renders into the model prompt, so an unbounded list is an
    // unbounded prompt — a cost channel the user controls.
    const many = Array.from(
      { length: MAX_FREE_TEXT_ENTRIES + 1 },
      (_, i) => `food ${i}`,
    );
    expect(() => normaliseFreeTextList("avoidFoods", many)).toThrow(
      PreferenceValidationError,
    );
  });

  it("counts entries AFTER dedupe, so duplicates do not consume the cap", () => {
    const dupes = Array.from(
      { length: MAX_FREE_TEXT_ENTRIES + 10 },
      () => "olives",
    );
    expect(normaliseFreeTextList("avoidFoods", dupes)).toEqual(["olives"]);
  });
});

// ── reads ───────────────────────────────────────────────────────────────────

describe("NutritionPreferenceRepository.get", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the defaults with isDefault=true when no row exists (AC 1.3/1.4)", async () => {
    (getDb as any).mockReturnValue(makeSelectDb([]));
    const out = await new NutritionPreferenceRepository().get(USER_A);
    expect(out).toEqual({
      userId: USER_A,
      dietaryPatterns: [],
      avoidAllergens: [],
      avoidFoods: [],
      likedFoods: [],
      mealsPerDay: DEFAULT_PREFERENCES.mealsPerDay,
      effortLevel: DEFAULT_PREFERENCES.effortLevel,
      locale: DEFAULT_PREFERENCES.locale,
      updatedAt: null,
      isDefault: true,
    });
  });

  it("distinguishes a stored default-shaped row from an absent one", async () => {
    // "I skipped the wizard" and "I deliberately chose these" drive different
    // mobile entry-card states, so equality with the defaults is not a usable
    // substitute for this flag.
    (getDb as any).mockReturnValue(
      makeSelectDb([
        {
          userId: USER_A,
          dietaryPatterns: [],
          avoidAllergens: [],
          avoidFoods: [],
          likedFoods: [],
          mealsPerDay: 4,
          effortLevel: "balanced",
          locale: "en-GB",
          updatedAt: new Date("2026-08-03T10:00:00Z"),
        },
      ]),
    );
    const out = await new NutritionPreferenceRepository().get(USER_A);
    expect(out.isDefault).toBe(false);
    expect(out.updatedAt).toBe("2026-08-03T10:00:00.000Z");
  });

  it("coerces an out-of-vocabulary stored effort level to the default", async () => {
    // Defence against a future migration dropping the CHECK: a value the filter
    // has no rule for must not reach the pipeline typed as if it did.
    (getDb as any).mockReturnValue(
      makeSelectDb([
        {
          userId: USER_A,
          dietaryPatterns: [],
          avoidAllergens: [],
          avoidFoods: [],
          likedFoods: [],
          mealsPerDay: 4,
          effortLevel: "extreme",
          locale: "en-GB",
          updatedAt: null,
        },
      ]),
    );
    const out = await new NutritionPreferenceRepository().get(USER_A);
    expect(out.effortLevel).toBe("balanced");
  });

  // ⚠ The mocked-getDb blind spot: a unit test asserting the mock's return value
  // proves nothing about the SQL. Render the real predicate and check it scopes
  // to the caller.
  it("scopes the read to the caller's user_id (rendered SQL)", async () => {
    const capture: { where?: unknown } = {};
    (getDb as any).mockReturnValue(makeSelectDb([], capture));
    await new NutritionPreferenceRepository().get(USER_A);

    const sql = render(capture.where);
    expect(sql).toContain('"user_id"');
    expect(sql).toMatch(/"user_id"\s*=\s*\$1/);
  });

  it("returns only the requesting user's row — two-user isolation", async () => {
    const repo = new NutritionPreferenceRepository();
    const capture: { where?: unknown } = {};

    (getDb as any).mockReturnValue(
      makeSelectDb(
        [
          {
            userId: USER_A,
            dietaryPatterns: ["vegan"],
            avoidAllergens: ["peanuts"],
            avoidFoods: [],
            likedFoods: [],
            mealsPerDay: 4,
            effortLevel: "balanced",
            locale: "en-GB",
            updatedAt: null,
          },
        ],
        capture,
      ),
    );
    const a = await repo.get(USER_A);
    expect(a.userId).toBe(USER_A);
    const paramsA = new PgDialect().sqlToQuery(capture.where as never).params;
    expect(paramsA).toEqual([USER_A]);

    (getDb as any).mockReturnValue(makeSelectDb([], capture));
    const b = await repo.get(USER_B);
    // B has no row, so B gets defaults — never A's allergen list.
    expect(b.isDefault).toBe(true);
    expect(b.avoidAllergens).toEqual([]);
    const paramsB = new PgDialect().sqlToQuery(capture.where as never).params;
    expect(paramsB).toEqual([USER_B]);
  });
});

// ── writes ──────────────────────────────────────────────────────────────────

describe("NutritionPreferenceRepository.upsert", () => {
  beforeEach(() => vi.clearAllMocks());

  function makeUpsertDb(readRows: unknown[]) {
    const captured: { values?: any; conflict?: any } = {};
    const insertChain: any = {};
    insertChain.values = vi.fn((v: unknown) => {
      captured.values = v;
      return insertChain;
    });
    insertChain.onConflictDoUpdate = vi.fn(async (c: unknown) => {
      captured.conflict = c;
    });

    const selectChain: any = {};
    selectChain.from = vi.fn().mockReturnValue(selectChain);
    selectChain.where = vi.fn().mockReturnValue(selectChain);
    selectChain.limit = vi.fn().mockResolvedValue(readRows);

    return {
      db: {
        insert: vi.fn().mockReturnValue(insertChain),
        select: vi.fn().mockReturnValue(selectChain),
      },
      captured,
    };
  }

  it("upserts on user_id and stores the NORMALISED values", async () => {
    const { db, captured } = makeUpsertDb([
      {
        userId: USER_A,
        dietaryPatterns: ["vegetarian"],
        avoidAllergens: ["peanuts"],
        avoidFoods: ["olives"],
        likedFoods: [],
        mealsPerDay: 3,
        effortLevel: "quick",
        locale: "en-GB",
        updatedAt: null,
      },
    ]);
    (getDb as any).mockReturnValue(db);

    await new NutritionPreferenceRepository().upsert(USER_A, {
      ...VALID,
      avoidFoods: ["  Olives  "],
      mealsPerDay: 3,
      effortLevel: "quick",
    });

    expect(captured.values.userId).toBe(USER_A);
    expect(captured.values.avoidFoods).toEqual(["olives"]);
    expect(captured.values.mealsPerDay).toBe(3);
    // The conflict target is the user_id PK — an upsert, never a second row.
    //
    // ⚠ Assert the rendered COLUMN. `toBeDefined()` was the first version and it
    // passes for any non-undefined value, so it would still have passed with the
    // target pointed at the wrong column — which is exactly what the comment
    // above claims to be verifying. A wrong target turns the upsert into an
    // insert that violates the PK, or worse, updates by the wrong key.
    expect(captured.conflict.target).toBeDefined();
    expect(String(captured.conflict.target.name)).toBe("user_id");
    // `userId` must NOT be in the update set: a conflict means the row already
    // belongs to this user, and writing the key back is how a bad `set` could
    // reassign ownership.
    expect(captured.conflict.set.userId).toBeUndefined();
  });

  it("validates BEFORE writing, so an invalid payload never reaches Postgres", async () => {
    const { db } = makeUpsertDb([]);
    (getDb as any).mockReturnValue(db);

    await expect(
      new NutritionPreferenceRepository().upsert(USER_A, {
        ...VALID,
        dietaryPatterns: ["carnivore"],
      }),
    ).rejects.toThrow(PreferenceValidationError);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("re-reads so the response carries isDefault=false", async () => {
    const { db } = makeUpsertDb([
      {
        userId: USER_A,
        dietaryPatterns: [],
        avoidAllergens: [],
        avoidFoods: [],
        likedFoods: [],
        mealsPerDay: 4,
        effortLevel: "balanced",
        locale: "en-GB",
        updatedAt: new Date("2026-08-03T11:00:00Z"),
      },
    ]);
    (getDb as any).mockReturnValue(db);

    const out = await new NutritionPreferenceRepository().upsert(USER_A, VALID);
    expect(out.isDefault).toBe(false);
  });
});
