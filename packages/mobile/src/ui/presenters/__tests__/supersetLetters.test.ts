import { buildSupersetLetterMap } from "@/ui/presenters/supersetLetters";

describe("buildSupersetLetterMap", () => {
  it("assigns A/B/C in first-appearance order, ignoring nulls", () => {
    const map = buildSupersetLetterMap([null, 5, 5, null, 2, 2]);
    expect(map.get(5)).toBe("A");
    expect(map.get(2)).toBe("B");
    expect(map.size).toBe(2);
  });

  it("returns an empty map when there are no groups", () => {
    expect(buildSupersetLetterMap([null, null]).size).toBe(0);
    expect(buildSupersetLetterMap([]).size).toBe(0);
  });

  it("skips lone-member groups (they render as singles) so letters stay in sync", () => {
    // g1 appears once (renders as a standalone), g2 twice (a real superset).
    // g2 must be "A" (not "B") to match the detail screen.
    const map = buildSupersetLetterMap([1, 2, 2]);
    expect(map.has(1)).toBe(false);
    expect(map.get(2)).toBe("A");
    expect(map.size).toBe(1);
  });

  it("falls back to the ordinal beyond H", () => {
    // Each group appears twice so it qualifies as a real (multi-member) superset.
    const groups = Array.from({ length: 9 }, (_, i) => i + 1).flatMap((g) => [
      g,
      g,
    ]);
    const map = buildSupersetLetterMap(groups);
    expect(map.get(8)).toBe("H");
    expect(map.get(9)).toBe("9");
  });
});
