import { describe, it, expect } from "vitest";
import {
  assembleCandidates,
  CANDIDATE_CAP,
  dedupeKey,
  describeAssembly,
  rankCandidates,
} from "../assembleCandidates";
import type { MealprintCandidate } from "../../../../repositories/mealprintCandidateRepository";

function candidate(over: Partial<MealprintCandidate> = {}): MealprintCandidate {
  return {
    kind: "food",
    id: "f1",
    name: "Greek Yogurt",
    kcal: 170,
    proteinG: 17,
    carbsG: 7,
    fatG: 1,
    servingLabel: "170 g",
    allergenTags: [],
    categoryTags: [],
    isOwn: false,
    ...over,
  };
}

const NO_PREFS = {
  dietaryPatterns: [] as string[],
  avoidAllergens: [] as string[],
  avoidFoods: [] as string[],
};

describe("dedupeKey", () => {
  it("collapses two listings of the same product", () => {
    // The UK OFF slice carries dozens of rows per product across pack sizes and
    // retailer listings, and protein-density ordering groups them adjacently — so
    // without this a top-200 can be twenty foods wearing 200 hats.
    const a = candidate({ id: "a", name: "Greek Yogurt Fage", fatG: 1.02 });
    const b = candidate({ id: "b", name: "Fage greek yogurts", fatG: 1.04 });
    expect(dedupeKey(a)).toBe(dedupeKey(b));
  });

  it("keeps genuinely different foods apart", () => {
    expect(dedupeKey(candidate({ name: "Greek Yogurt" }))).not.toBe(
      dedupeKey(candidate({ name: "Skyr" })),
    );
    // Same name, different macros = a different product (or a bad row); either
    // way it is not a duplicate.
    expect(dedupeKey(candidate({ kcal: 170 }))).not.toBe(
      dedupeKey(candidate({ kcal: 240 })),
    );
  });
});

