/**
 * Mealprint (spec-26 design § 1 stage 1) — the pure half of candidate assembly.
 *
 * The repository fetches; this module decides what survives and in what order.
 * Split that way so the whole selection policy is unit-testable without a DB,
 * which matters because every downstream guarantee depends on the pool being
 * exactly what the caller believes it is.
 */

import {
  partitionByAvoidance,
  type AvoidancePreferences,
  type AvoidanceRule,
} from "../safety/avoidanceFilter";
import { tokeniseFoodName } from "../preferences/vocabulary";
import type { MealprintCandidate } from "../../../repositories/mealprintCandidateRepository";

/**
 * The pool cap handed to the model (design § 1: "capped ~150–200 candidates —
 * same cap philosophy as Loadout's ~150 exercises").
 *
 * A cap is not thrift. It bounds the prompt, and therefore the latency and the
 * truncation risk, on a synchronous request under a 29 s route budget.
 */
export const CANDIDATE_CAP = 200;

export interface AssemblyStats {
  /** How many rows the repository returned, before any filtering. */
  fetched: number;
  /** Rejected by `avoidanceFilter`, grouped by rule. */
  rejectedByRule: Record<AvoidanceRule, number>;
  /** Dropped as near-duplicates of a candidate already kept. */
  deduped: number;
  /** TRUE when the cap discarded candidates that had passed every filter. */
  truncated: boolean;
  /**
   * TRUE when any surviving candidate has UNKNOWN allergen content, i.e. the
   * caller must render the label-check disclaimer (AC 1.2 / AC 3.4).
   */
  containsUnverified: boolean;
}

export interface AssemblyResult {
  candidates: MealprintCandidate[];
  stats: AssemblyStats;
}

function emptyRuleCounts(): Record<AvoidanceRule, number> {
  return {
    allergen_tag: 0,
    allergen_unknown: 0,
    allergen_uninterpretable: 0,
    pattern_tag: 0,
    pattern_name: 0,
    dislike_name: 0,
  };
}

/**
 * Collapse the OFF catalogue's near-duplicates.
 *
 * ⚠ Without this the pool is dominated by them. The UK OFF slice carries dozens
 * of rows for the same product across pack sizes and retailer listings, and
 * protein-density ordering groups them adjacently — so a naive top-200 can be
 * twenty distinct foods wearing 200 hats, which wastes the prompt AND makes the
 * model's output look repetitive for reasons that have nothing to do with the
 * model.
 *
 * The key is the token SET of the name plus the macro profile rounded to whole
 * numbers: same words, same macros, same food. Rounding matters — two listings
 * of one yoghurt differ in the third decimal of fat.
 */
export function dedupeKey(candidate: MealprintCandidate): string {
  const tokens = [...new Set(tokeniseFoodName(candidate.name))]
    .sort()
    .join(" ");
  return [
    tokens,
    Math.round(candidate.kcal),
    Math.round(candidate.proteinG),
    Math.round(candidate.carbsG),
    Math.round(candidate.fatG),
  ].join("|");
}

/**
 * Rank a filtered pool. Own rows and liked foods first, then the repository's
 * protein-density order (which arrives already applied, so this is a STABLE
 * partition rather than a re-sort).
 *
 * ⚠ Likes are a BIAS, never a constraint (locked decision 1 / design § 1
 * stage 1). Promoting them cannot empty a pool the way filtering on them would,
 * and a user who likes three things still sees the rest of the pool.
 *
 * ⚠ The `isOwn` tier is NOT equally harmless, because own rows can fill the cap
 * outright — see {@link capWithCuratedFloor}, which is what stops this ranking
 * from becoming a partition.
 */
export function rankCandidates(
  candidates: readonly MealprintCandidate[],
  likedFoods: readonly string[],
): MealprintCandidate[] {
  const likedTokens = new Set(
    likedFoods.flatMap((food) => tokeniseFoodName(food)),
  );

  const tier = (candidate: MealprintCandidate): number => {
    const nameTokens = tokeniseFoodName(candidate.name);
    const isLiked =
      likedTokens.size > 0 &&
      nameTokens.some((token) => likedTokens.has(token));
    if (candidate.isOwn && isLiked) return 0;
    if (isLiked) return 1;
    if (candidate.isOwn) return 2;
    return 3;
  };

  // `Array.prototype.sort` is stable in every engine we target, so equal tiers
  // keep the repository's deterministic ordering. That determinism is a
  // prerequisite for evaluating the stage above this one.
  return [...candidates].sort((a, b) => tier(a) - tier(b));
}

