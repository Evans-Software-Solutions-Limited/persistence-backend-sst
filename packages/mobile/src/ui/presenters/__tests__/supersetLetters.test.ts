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

  it("falls back to the ordinal beyond H", () => {
    const groups = Array.from({ length: 9 }, (_, i) => i + 1);
    const map = buildSupersetLetterMap(groups);
    expect(map.get(8)).toBe("H");
    expect(map.get(9)).toBe("9");
  });
});
