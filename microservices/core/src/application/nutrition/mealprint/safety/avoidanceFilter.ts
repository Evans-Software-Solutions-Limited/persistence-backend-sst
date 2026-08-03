/**
 * Mealprint (spec-26) — deterministic avoidance filtering.
 *
 * ⚠ **DANGEROUS AREA in the CLAUDE.md sense.** This is the module that decides
 * whether a food reaches someone who told us they must not eat it. It runs
 * TWICE on every generation (design § 1): once in stage 1, to build the
 * candidate pool the model is allowed to choose from, and again in stage 3 over
 * every item the model actually composed. The second pass is not redundancy for
 * its own sake — the model is treated as an untrusted composer, and a
 * composition that violates an avoidance must never reach the user even if the
 * pool that produced it was correct.
 *
 * Pure and synchronous: no DB, no clock, no I/O. Everything it needs is passed
 * in, so its behaviour is fully enumerable in tests, which is the only reason a
 * safety claim about it is worth anything.
 *
 * ## The two-tier posture, which is the central design decision here
 *
 * Requirements distinguish allergy-grade avoidance from dietary patterns and
 * dislikes, and this module enforces that distinction rather than flattening it:
 *
 *   - **Allergens are TAG-DERIVED AND FAIL CLOSED.** A row is cleared only when
 *     its `allergenTags` are present AND fully interpretable AND contain none of
 *     the avoided tags. `null` tags (unknown) exclude the row. A tag we cannot
 *     interpret excludes the row. A name that merely *looks* safe never clears
 *     it — no word list is allowed to vouch for an allergen (AC 2.2, design § 1).
 *   - **Patterns and dislikes are tag-derived WHERE TAGS EXIST and fall back to
 *     whole-token NAME matching where they do not**, with the verdict marked
 *     `unverified` so the caller can flag it. This is what AC 2.2 describes for
 *     unknown-tag rows ("pass dislike filtering by name-match only and are
 *     flagged"), and it is why a vegan's own hand-entered recipes do not vanish
 *     from their pool the way a fail-closed rule would make them.
 *
 * Getting that asymmetry backwards in either direction is a real harm: fail-open
 * on allergens hands a peanut avoider an unexamined product, and fail-closed on
 * patterns empties the pool and makes the feature look broken.
 *
 * ## What this module does NOT claim
 *
 * It cannot see cross-contamination, manufacturing practice, recipe changes, or
 * halal/kosher certification. Every allergen-relevant surface therefore renders
 * the label-check disclaimer (AC 1.2 / AC 3.4), and `halal`/`kosher` verdicts
 * carry `partialEnforcementOnly`. The disclaimer is not boilerplate — it is the
 * honest boundary of a filter built on crowd-sourced ingredient data.
 */

import {
  ALLERGEN_OFF_TAGS,
  DIETARY_PATTERN_RULES,
  isAllergenKey,
  isDietaryPattern,
  isTokenNegatedInName,
  tokeniseFoodName,
  type AllergenKey,
  type DietaryPattern,
  type NameAxis,
} from "../preferences/vocabulary";

/**
 * The minimum a candidate must expose to be judged. Deliberately structural
 * rather than a `foods` row type: recipes, meals and model-composed items all
 * flow through the same filter, and stage 3 judges resolved items that never
 * were rows.
 */
export interface AvoidanceSubject {
  /** Only used to make a verdict traceable in logs and tests. */
  id: string;
  name: string;
  /**
   * ⚠ `null` MEANS UNKNOWN, NOT "none". See
   * `offMapper.mapOffAllergenTags` for why the ETL keeps those cases apart, and
   * {@link assessAvoidance} for what each one does here.
   */
  allergenTags: readonly string[] | null;
  categoryTags: readonly string[] | null;
}

export interface AvoidancePreferences {
  dietaryPatterns: readonly string[];
  avoidAllergens: readonly string[];
  /** Already normalised on write (`normaliseFoodText`); re-tokenised here. */
  avoidFoods: readonly string[];
}

