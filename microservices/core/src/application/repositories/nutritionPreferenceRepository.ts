import { eq } from "drizzle-orm";
import { nutritionPreferences } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  DIETARY_PATTERNS,
  EFFORT_LEVELS,
  HARD_TO_FIND_PREFIX,
  isAllergenKey,
  isDietaryPattern,
  isEffortLevel,
  isSupportedLocale,
  normaliseFoodText,
  SUPPORTED_LOCALES,
  type EffortLevel,
} from "../nutrition/mealprint/preferences/vocabulary";

/**
 * Mealprint (spec-26 § 2.2, AC 1.3) — the user's food preferences.
 *
 * One row per user, upsert semantics, `userId` first on every method. There is
 * no `list` and no cross-user read: nothing in the product ever needs another
 * user's dietary or allergen data, and a coach-on-behalf path is explicitly out
 * of scope for v1 (requirements § Out of scope), so the narrow surface is the
 * authorization design rather than an omission.
 */

/** Wire shape. Arrays are always present — never null (see the migration). */
export type NutritionPreferenceDTO = {
  userId: string;
  dietaryPatterns: string[];
  avoidAllergens: string[];
  avoidFoods: string[];
  likedFoods: string[];
  mealsPerDay: number;
  effortLevel: EffortLevel;
  locale: string;
  updatedAt: string | null;
  /**
   * TRUE when no row exists and these are the {@link DEFAULT_PREFERENCES}.
   *
   * The read endpoint is 404-free (AC 1.3) — but "I skipped the wizard" and "I
   * deliberately chose these" are different states, and the mobile entry card
   * needs to tell them apart to decide whether to offer the first-run wizard.
   * Without this the only signal would be "does it equal the defaults", which
   * misfires the moment a user deliberately saves the default shape.
   */
  isDefault: boolean;
};

export type UpsertPreferenceInput = {
  dietaryPatterns: string[];
  avoidAllergens: string[];
  avoidFoods: string[];
  likedFoods: string[];
  mealsPerDay: number;
  effortLevel: string;
  locale: string;
};

/** AC 1.4 — the wizard is skippable, and these are what a skip means. */
export const DEFAULT_PREFERENCES = {
  dietaryPatterns: [] as string[],
  avoidAllergens: [] as string[],
  avoidFoods: [] as string[],
  likedFoods: [] as string[],
  mealsPerDay: 4,
  effortLevel: "balanced" as EffortLevel,
  locale: "en-GB",
} as const;

/**
 * Free-text list caps. Not arbitrary: every entry is rendered into the model
 * prompt, so an unbounded list is an unbounded prompt — a cost channel AND a
 * steering channel the user controls. 60 dislikes is far past plausible use and
 * still bounded, and 120 chars is longer than any ingredient name.
 */
export const MAX_FREE_TEXT_ENTRIES = 60;
export const MAX_FREE_TEXT_LENGTH = 120;

export class PreferenceValidationError extends Error {
  public readonly field: string;
  public readonly value: string;

  constructor(field: string, value: string, message: string) {
    super(message);
    this.field = field;
    this.value = value;
    Object.setPrototypeOf(this, PreferenceValidationError.prototype);
    this.name = "PreferenceValidationError";
  }
}

/**
 * Normalise + validate one free-text list.
 *
 * Normalisation happens on WRITE so the stored value is already canonical and
 * `avoidanceFilter` compares rather than guesses. Empty and duplicate entries
 * are dropped silently (a user pasting "Olives, olives" meant one dislike);
 * an over-long entry is an error rather than a silent truncation, because a
 * truncated dislike would match the wrong foods.
 *
 * ⚠ The `hardtofind:` prefix is preserved when present. It is written by
 * STORY-007's affordance and must survive a round trip through the editor —
 * stripping it here would lose the curation signal the moment a user opened
 * their preferences screen.
 */
export function normaliseFreeTextList(
  field: string,
  raw: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (entry.length > MAX_FREE_TEXT_LENGTH) {
      throw new PreferenceValidationError(
        field,
        entry.slice(0, 40),
        `entries must be ${MAX_FREE_TEXT_LENGTH} characters or fewer`,
      );
    }

    const hasPrefix = entry.startsWith(HARD_TO_FIND_PREFIX);
    const body = hasPrefix ? entry.slice(HARD_TO_FIND_PREFIX.length) : entry;
    const normalisedBody = normaliseFoodText(body);
    if (normalisedBody === "") continue;

    const value = hasPrefix
      ? `${HARD_TO_FIND_PREFIX}${normalisedBody}`
      : normalisedBody;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  if (out.length > MAX_FREE_TEXT_ENTRIES) {
    throw new PreferenceValidationError(
      field,
      String(out.length),
      `at most ${MAX_FREE_TEXT_ENTRIES} entries are allowed`,
    );
  }
  return out;
}

/**
 * Validate + normalise a whole preferences payload.
 *
 * ⚠ Every vocabulary is checked HERE as well as by a DB CHECK constraint. The
 * duplication is the point: this layer names the offending value in a 400 (the
 * error a client can act on), the constraint is the backstop that stops any
 * future write path storing an unenforceable value. A pattern with no rule is
 * silently ignored at generation time — the user picks "vegan" and gets meat.
 */