/**
 * Fraction of the cap RESERVED for curated-catalogue rows when own rows would
 * otherwise fill it.
 *
 * ⚠ `rankCandidates` tiers own rows entirely ahead of curated ones, and
 * `OWN_FOOD_LIMIT` (200) equals {@link CANDIDATE_CAP} (200) — so a plain
 * `slice(0, cap)` means a user with 200+ own foods NEVER sees a single curated
 * candidate. That turns the "bias" into a hard partition: the answer to "what can
 * I eat?" collapses to "something you have already logged", which is the opposite
 * of the inspiration this feature exists to provide, and it degrades silently as
 * a user's library grows.
 *
 * A floor rather than an interleave, because own rows genuinely SHOULD dominate —
 * they are foods the user demonstrably eats. 25 % keeps ~50 curated rows in a
 * 200-row pool, which is enough for the model to compose something new.
 */
export const CURATED_FLOOR_FRACTION = 0.25;

/**
 * Cap the ranked pool, guaranteeing curated rows a share whenever both kinds are
 * available and own rows would crowd them out entirely.
 *
 * Preserves ranked order in the output — the floor decides WHICH rows survive, not
 * what order they are offered in, because the ranking is what the prompt's
 * relevance ordering depends on.
 */
export function capWithCuratedFloor(
  ranked: readonly MealprintCandidate[],
  cap: number,
): MealprintCandidate[] {
  if (ranked.length <= cap) return [...ranked];

  const naive = ranked.slice(0, cap);
  const curatedInNaive = naive.filter((c) => !c.isOwn).length;
  const floor = Math.floor(cap * CURATED_FLOOR_FRACTION);
  const curatedAvailable = ranked.filter((c) => !c.isOwn).length;
  const target = Math.min(floor, curatedAvailable);

  if (curatedInNaive >= target) return naive;

  // Keep the top-ranked own rows up to the remaining budget, then the
  // top-ranked curated rows up to the floor, then restore ranked order.
  const ownBudget = cap - target;
  const chosen = new Set<MealprintCandidate>();
  let own = 0;
  let curated = 0;
  for (const candidate of ranked) {
    if (candidate.isOwn) {
      if (own < ownBudget) {
        chosen.add(candidate);
        own += 1;
      }
    } else if (curated < target) {
      chosen.add(candidate);
      curated += 1;
    }
    if (own >= ownBudget && curated >= target) break;
  }
  return ranked.filter((candidate) => chosen.has(candidate));
}

/**
 * Filter → dedupe → rank → cap. The whole stage-1 policy in one place.
 *
 * ⚠ Order matters and each step is where it is for a reason:
 *   - FILTER first, so nothing unsafe can be promoted by the ranking or survive
 *     via a dedupe collision.
 *   - DEDUPE before ranking, so a duplicate cannot displace a distinct food.
 *   - CAP last, so the cap discards the least relevant survivors rather than an
 *     arbitrary slice of the raw fetch.
 */
export function assembleCandidates(
  fetched: readonly MealprintCandidate[],
  preferences: AvoidancePreferences & { likedFoods?: readonly string[] },
  cap: number = CANDIDATE_CAP,
): AssemblyResult {
  const { kept, rejected } = partitionByAvoidance(fetched, preferences);

  const rejectedByRule = emptyRuleCounts();
  for (const { verdict } of rejected) rejectedByRule[verdict.rule] += 1;

  const seen = new Set<string>();
  const unique: MealprintCandidate[] = [];
  let deduped = 0;
  for (const candidate of kept) {
    const key = dedupeKey(candidate);
    if (seen.has(key)) {
      deduped += 1;
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }

  const ranked = rankCandidates(unique, preferences.likedFoods ?? []);
  const capped = capWithCuratedFloor(ranked, cap);

  return {
    candidates: capped,
    stats: {
      fetched: fetched.length,
      rejectedByRule,
      deduped,
      truncated: ranked.length > capped.length,
      // Computed over the CAPPED set, not the filtered one: the disclaimer is a
      // statement about what the user is being shown.
      containsUnverified: capped.some(
        (candidate) => candidate.allergenTags === null,
      ),
    },
  };
}

/**
 * One line summarising an assembly, for the handler's log.
 *
 * ⚠ Not decoration. With the tag backfill outstanding
 * (`20260803120000_foods_mealprint_tags.sql`), a thin pool is the EXPECTED early
 * failure and it presents to the user as "Mealprint can't suggest anything" —
 * which points nowhere. This line names the rule that did the excluding, so the
 * difference between "the backfill has not run" (`allergen_unknown` dominant)
 * and "this user really has excluded everything" is one grep.
 *
 * Counts and rule names only — no food names, no preference values.
 */
export function describeAssembly(stats: AssemblyStats): string {
  const rules = Object.entries(stats.rejectedByRule)
    .filter(([, count]) => count > 0)
    .map(([rule, count]) => `${rule}=${count}`)
    .join(" ");
  return [
    `fetched=${stats.fetched}`,
    rules || "rejected=0",
    `deduped=${stats.deduped}`,
    `truncated=${stats.truncated}`,
    `unverified=${stats.containsUnverified}`,
  ].join(" ");
}