export type AvoidanceRule =
  /** An avoided allergen's OFF tag is present on the row. */
  | "allergen_tag"
  /** The row's allergen content is unknown (`null` tags) and cannot be cleared. */
  | "allergen_unknown"
  /** The row carries an allergen tag outside the interpretable taxonomy. */
  | "allergen_uninterpretable"
  /** A dietary pattern is violated by an OFF tag. */
  | "pattern_tag"
  /** A dietary pattern is violated by a name token (tags unavailable). */
  | "pattern_name"
  /** A free-text dislike matches the row's name. */
  | "dislike_name";

export type AvoidanceVerdict =
  | {
      allowed: true;
      /**
       * TRUE when this row's allergen content is UNKNOWN. Callers must render
       * the label-check disclaimer (AC 1.2 / 3.4) for such a row. Note an
       * `allowed: true` row can only be unverified when the user set no allergen
       * chips — with chips set, unknown rows are excluded outright.
       */
      unverified: boolean;
      /** TRUE when an active pattern cannot be fully enforced (halal/kosher). */
      partialEnforcementOnly: boolean;
    }
  | {
      allowed: false;
      rule: AvoidanceRule;
      /** The preference value responsible — allergen key, pattern, or dislike. */
      cause: string;
      /** The tag or token that matched. Diagnostic, not user-facing copy. */
      evidence: string;
    };

/** Tag → owning allergen key, precomputed once (module load, not per call). */
const TAG_TO_ALLERGEN: ReadonlyMap<string, AllergenKey> = (() => {
  const map = new Map<string, AllergenKey>();
  for (const key of Object.keys(ALLERGEN_OFF_TAGS) as AllergenKey[]) {
    for (const tag of ALLERGEN_OFF_TAGS[key]) map.set(tag, key);
  }
  return map;
})();

/**
 * Is an OFF allergen tag one we can reason about?
 *
 * The test is the `en:` prefix, and the reasoning matters. OFF canonicalises a
 * declared allergen to an `en:`-prefixed taxonomy entry when it RECOGNISES it;
 * anything else is unmatched producer free text, frequently in another language
 * (`fr:lait` is milk). So:
 *
 *   - `en:` present → OFF matched it to a NAMED allergen. Even if it is not one
 *     of our 14, we know what it is and know it is not the avoided one, because
 *     taxonomy names are distinct. Safe to leave the row in.
 *   - anything else → we do not know what it says. It could be a translation of
 *     the very allergen being avoided, so the row is excluded.
 *
 * ⚠ The alternative — recognising only the ~60 tags in {@link ALLERGEN_OFF_TAGS}
 * — was rejected: it would exclude every product tagged with a real allergen we
 * happen not to enumerate (`en:corn`, `en:beef`), gutting the pool for a reason
 * that has nothing to do with the user's actual avoidance.
 */
export function isInterpretableAllergenTag(tag: string): boolean {
  return tag.startsWith("en:");
}

/**
 * First token of any axis in `axes` that the subject's name carries, or `null`.
 *
 * An axis is skipped entirely when the name NEGATES it — "Dairy-Free Oat Milk"
 * clears the dairy axis, "Meat Free Sausage" clears the meat axis. The negation
 * is scoped to the axis, so "Dairy Free Chicken Nuggets" clears dairy and
 * leaves meat firmly matched. See {@link NameAxis} for why this cannot be a
 * per-token or a name-global check.
 */
function matchesAnyAxis(
  subjectName: string,
  subjectTokens: ReadonlySet<string>,
  axes: readonly NameAxis[],
): { axis: string; token: string } | null {
  for (const axis of axes) {
    const negated = axis.negators.some((negator) =>
      isTokenNegatedInName(subjectName, negator),
    );
    if (negated) continue;

    for (const token of axis.tokens) {
      // Axis token lists are authored singular already, but singularising both
      // sides costs nothing and removes a class of authoring slip.
      for (const candidate of tokeniseFoodName(token)) {
        if (subjectTokens.has(candidate)) {
          return { axis: axis.key, token: candidate };
        }
      }
    }
  }
  return null;
}

