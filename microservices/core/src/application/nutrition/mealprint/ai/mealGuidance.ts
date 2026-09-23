import type { MealprintCandidate } from "../../../repositories/mealprintCandidateRepository";
import { assessAvoidance } from "../safety/avoidanceFilter";

// Deliberately bounded culinary vocabulary, not a general natural-language parser.
// Restaurant names never enter this parser. Multi-meal plans use prompt guidance
// only: a request for chicken at dinner must not constrain every breakfast.
const PROTEINS: Record<string, readonly string[]> = {
  chicken: ["chicken"],
  turkey: ["turkey"],
  beef: ["beef"],
  pork: ["pork"],
  lamb: ["lamb"],
  tofu: ["tofu"],
  tempeh: ["tempeh"],
  egg: ["egg", "eggs"],
  salmon: ["salmon"],
  tuna: ["tuna"],
  prawn: ["prawn", "prawns", "shrimp", "shrimps"],
  fish: [
    "fish",
    "salmon",
    "tuna",
    "cod",
    "haddock",
    "sea bass",
    "seabass",
    "trout",
    "sardines",
    "mackerel",
  ],
  shellfish: [
    "shellfish",
    "prawn",
    "prawns",
    "shrimp",
    "shrimps",
    "crab",
    "lobster",
    "mussels",
    "scallops",
  ],
};
const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const contains = (name: string, term: string) =>
  ` ${words(name)} `.includes(` ${term} `);

export interface MealGuidance {
  /** Every group is required; any protein within a group satisfies alternatives. */
  required: string[][];
  excluded: string[];
  quick: boolean;
}

export function parseMealGuidance(steer?: string | null): MealGuidance {
  const text = (steer ?? "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\b(?:anything but|instead of|rather than)\b/g, "without");
  const required: string[][] = [];
  const excluded: string[] = [];
  // Contrast / 'with' ends a negative clause; commas can continue a food list.
  // Bound preparation qualifiers without treating unrelated prose as negation.
  const qualifiers =
    "(?:(?:any|some|more|the|a|an|of|grilled|roast|roasted|fried|steamed|baked|smoked|cooked|raw|sliced|minced|diced|shredded|poached|boiled|tinned|canned|fresh|frozen|lean)\\s+)*";
  const directNegation = new RegExp(
    `\\b(?:no|not|without|avoid|excluding|exclude|dislike|hate|don't (?:want|like)|do not (?:want|like))\\s+${qualifiers}$`,
  );
  const listContinuation = new RegExp(
    `^\\s*(?:,\\s*(?:(?:and|or|nor)\\s+)?|(?:and|or|nor|&|/)\\s+)${qualifiers}$`,
  );
  const clauses = text
    .replace(/\bno[- ]cook\b/g, "")
    .split(/[;.!?]|\b(?:but|with|instead)\b/);
  for (const clause of clauses) {
    const positive: string[] = [];
    const pattern =
      /\b(chicken|turkey|beef|pork|lamb|tofu|tempeh|eggs?|salmon|tuna|prawns?|shrimps?|fish|shellfish)\b/g;
    let previousEnd = 0;
    let previousNegative = false;
    for (const match of clause.matchAll(pattern)) {
      const key = Object.keys(PROTEINS).find(
        (key) => key === match[0] || PROTEINS[key].includes(match[0]),
      )!;
      const before = clause.slice(previousEnd, match.index);
      const after = clause.slice(match.index! + match[0].length);
      // Negation must lead directly into a food/list, not merely appear
      // earlier in prose ("not too spicy and chicken based"). Carry it only
      // across list conjunctions, as in "no chicken or fish".
      const directlyNegated = directNegation.test(before);
      const continuesNegativeList: boolean =
        previousNegative && listContinuation.test(before);
      const negative: boolean =
        directlyNegated || continuesNegativeList || /^[- ]free\b/.test(after);
      previousNegative = negative;
      previousEnd = match.index! + match[0].length;
      if (negative) excluded.push(key);
      else positive.push(key);
    }
    if (/\bor\b/.test(clause) && positive.length > 1)
      required.push([...new Set(positive)]);
    else required.push(...[...new Set(positive)].map((key) => [key]));
  }
  return {
    required: [
      ...new Map(
        required.map((group) => [group.slice().sort().join("|"), group]),
      ).values(),
    ],
    excluded: [...new Set(excluded)],
    quick: /\b(?:quick|fast|easy|simple|no[- ]cook)\b/.test(text),
  };
}

export function guidanceSearchTerms(guidance: MealGuidance): string[] {
  return [...new Set(guidance.required.flat().flatMap((key) => PROTEINS[key]))];
}

function isProtein(candidate: MealprintCandidate, key: string): boolean {
  // A generated title or saved recipe title cannot prove its ingredients. Nor
  // can chicken-flavoured crisps, stock, or a plant-based imitation prove chicken.
  const foodName = candidate.unbrandedName ?? candidate.name;
  if (candidate.kind !== "food" || candidate.proteinG <= 0) return false;
  if (
    /\b(?:flavou?r(?:ed|ing)?|stock|broth|seasoning|crisps?|style|substitute|alternative)\b/i.test(
      foodName,
    )
  )
    return false;
  if (
    !["tofu", "tempeh"].includes(key) &&
    /\b(?:vegan|vegetarian|plant[- ]based|meatless)\b/i.test(foodName)
  )
    return false;
  return PROTEINS[key].some(
    (term) => contains(foodName, term) && !contains(foodName, `${term} free`),
  );
}

export function matchesRequiredGuidance(
  candidate: MealprintCandidate,
  guidance: MealGuidance,
): boolean {
  return guidance.required.some((group) =>
    group.some((key) => isProtein(candidate, key)),
  );
}

export function permitsGuidance(
  candidate: MealprintCandidate,
  guidance: MealGuidance,
): boolean {
  return assessAvoidance(
    { ...candidate, name: candidate.unbrandedName ?? candidate.name },
    {
      dietaryPatterns: [],
      avoidAllergens: [],
      avoidFoods: guidance.excluded.flatMap((key) => PROTEINS[key]),
    },
  ).allowed;
}

export function canMeetGuidance(
  candidates: readonly MealprintCandidate[],
  guidance: MealGuidance,
): boolean {
  return guidance.required.every((group) =>
    candidates.some(
      (candidate) =>
        group.some((key) => isProtein(candidate, key)) &&
        candidate.proteinG * candidate.maxServings >= 5,
    ),
  );
}

export function compositionMeetsGuidance(
  items: readonly { candidateId: string; servings: number }[],
  candidates: ReadonlyMap<string, MealprintCandidate>,
  guidance: MealGuidance,
): boolean {
  const resolved = items.map((item) => ({
    candidate: candidates.get(item.candidateId),
    servings: item.servings,
  }));
  if (
    resolved.some(
      ({ candidate }) => !candidate || !permitsGuidance(candidate, guidance),
    )
  )
    return false;
  const totalProtein = resolved.reduce(
    (sum, { candidate, servings }) => sum + candidate!.proteinG * servings,
    0,
  );
  // A token sprinkle cannot fulfil a requested protein. Each requested group
  // must supply at least 5g. One requested protein must supply at least half
  // the plate's protein; multiple explicit groups each supply at least a quarter.
  return guidance.required.every(
    (group) =>
      resolved.reduce(
        (sum, { candidate, servings }) =>
          sum +
          (group.some((key) => isProtein(candidate!, key))
            ? candidate!.proteinG * servings
            : 0),
        0,
      ) >=
      Math.max(5, totalProtein * (guidance.required.length === 1 ? 0.5 : 0.25)),
  );
}
