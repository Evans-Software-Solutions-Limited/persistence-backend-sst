/**
 * Deterministic allergen and known dietary-pattern safety checks. Run during
 * candidate assembly, verification, and plan acceptance/replacement.
 * Allergens remain tag-derived and fail closed; known dietary patterns retain
 * their existing tag/name rules. Free-text dislikes, exceptions and requests
 * are passed verbatim to the composer and are never parsed here.
 * Crowd-sourced metadata cannot establish contamination or certification:
 * callers retain the existing label-check and partial-enforcement notices.
 */

import {
  ALLERGEN_OFF_TAGS,
  DIETARY_PATTERN_RULES,
  isAllergenKey,
  isDietaryPattern,
  isTokenNegatedInName,
  normaliseFoodText,
  singularise,
  tokeniseFoodName,
  type AllergenKey,
  type DietaryPattern,
  type NameAxis,
  type TokenQualifier,
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
  /** Free-text culinary context for AI; never interpreted by this safety filter. */
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
  | "pattern_name";

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
 *   - `en:` present → OFF matched it to a NAMED taxonomy allergen.
 *   - anything else → unmatched producer free text, so we do not know what it
 *     says. It could be a translation of the very allergen being avoided.
 *
 * ⚠ **This predicate answers ONLY "is the string readable", not "is the row
 * safe".** Whether a readable-but-unclassifiable tag (`en:corn`) clears the row
 * is a separate decision, taken in `assessAvoidance`'s `owner === undefined`
 * branch — which FAILS CLOSED. An earlier version of this docstring argued the
 * opposite ("safe to leave the row in, because taxonomy names are distinct");
 * that reasoning was wrong for OFF's hierarchy and singular variants, and the
 * branch below now contradicts it. Read the branch, not this comment, for the
 * safety rule.
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
/**
 * Is this axis cleared for this subject — by an explicit free-from PHRASING
 * ("gluten free", "no beef") or by a without-this-axis MARKER ("vegan",
 * "plant-based") in the name?
 *
 * The marker channel is compared against a de-punctuated name so
 * "plant-based" / "plant based" / "plantbased" all read the same, which is how
 * OFF and retailers actually spell it.
 */
function isAxisCleared(
  subjectName: string,
  subjectTokens: ReadonlySet<string>,
  compactName: string,
  categoryTags: readonly string[],
  axis: NameAxis,
): boolean {
  if (axis.negators.some((n) => isTokenNegatedInName(subjectName, n))) {
    return true;
  }
  if (
    axis.clearedBy.some(
      (marker) => subjectTokens.has(marker) || compactName.includes(marker),
    )
  ) {
    return true;
  }
  // ⚠ A marker on a CATEGORY TAG clears the axis for BOTH channels — but ONLY
  // when the tag carrying it is ABOUT this axis.
  //
  // Three bugs lived here, and the third was introduced by the fix to the second.
  //
  //   1. OFF's `categories_tags` is HIERARCHICAL, so a vegan cheese carries
  //      `en:vegan-cheeses` AND its parent `en:cheeses`. A per-tag skip stepped
  //      past the marker-bearing child only to match the parent next iteration.
  //   2. The marker was consulted by the category channel only, so
  //      `Cheddar Style Block` cleared the category rule and was then excluded by
  //      the NAME rule on "cheddar" anyway.
  //   3. ⚠ Fixing (1) and (2) with a bare `compactTag.includes(marker)` over the
  //      whole array made it FAR too powerful, because the same hierarchy that
  //      causes (1) also means every row carries its ANCESTORS.
  //      `en:plant-based-foods` and `en:plant-based-foods-and-beverages` compact
  //      to strings containing `plantbased`, and `en:viennoiserie`, `en:breads`,
  //      `en:pastas`, `en:sauces` and `en:nuts` all sit beneath them. So for a
  //      vegan or dairy-free user the meat, dairy, egg and seafood axes were
  //      cleared across most of the cereals/pastry/sauces catalogue:
  //
  //        `All Butter Croissant` / `["en:viennoiserie","en:plant-based-foods-and-beverages"]`
  //          → served to a DAIRY-FREE user (a regression: before the marker
  //            reached the name channel, "butter" fired)
  //        `Green Pesto` / `["en:sauces","en:plant-based-foods"]` → served to a vegan
  //        `Chicken and Bacon Pasta Salad` / `["en:meals","en:plant-based-foods"]`
  //          → served to a VEGETARIAN
  //
  // The discriminator is RELEVANCE: the marker-bearing tag must also match one of
  // this axis' own `categorySubstrings`. `en:vegan-cheeses` carries `vegan` AND
  // `cheese`, so it still clears dairy; `en:meat-substitutes` carries `substitute`
  // AND `meat`; `en:non-alcoholic-beers` carries `nonalcoholic` AND `beers`.
  // `en:plant-based-foods` says nothing about dairy and no longer clears it.
  return categoryTags.some((tag) => {
    const compactTag = tag.replace(/[^a-z0-9]+/gu, "");
    const carriesMarker = axis.clearedBy.some((marker) =>
      compactTag.includes(marker),
    );
    if (!carriesMarker) return false;
    // ⚠ `categorySubstrings` OR `tokens`. The substring lists are short CATEGORY
    // words ("dairy", "cheese"), but OFF's plant-based tags name the PRODUCT — so
    // relevance-by-category-alone was too tight and newly excluded four real
    // products from the pools they exist for: `en:vegetarian-sausages`,
    // `en:vegan-mayonnaises`, `en:vegan-ice-creams`, `en:vegan-bacon-alternatives`.
    // Each of those DOES contain one of its axis' own tokens.
    //
    // Verified not to reopen the ancestor hole: none of `en:plant-based-foods`,
    // `en:plant-based-foods-and-beverages`, `en:viennoiserie`, `en:breads`,
    // `en:pastas`, `en:sauces`, `en:meals`, `en:nuts` or
    // `en:cereals-and-potatoes` contains a token of the meat, dairy, egg,
    // seafood, shellfish or honey axes.
    return (
      axis.categorySubstrings.some((needle) => tag.includes(needle)) ||
      axis.tokens.some((token) => tag.includes(token))
    );
  });
}

/** Lowercased, accent-stripped, punctuation-free — for marker containment. */
function compactify(name: string): string {
  return normaliseFoodText(name).replace(/[^a-z0-9]+/gu, "");
}

/**
 * First CATEGORY-tag hit across `axes`, honouring per-axis free-from negation.
 *
 * ⚠ Callers run this UNCONDITIONALLY — it is NOT gated on whether the row's
 * allergen tags are usable, and that is the correction to a regression this
 * module briefly shipped. Folding categories into the name matcher made them
 * conditional on `!tagsUsable`, and `tagsUsable` is true for `[]` and for any
 * PARTIALLY-tagged row. OFF's tagging is routinely partial, so the effect was:
 *
 *   - `Fishermans Pie` / `["en:milk"]` / `["en:fish-pies"]` served to a vegetarian
 *   - `Cathedral City` / `["en:gluten"]` / `["en:cheeses"]` served to a dairy-free user
 *   - `Oriental Nibbles` / `["en:gluten"]` / `["en:crustacean-products"]` to a kosher user
 *
 * …all reported `unverified: false`. The mistake was treating an allergen tag's
 * SILENCE as evidence of absence. It is not: a category tag is INDEPENDENT
 * evidence that a missing allergen tag does not refute, which is exactly why the
 * rule was unconditional to begin with. What the negation guard adds is that
 * "Gluten Free Bread" still survives `en:breads` — the false positive that
 * motivated the move — without giving up the true positives.
 */
function matchesAxisCategories(
  subjectName: string,
  subjectTokens: ReadonlySet<string>,
  compactName: string,
  categoryTags: readonly string[],
  axes: readonly NameAxis[],
): { axis: string; evidence: string } | null {
  for (const axis of axes) {
    if (
      isAxisCleared(subjectName, subjectTokens, compactName, categoryTags, axis)
    ) {
      continue;
    }
    for (const tag of categoryTags) {
      for (const needle of axis.categorySubstrings) {
        if (tag.includes(needle)) {
          return { axis: axis.key, evidence: tag };
        }
      }
    }
  }
  return null;
}

/** First NAME-token hit across `axes`, honouring per-axis free-from negation. */
/**
 * Is every occurrence of `token` in `orderedTokens` immediately preceded by one
 * of `qualifiers`?
 *
 * ⚠ **ADJACENCY, not set membership, and the difference is six confirmed false
 * negatives.** The first version asked only whether a qualifier appeared ANYWHERE
 * in the name, which disqualified the token on any unrelated co-occurrence:
 *
 *   `Cream of Tomato Soup`            → dairy-free  ("tomato" qualified "cream")
 *   `Rice Pudding Made With Whole Milk` → dairy-free ("rice" qualified "milk")
 *   `Coconut Milk Chocolate Bar`      → dairy-free
 *   `Oat and Milk Chocolate Biscuits` → dairy-free
 *   `Cocoa Butter Fudge`              → dairy-free
 *   `Wholemeal Flour 500 Gram`        → gluten-free ("gram" is also a mass unit)
 *
 * Every INTENDED clear is an adjacent compound — *peanut* butter, *almond* flour,
 * *soya* milk, *rice* noodles — so adjacency keeps all of those and kills all of
 * the above.
 *
 * ⚠ **Direction comes from the ENTRY** ({@link TokenQualifier}), because a single
 * global rule failed in both directions. Preceding-only re-excluded `Red Kidney
 * Beans` (its qualifier is the head noun that FOLLOWS). Either-side then cleared
 * real products on a co-ingredient or pack claim after the token —
 * `Maliban Butter Coconut Biscuits`, `Cadbury Dairy Milk Coconut`,
 * `Butter Almond Cake`, `Pasta Lentil Soup`, `Sliced Loaf Nut Free`.
 *
 * "Every occurrence" rather than "any": `Soya Milk and Milk Chocolate` must stay
 * excluded on the second, unqualified "milk".
 */
function everyOccurrenceQualified(
  orderedTokens: readonly string[],
  token: string,
  qualifier: TokenQualifier,
): boolean {
  const before = new Set((qualifier.before ?? []).map(singularise));
  const after = new Set((qualifier.after ?? []).map(singularise));
  if (before.size === 0 && after.size === 0) return false;

  let sawOne = false;
  for (let i = 0; i < orderedTokens.length; i += 1) {
    if (orderedTokens[i] !== token) continue;
    sawOne = true;

    // ⚠ Step over a possessive "s". `tokeniseFoodName("Shepherd's Pie")` yields
    // ["shepherd","s","pie"], so a raw i-1 lookup sees "s" and the qualifier never
    // matches — which would have left Shepherd's and Fisherman's Pie excluded from
    // a gluten-free pool while Pork Pie sailed through.
    let b = i - 1;
    if (b >= 0 && orderedTokens[b] === "s") b -= 1;

    const previous = b >= 0 ? orderedTokens[b] : null;
    const next = i + 1 < orderedTokens.length ? orderedTokens[i + 1] : null;
    const qualified =
      (previous !== null && before.has(previous)) ||
      (next !== null && after.has(next));
    if (!qualified) return false;
  }
  return sawOne;
}

function matchesAxisNames(
  subjectName: string,
  orderedTokens: readonly string[],
  subjectTokens: ReadonlySet<string>,
  compactName: string,
  categoryTags: readonly string[],
  axes: readonly NameAxis[],
): { axis: string; evidence: string } | null {
  for (const axis of axes) {
    if (
      isAxisCleared(subjectName, subjectTokens, compactName, categoryTags, axis)
    ) {
      continue;
    }
    for (const token of axis.tokens) {
      // Axis token lists are authored singular already, but singularising both
      // sides costs nothing and removes a class of authoring slip.
      for (const candidate of tokeniseFoodName(token)) {
        if (!subjectTokens.has(candidate)) continue;
        // ⚠ Per-TOKEN disqualifiers, deliberately not axis-clearing: "Peanut
        // Butter" must stop counting as dairy without "Almond & Wheat Flour
        // Blend" ceasing to count as gluten. See `NameAxis.tokenQualifiers`.
        const qualifier = axis.tokenQualifiers?.[candidate];
        if (
          qualifier !== undefined &&
          everyOccurrenceQualified(orderedTokens, candidate, qualifier)
        ) {
          continue;
        }
        return { axis: axis.key, evidence: candidate };
      }
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
  // Ordered AND set form: the set answers "is this token present", the ordered
  // array answers "what precedes it", which `tokenQualifiers` needs for adjacency.
  const orderedTokens = tokeniseFoodName(subject.name);
  const subjectTokens = new Set(orderedTokens);
  const compactName = compactify(subject.name);
  const allergenTags = subject.allergenTags;
  const categoryTags = subject.categoryTags ?? [];

  /**
   * ⚠ "Tags present but UNREADABLE is the same evidential state as no tags."
   *
   * Used for the ALLERGEN path (§ 1) and for the `unverified` flag. The pattern
   * path no longer consults it at all: its name channel is unconditional, which
   * is what finally closed the "row tagged `['fr:gluten']` satisfies neither
   * channel" hole — the tag rule missed on the wrong language and the name rule
   * was skipped because tags were "present", so a `gluten_free` user was served
   * "Pain de Campagne" without even a flag.
   */
  const tagsUsable =
    allergenTags !== null && allergenTags.every(isInterpretableAllergenTag);

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
      if (owner === undefined) {
        // ⚠ FAIL CLOSED ON AN UNCLASSIFIABLE ALLERGEN TAG, and this reverses an
        // earlier, wrong call.
        //
        // The first cut cleared any `en:` tag on the argument that "taxonomy
        // names are distinct, so we know it is not the avoided one". That premise
        // does not hold for the hierarchy: OFF emits child and singular variants
        // (`en:hazelnut` under `en:nuts`) and {@link ALLERGEN_OFF_TAGS} is a
        // HAND-ENUMERATED list. Any variant missing from it — and the file's own
        // hedging on `en:egg`/`en:eggs`, `en:soy`/`en:soybeans` shows the authors
        // knew variants exist — used to return `allowed: true`. That is a false
        // NEGATIVE on an allergen, which this module's docstring calls "the one
        // error class this whole module exists to avoid".
        //
        // An `en:` tag we cannot classify means "this product DECLARES a
        // regulated allergen and we do not know which". For someone with an
        // allergen chip set, that is the unknown case, and the unknown case is
        // excluded.
        //
        // ⚠ The cost is real and is a pool cost, not a safety cost: a product
        // tagged with a taxonomy allergen outside our 14 (`en:corn`) is excluded
        // from an allergen-avoiding user's pool even though it is irrelevant to
        // them. The follow-up that relaxes it safely is to enumerate OFF's FULL
        // allergens taxonomy and allow the classified-but-not-avoided entries;
        // until that list exists, erring here is the correct direction.
        return {
          allowed: false,
          rule: "allergen_uninterpretable",
          cause: avoidedAllergens.join(","),
          evidence: tag,
        };
      }
      if (avoidedAllergens.includes(owner)) {
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

    // 2a. ALLERGEN-tag rules, only where the tags are actually readable. An
    //     unreadable tag is handled by 2c, not silently skipped.
    if (tagsUsable) {
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

    // 2b. CATEGORY tags, over EVERY axis of the pattern, UNCONDITIONALLY.
    //     A category tag is independent evidence and an allergen tag's silence
    //     does not refute it — see `matchesAxisCategories` for the partial-tagging
    //     regression this ordering exists to prevent. The per-axis negation guard
    //     is what keeps "Gluten Free Bread" and "Vegan Cheese" in the pool.
    const categoryHit = matchesAxisCategories(
      subject.name,
      subjectTokens,
      compactName,
      categoryTags,
      rule.nameAxes,
    );
    if (categoryHit !== null) {
      return {
        allowed: false,
        rule: "pattern_tag",
        cause: pattern,
        evidence: categoryHit.evidence,
      };
    }

    // 2c. NAME tokens. ⚠ ALWAYS APPLIED — there is no longer a tag-presence gate
    //      here, and removing it is the fix for the whole class of bug this
    //      channel kept producing.
    //
    //      The gate went through three wrong shapes: `allergenTags === null`,
    //      then `tagsUsable` (true for any PARTIALLY-tagged row), then
    //      "did the row make a complete `[]` negative claim". Each one leaked,
    //      because each was reasoning about whether the row's ALLERGEN tags
    //      vouched for an axis they may never have been about:
    //
    //        - `Cathedral City Mature Cheddar` / `["en:gluten"]` → dairy-free user
    //        - `Fishermans Pie` / `["en:milk"]` → vegetarian
    //        - `Whole Milk` / `[]` → dairy-free user (self-contradictory OFF data,
    //          and the name is the more trustworthy half)
    //
    //      What actually protects free-from products is `isAxisCleared`
    //      (free-from phrasing, plant-based markers on the name OR a category tag)
    //      plus `NameAxis.tokenQualifiers` ("Peanut Butter", "Almond Flour",
    //      "Soya Milk"). Those are positive evidence about the axis in question;
    //      an allergen tag's silence never was. With them carrying the load the
    //      gate is unnecessary, and the merged list cannot be gated wrongly.
    const nameHit = matchesAxisNames(
      subject.name,
      orderedTokens,
      subjectTokens,
      compactName,
      categoryTags,
      rule.nameAxes,
    );
    if (nameHit !== null) {
      return {
        allowed: false,
        rule: "pattern_name",
        cause: pattern,
        evidence: nameHit.evidence,
      };
    }
  }

  // Free-text dislikes and exceptions belong to the composer. They are passed
  // verbatim alongside the request, rather than guessed from tokens here.
  return {
    allowed: true,
    // Keyed on TAGS-USABLE, not on null: a row whose tags we cannot read is just
    // as unverified as one with no tags, and the label-check disclaimer is
    // exactly as necessary.
    unverified: !tagsUsable,
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