function matchesTagSubstring(
  tags: readonly string[],
  substrings: readonly string[],
): string | null {
  for (const tag of tags) {
    for (const needle of substrings) {
      if (tag.includes(needle)) return tag;
    }
  }
  return null;
}

/**
 * Judge ONE candidate against ONE user's preferences.
 *
 * Evaluation order is deliberate — most-severe rule first — so that when a row
 * violates several things, the reported `rule` is the one that matters most for
 * copy and for logs. A product that is both a dislike and an allergen must
 * report the allergen.
 */
export function assessAvoidance(
  subject: AvoidanceSubject,
  preferences: AvoidancePreferences,
): AvoidanceVerdict {
  const subjectTokens = new Set(tokeniseFoodName(subject.name));
  const allergenTags = subject.allergenTags;
  const categoryTags = subject.categoryTags ?? [];

  // ── 1. Allergens — tag-derived, fail closed ───────────────────────────────
  const avoidedAllergens = preferences.avoidAllergens.filter(isAllergenKey);

  if (avoidedAllergens.length > 0) {
    if (allergenTags === null) {
      // THE fail-closed case. An untagged row is never cleared by its name.
      return {
        allowed: false,
        rule: "allergen_unknown",
        cause: avoidedAllergens.join(","),
        evidence: "allergen_tags is null",
      };
    }

    for (const tag of allergenTags) {
      if (!isInterpretableAllergenTag(tag)) {
        return {
          allowed: false,
          rule: "allergen_uninterpretable",
          cause: avoidedAllergens.join(","),
          evidence: tag,
        };
      }
      const owner = TAG_TO_ALLERGEN.get(tag);
      if (owner !== undefined && avoidedAllergens.includes(owner)) {
        return {
          allowed: false,
          rule: "allergen_tag",
          cause: owner,
          evidence: tag,
        };
      }
    }
  }

  // ── 2. Dietary patterns ───────────────────────────────────────────────────
  const patterns = preferences.dietaryPatterns.filter(isDietaryPattern);
  let partialEnforcementOnly = false;

  for (const pattern of patterns) {
    const rule = DIETARY_PATTERN_RULES[pattern];
    if (rule.partialEnforcementOnly) partialEnforcementOnly = true;

    // 2a. Tag rules, where the row has tags to test.
    if (allergenTags !== null) {
      for (const tag of allergenTags) {
        if (rule.allergenTags.includes(tag)) {
          return {
            allowed: false,
            rule: "pattern_tag",
            cause: pattern,
            evidence: tag,
          };
        }
      }
    }
    const categoryHit = matchesTagSubstring(
      categoryTags,
      rule.categoryTagSubstrings,
    );
    if (categoryHit !== null) {
      return {
        allowed: false,
        rule: "pattern_tag",
        cause: pattern,
        evidence: categoryHit,
      };
    }

    // 2b. Name rules, split by evidence channel — see the two field docstrings
    //      on `DietaryPatternRule`, which carry the full reasoning.
    //
    //      `nameTokensAlways` covers axes with NO allergen-tag representation
    //      (meat, pork, alcohol, honey): a row can legitimately have
    //      `allergen_tags = []` and no categories at all, so the name is the
    //      last line of defence rather than a fallback.
    const alwaysHit = matchesAnyAxis(
      subject.name,
      subjectTokens,
      rule.nameAxesAlways,
    );
    if (alwaysHit !== null) {
      return {
        allowed: false,
        rule: "pattern_name",
        cause: pattern,
        evidence: alwaysHit.token,
      };
    }

    //      `nameAxesWhenUntagged` covers axes an allergen tag DOES represent,
    //      so it yields to that better evidence. Applying it anyway is what
    //      excludes "Gluten Free Bread" from a gluten-free user's pool.
    if (allergenTags === null) {
      const untaggedHit = matchesAnyAxis(
        subject.name,
        subjectTokens,
        rule.nameAxesWhenUntagged,
      );
      if (untaggedHit !== null) {
        return {
          allowed: false,
          rule: "pattern_name",
          cause: pattern,
          evidence: untaggedHit.token,
        };
      }
    }
  }

  // ── 3. Dislikes — name only, no safety claim ──────────────────────────────
  for (const dislike of preferences.avoidFoods) {
    const dislikeTokens = tokeniseFoodName(dislike);
    if (dislikeTokens.length === 0) continue;
    // ALL tokens must be present, so the multi-word dislike "chicken thigh"
    // matches "Chicken Thighs" but not every chicken product. Single-word
    // dislikes behave as you would expect.
    const everyTokenPresent = dislikeTokens.every(
      (token) =>
        subjectTokens.has(token) &&
        // "Mushroom-free soup" is not a mushroom product.
        !isTokenNegatedInName(subject.name, token),
    );
    if (everyTokenPresent) {
      return {
        allowed: false,
        rule: "dislike_name",
        cause: dislike,
        evidence: dislikeTokens.join(" "),
      };
    }
  }

  return {
    allowed: true,
    unverified: allergenTags === null,
    partialEnforcementOnly,
  };
}