export function validatePreferenceInput(
  input: UpsertPreferenceInput,
): Omit<UpsertPreferenceInput, "effortLevel"> & { effortLevel: EffortLevel } {
  for (const pattern of input.dietaryPatterns) {
    if (!isDietaryPattern(pattern)) {
      throw new PreferenceValidationError(
        "dietaryPatterns",
        pattern,
        `unknown dietary pattern; expected one of ${DIETARY_PATTERNS.join(", ")}`,
      );
    }
  }

  for (const allergen of input.avoidAllergens) {
    if (!isAllergenKey(allergen)) {
      throw new PreferenceValidationError(
        "avoidAllergens",
        allergen,
        "unknown allergen; the vocabulary is the UK FIC 14 set",
      );
    }
  }

  if (!isEffortLevel(input.effortLevel)) {
    throw new PreferenceValidationError(
      "effortLevel",
      input.effortLevel,
      `unknown effort level; expected one of ${EFFORT_LEVELS.join(", ")}`,
    );
  }

  if (!isSupportedLocale(input.locale)) {
    // v1 is en-GB only. Rejecting rather than silently coercing matters: a
    // request for a locale whose catalogue does not exist would otherwise be
    // served UK candidates under a French label.
    throw new PreferenceValidationError(
      "locale",
      input.locale,
      `unsupported locale; expected one of ${SUPPORTED_LOCALES.join(", ")}`,
    );
  }

  if (
    !Number.isInteger(input.mealsPerDay) ||
    input.mealsPerDay < 2 ||
    input.mealsPerDay > 6
  ) {
    throw new PreferenceValidationError(
      "mealsPerDay",
      String(input.mealsPerDay),
      "mealsPerDay must be a whole number between 2 and 6",
    );
  }

  return {
    // Dedupe the closed vocabularies too — a repeated chip is harmless in the
    // DB but doubles the prompt line it renders into.
    dietaryPatterns: [...new Set(input.dietaryPatterns)],
    avoidAllergens: [...new Set(input.avoidAllergens)],
    avoidFoods: normaliseFreeTextList("avoidFoods", input.avoidFoods),
    likedFoods: normaliseFreeTextList("likedFoods", input.likedFoods),
    mealsPerDay: input.mealsPerDay,
    effortLevel: input.effortLevel,
    locale: input.locale,
  };
}

export class NutritionPreferenceRepository {
  static readonly key = "NutritionPreferenceRepository";

  /**
   * 404-free read (AC 1.3): a user who skipped the wizard gets the defaults
   * rather than an error, so every Mealprint surface can read preferences
   * unconditionally.
   */
  async get(userId: string): Promise<NutritionPreferenceDTO> {
    const db = getDb();
    const rows = await db
      .select({
        userId: nutritionPreferences.userId,
        dietaryPatterns: nutritionPreferences.dietaryPatterns,
        avoidAllergens: nutritionPreferences.avoidAllergens,
        avoidFoods: nutritionPreferences.avoidFoods,
        likedFoods: nutritionPreferences.likedFoods,
        mealsPerDay: nutritionPreferences.mealsPerDay,
        effortLevel: nutritionPreferences.effortLevel,
        locale: nutritionPreferences.locale,
        updatedAt: nutritionPreferences.updatedAt,
      })
      .from(nutritionPreferences)
      .where(eq(nutritionPreferences.userId, userId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return {
        userId,
        ...DEFAULT_PREFERENCES,
        dietaryPatterns: [],
        avoidAllergens: [],
        avoidFoods: [],
        likedFoods: [],
        updatedAt: null,
        isDefault: true,
      };
    }

    return {
      userId: row.userId,
      dietaryPatterns: row.dietaryPatterns ?? [],
      avoidAllergens: row.avoidAllergens ?? [],
      avoidFoods: row.avoidFoods ?? [],
      likedFoods: row.likedFoods ?? [],
      mealsPerDay: row.mealsPerDay,
      // ⚠ Coerced through the guard rather than cast. The column is `text` and
      // its CHECK could be dropped by a future migration; a value the filter has
      // no rule for must not reach the pipeline typed as if it did.
      effortLevel: isEffortLevel(row.effortLevel)
        ? row.effortLevel
        : DEFAULT_PREFERENCES.effortLevel,
      locale: row.locale,
      updatedAt:
        row.updatedAt instanceof Date
          ? row.updatedAt.toISOString()
          : row.updatedAt
            ? String(row.updatedAt)
            : null,
      isDefault: false,
    };
  }

  /**
   * Self-write upsert. Validation and normalisation run before the write, so an
   * invalid payload never reaches Postgres and a stored dislike is always
   * canonical.
   */
  async upsert(
    userId: string,
    input: UpsertPreferenceInput,
  ): Promise<NutritionPreferenceDTO> {
    const clean = validatePreferenceInput(input);
    const db = getDb();
    const now = new Date();

    const values = {
      dietaryPatterns: clean.dietaryPatterns,
      avoidAllergens: clean.avoidAllergens,
      avoidFoods: clean.avoidFoods,
      likedFoods: clean.likedFoods,
      mealsPerDay: clean.mealsPerDay,
      effortLevel: clean.effortLevel,
      locale: clean.locale,
      updatedAt: now,
    };

    await db
      .insert(nutritionPreferences)
      .values({ userId, ...values })
      .onConflictDoUpdate({
        target: nutritionPreferences.userId,
        set: values,
      });

    // Re-read so the response carries exactly what was stored, including
    // `isDefault: false` and the DB-side `updatedAt`.
    return this.get(userId);
  }
}
