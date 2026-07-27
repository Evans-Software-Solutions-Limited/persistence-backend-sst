import { describe, it, expect } from "vitest";
import { capModelProse, stripUnpairedSurrogates } from "../modelProse";

// The high/low halves of 😀 (U+1F600). Split apart, each is an unpaired
// surrogate — the shape Postgres rejects in jsonb input.
const HIGH = "\uD83D";
const LOW = "\uDE00";
const EMOJI = HIGH + LOW;

describe("stripUnpairedSurrogates", () => {
  it("leaves ordinary text untouched", () => {
    expect(stripUnpairedSurrogates("No chest-press machine")).toBe(
      "No chest-press machine",
    );
  });

  it("keeps well-formed surrogate pairs", () => {
    expect(stripUnpairedSurrogates(`nice ${EMOJI} lift`)).toBe(
      `nice ${EMOJI} lift`,
    );
  });

  it("removes a lone HIGH surrogate", () => {
    expect(stripUnpairedSurrogates(`a${HIGH}b`)).toBe("ab");
  });

  it("removes a lone LOW surrogate", () => {
    // Direction matters: the lookbehind half of the pattern is the only thing
    // that catches this one, so a regex missing it would pass the HIGH case
    // above and still ship the bug.
    expect(stripUnpairedSurrogates(`a${LOW}b`)).toBe("ab");
  });

  it("removes a trailing lone HIGH surrogate at the very end of the string", () => {
    expect(stripUnpairedSurrogates(`ab${HIGH}`)).toBe("ab");
  });

  it("removes a leading lone LOW surrogate at the very start", () => {
    expect(stripUnpairedSurrogates(`${LOW}ab`)).toBe("ab");
  });

  it("removes both halves when they are present but out of order", () => {
    // LOW then HIGH is not a pair, and treating it as one would leave two
    // unpaired units in the output.
    expect(stripUnpairedSurrogates(`${LOW}${HIGH}`)).toBe("");
  });
});

describe("capModelProse", () => {
  it("returns a short string unchanged", () => {
    expect(capModelProse("short", 300)).toBe("short");
  });

  it("returns a string of exactly maxLength unchanged", () => {
    const exact = "x".repeat(50);
    expect(capModelProse(exact, 50)).toBe(exact);
    expect(capModelProse(exact, 50)).toHaveLength(50);
  });

  it("truncates a longer string to maxLength", () => {
    expect(capModelProse("x".repeat(400), 300)).toHaveLength(300);
  });

  it("does not leave a lone HIGH surrogate when the cut lands mid-pair", () => {
    // 49 plain chars then the emoji: a cut at 50 falls between the emoji's two
    // halves, so a naive slice() would emit the HIGH surrogate alone.
    const text = "x".repeat(49) + EMOJI + "tail";
    const capped = capModelProse(text, 50);

    expect(capped).toHaveLength(49);
    expect(capped).toBe("x".repeat(49));
    // The property that actually matters, stated directly: the output must
    // round-trip through JSON without producing a lone surrogate escape.
    expect(JSON.stringify(capped)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
  });

  it("keeps a pair intact when the cut lands after it", () => {
    const text = "x".repeat(48) + EMOJI + "tail";
    const capped = capModelProse(text, 50);

    expect(capped).toBe("x".repeat(48) + EMOJI);
    expect(capped).toHaveLength(50);
  });

  it("strips surrogates that were already unpaired BEFORE any truncation", () => {
    // The model's own string can arrive malformed; a cap that only handled the
    // split case would pass this through and fail the jsonb insert downstream.
    const capped = capModelProse(`clean${HIGH}text`, 300);

    expect(capped).toBe("cleantext");
    expect(JSON.stringify(capped)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
  });

  it("applies the length cap AFTER stripping, so stripped units do not count", () => {
    // 10 real chars plus 5 unpaired surrogates, capped at 12: if the cap ran
    // first the result would lose real characters to units that get deleted
    // anyway.
    const capped = capModelProse("abcdefghij" + HIGH.repeat(5), 12);
    expect(capped).toBe("abcdefghij");
  });

  it("honours different maxLength values", () => {
    // The scan's label cap (60) and the re-map's reason cap (300) are different
    // numbers through the same function, so the parameter has to be live.
    expect(capModelProse("y".repeat(100), 60)).toHaveLength(60);
    expect(capModelProse("y".repeat(100), 10)).toHaveLength(10);
  });
});
