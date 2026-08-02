import { resizeToLongEdge } from "../image";

/**
 * The bug these pin is the one `SnapAISheetContainer` shipped with since M9.5:
 * a width-only resize under a comment promising a long-edge cap.
 */
describe("resizeToLongEdge", () => {
  it("caps a LANDSCAPE image on width", () => {
    expect(resizeToLongEdge(4032, 3024, 1080)).toEqual([
      { resize: { width: 1080 } },
    ]);
  });

  it("caps a PORTRAIT image on HEIGHT — the case width-only resizing got wrong", () => {
    // The old behaviour produced 1080 × 1440: a third over budget on the axis
    // that costs the most tokens, on every portrait phone photo.
    expect(resizeToLongEdge(3024, 4032, 1080)).toEqual([
      { resize: { height: 1080 } },
    ]);
  });

  it("caps a square image on width (the >= tie-break, not an accident)", () => {
    expect(resizeToLongEdge(2000, 2000, 1080)).toEqual([
      { resize: { width: 1080 } },
    ]);
  });

  it("does NOT upscale an image already inside the cap", () => {
    // The other half of the old bug: an 800px screenshot was blown up to 1080,
    // spending bytes and latency for no extra detail.
    expect(resizeToLongEdge(800, 600, 1080)).toEqual([]);
  });

  it("does not resize an image sitting exactly on the cap", () => {
    expect(resizeToLongEdge(1080, 1080, 1080)).toEqual([]);
  });

  it("resizes when only ONE axis exceeds the cap", () => {
    expect(resizeToLongEdge(600, 2000, 1080)).toEqual([
      { resize: { height: 1080 } },
    ]);
    expect(resizeToLongEdge(2000, 600, 1080)).toEqual([
      { resize: { width: 1080 } },
    ]);
  });

  it.each([
    ["zero width", 0, 1200],
    ["zero height", 1200, 0],
    ["negative", -1, 1200],
    ["NaN", Number.NaN, 1200],
    ["Infinity", Number.POSITIVE_INFINITY, 1200],
  ])(
    "falls back to a width cap on unusable dimensions (%s)",
    (_label, width, height) => {
      // Some library assets report 0 before decode. With nothing to reason about,
      // the old width-cap behaviour is a safer default than returning `[]` and
      // posting a full-resolution photo at $0.0272 an inference.
      expect(resizeToLongEdge(width, height, 1080)).toEqual([
        { resize: { width: 1080 } },
      ]);
    },
  );
});