describe("rankCandidates", () => {
  it("promotes own rows and liked foods without dropping anything", () => {
    // ⚠ Likes are a BIAS, never a filter (locked decision 1). A user who likes
    // three things must still see the rest of the pool.
    const pool = [
      candidate({ id: "plain" }),
      candidate({ id: "liked", name: "Chicken Thighs" }),
      candidate({ id: "own", isOwn: true, name: "My Shake" }),
      candidate({ id: "both", isOwn: true, name: "My Chicken Bowl" }),
    ];
    const ranked = rankCandidates(pool, ["chicken"]);
    expect(ranked.map((c) => c.id)).toEqual(["both", "liked", "own", "plain"]);
    expect(ranked).toHaveLength(pool.length);
  });

  it("is stable, preserving the repository's deterministic order within a tier", () => {
    // Determinism is a prerequisite for evaluating the model stage above this one.
    const pool = [
      candidate({ id: "a" }),
      candidate({ id: "b" }),
      candidate({ id: "c" }),
    ];
    expect(rankCandidates(pool, []).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("does not treat an empty like list as matching everything", () => {
    const pool = [candidate({ id: "a" }), candidate({ id: "b", isOwn: true })];
    expect(rankCandidates(pool, []).map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("assembleCandidates", () => {
  it("filters, dedupes, ranks and caps in that order", () => {
    const pool = [
      candidate({
        id: "peanut",
        name: "Peanut Butter",
        allergenTags: ["en:peanuts"],
      }),
      candidate({
        id: "yog1",
        name: "Greek Yogurt",
        allergenTags: ["en:milk"],
      }),
      candidate({
        id: "yog2",
        name: "greek yogurts",
        allergenTags: ["en:milk"],
      }),
      candidate({ id: "chick", name: "Chicken Breast", isOwn: true }),
    ];

    const { candidates, stats } = assembleCandidates(pool, {
      ...NO_PREFS,
      avoidAllergens: ["peanuts"],
    });

    expect(candidates.map((c) => c.id)).toEqual(["chick", "yog1"]);
    expect(stats.fetched).toBe(4);
    expect(stats.rejectedByRule.allergen_tag).toBe(1);
    expect(stats.deduped).toBe(1);
    expect(stats.truncated).toBe(false);
  });

  it("filters BEFORE ranking, so nothing unsafe can be promoted", () => {
    // A liked, own row that violates an allergen must still be excluded — the
    // ordering of the two steps is what guarantees it.
    const pool = [
      candidate({
        id: "own-peanut",
        name: "My Peanut Shake",
        isOwn: true,
        allergenTags: ["en:peanuts"],
      }),
      candidate({ id: "safe", name: "Rice Cakes" }),
    ];
    const { candidates } = assembleCandidates(pool, {
      ...NO_PREFS,
      avoidAllergens: ["peanuts"],
      likedFoods: ["peanut"],
    });
    expect(candidates.map((c) => c.id)).toEqual(["safe"]);
  });

  it("dedupes BEFORE capping, so duplicates cannot displace distinct foods", () => {
    const dupes = Array.from({ length: 10 }, (_, i) =>
      candidate({ id: `dup${i}`, name: "Greek Yogurt" }),
    );
    const distinct = Array.from({ length: 5 }, (_, i) =>
      candidate({ id: `d${i}`, name: `Food ${i}` }),
    );
    const { candidates, stats } = assembleCandidates(
      [...dupes, ...distinct],
      NO_PREFS,
      6,
    );
    expect(stats.deduped).toBe(9);
    // 1 surviving duplicate + 5 distinct = 6, exactly the cap, nothing lost.
    expect(candidates).toHaveLength(6);
    expect(stats.truncated).toBe(false);
  });

  it("reports truncation rather than silently trimming", () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      candidate({ id: `f${i}`, name: `Food ${i}` }),
    );
    const { candidates, stats } = assembleCandidates(pool, NO_PREFS, 5);
    expect(candidates).toHaveLength(5);
    expect(stats.truncated).toBe(true);
  });

  it("defaults to the design's ~200 cap", () => {
    expect(CANDIDATE_CAP).toBeGreaterThanOrEqual(150);
    expect(CANDIDATE_CAP).toBeLessThanOrEqual(200);
  });

  it("reports containsUnverified over the CAPPED set, not the filtered one", () => {
    // The disclaimer is a statement about what the user is being SHOWN. An
    // untagged row that the cap discarded must not trigger it.
    const tagged = Array.from({ length: 3 }, (_, i) =>
      candidate({ id: `t${i}`, name: `Tagged ${i}`, allergenTags: [] }),
    );
    const untagged = candidate({
      id: "u",
      name: "Mystery Recipe",
      allergenTags: null,
    });

    expect(
      assembleCandidates([...tagged, untagged], NO_PREFS, 3).stats
        .containsUnverified,
    ).toBe(false);
    expect(
      assembleCandidates([untagged, ...tagged], NO_PREFS, 3).stats
        .containsUnverified,
    ).toBe(true);
  });

  it("returns an empty pool honestly when everything is excluded", () => {
    const { candidates, stats } = assembleCandidates(
      [candidate({ allergenTags: null })],
      { ...NO_PREFS, avoidAllergens: ["peanuts"] },
    );
    expect(candidates).toEqual([]);
    // Not silent: the rule that did the excluding is on the record, which is what
    // distinguishes "the tag backfill has not run" from "this user really has
    // excluded everything".
    expect(stats.rejectedByRule.allergen_unknown).toBe(1);
  });

  it("is empty-in, empty-out", () => {
    const { candidates, stats } = assembleCandidates([], NO_PREFS);
    expect(candidates).toEqual([]);
    expect(stats.fetched).toBe(0);
    expect(stats.truncated).toBe(false);
  });
});

describe("describeAssembly", () => {
  it("names the dominant rejection rule", () => {
    const { stats } = assembleCandidates(
      [
        candidate({ id: "a", allergenTags: null }),
        candidate({ id: "b", allergenTags: null }),
      ],
      { ...NO_PREFS, avoidAllergens: ["milk"] },
    );
    const line = describeAssembly(stats);
    expect(line).toContain("fetched=2");
    expect(line).toContain("allergen_unknown=2");
  });

  it("says rejected=0 rather than printing nothing", () => {
    const { stats } = assembleCandidates([candidate()], NO_PREFS);
    expect(describeAssembly(stats)).toContain("rejected=0");
  });

  it("carries no food names or preference values", () => {
    // The line goes to CloudWatch; it is a diagnostic, not a data export.
    const { stats } = assembleCandidates(
      [candidate({ name: "Sensitive Food Name" })],
      { ...NO_PREFS, avoidFoods: ["sensitive"] },
    );
    const line = describeAssembly(stats);
    expect(line).not.toContain("Sensitive");
    expect(line).not.toContain("sensitive");
  });
});
