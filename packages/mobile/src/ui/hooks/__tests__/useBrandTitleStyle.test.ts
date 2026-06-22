import { brandTitleStyle } from "../useBrandTitleStyle";

describe("brandTitleStyle", () => {
  it("renders at the design size on the reference width", () => {
    const style = brandTitleStyle(393);
    expect(style.fontSize).toBe(34);
    expect(style.letterSpacing).toBe(6);
  });

  it("never exceeds the design size on wider screens", () => {
    const style = brandTitleStyle(768);
    expect(style.fontSize).toBe(34);
    expect(style.letterSpacing).toBe(6);
  });

  it("scales down proportionally on narrower screens so the wordmark fits", () => {
    const narrow = brandTitleStyle(320);
    expect(narrow.fontSize).toBeLessThan(34);
    expect(narrow.letterSpacing).toBeLessThan(6);
    // Scale is keyed to available width, never the raw width.
    expect(narrow.fontSize).toBeGreaterThan(20);
  });

  it("clamps to a legible floor on very small widths", () => {
    const tiny = brandTitleStyle(200);
    // MIN_SCALE 0.6 → 34 * 0.6 = 20.4 → rounds to 20.
    expect(tiny.fontSize).toBe(20);
    expect(tiny.letterSpacing).toBeCloseTo(3.6, 5);
  });

  it("falls back to the design size when width is unknown (0)", () => {
    const style = brandTitleStyle(0);
    expect(style.fontSize).toBe(34);
    expect(style.letterSpacing).toBe(6);
  });
});