export interface AvoidancePartition<T extends AvoidanceSubject> {
  kept: T[];
  /** Every rejection, with its reason — never silently dropped (design § 1). */
  rejected: Array<{
    subject: T;
    verdict: Extract<AvoidanceVerdict, { allowed: false }>;
  }>;
}

/**
 * Partition a candidate list. Returns rejections rather than discarding them so
 * a caller can log WHY a pool came out thin — "Mealprint can't find anything I
 * can eat" is otherwise undiagnosable, and with the tag backfill outstanding it
 * is the expected early failure (see `20260803120000_foods_mealprint_tags.sql`).
 */
export function partitionByAvoidance<T extends AvoidanceSubject>(
  subjects: readonly T[],
  preferences: AvoidancePreferences,
): AvoidancePartition<T> {
  const kept: T[] = [];
  const rejected: AvoidancePartition<T>["rejected"] = [];

  for (const subject of subjects) {
    const verdict = assessAvoidance(subject, preferences);
    if (verdict.allowed) kept.push(subject);
    else rejected.push({ subject, verdict });
  }

  return { kept, rejected };
}

/**
 * Does this preference set impose any ALLERGEN-grade constraint? Drives whether
 * a surface must render the label-check disclaimer, and whether the candidate
 * SQL needs the interpretable-tags predicate at all (with no allergen chips set
 * there is nothing to fail closed about, so the pool keeps untagged rows).
 */
export function hasAllergenConstraint(
  preferences: Pick<AvoidancePreferences, "avoidAllergens">,
): boolean {
  return preferences.avoidAllergens.some(isAllergenKey);
}

/** Do any active patterns carry the "we cannot verify certification" caveat? */
export function hasPartialEnforcementPattern(
  preferences: Pick<AvoidancePreferences, "dietaryPatterns">,
): boolean {
  return preferences.dietaryPatterns
    .filter(isDietaryPattern)
    .some((pattern) => DIETARY_PATTERN_RULES[pattern].partialEnforcementOnly);
}

/** The OFF tags an avoid-allergen selection forbids — used to build the pool SQL. */
export function forbiddenAllergenTags(
  avoidAllergens: readonly string[],
): string[] {
  const out = new Set<string>();
  for (const key of avoidAllergens) {
    if (!isAllergenKey(key)) continue;
    for (const tag of ALLERGEN_OFF_TAGS[key]) out.add(tag);
  }
  return [...out];
}

/** The OFF allergen tags an active pattern set forbids. */
export function forbiddenPatternAllergenTags(
  dietaryPatterns: readonly string[],
): string[] {
  const out = new Set<string>();
  for (const pattern of dietaryPatterns) {
    if (!isDietaryPattern(pattern)) continue;
    for (const tag of DIETARY_PATTERN_RULES[pattern].allergenTags) out.add(tag);
  }
  return [...out];
}

export type { AllergenKey, DietaryPattern };
