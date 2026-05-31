import {
  bodyFont,
  displayFont,
  GEIST_FAMILY,
  GEIST_MONO_FAMILY,
  MONO_FONT_VARIANT,
  monoFont,
} from "../fonts";

describe("font families (STORY-002 AC 2.2)", () => {
  it("display + body use the Geist family", () => {
    expect(displayFont.family).toBe(GEIST_FAMILY);
    expect(bodyFont.family).toBe(GEIST_FAMILY);
    expect(GEIST_FAMILY).toBe("Geist");
  });

  it("mono uses the Geist Mono family", () => {
    expect(monoFont.family).toBe(GEIST_MONO_FAMILY);
    expect(GEIST_MONO_FAMILY).toBe("Geist Mono");
  });

  it("display exposes weights 400-900", () => {
    expect(displayFont.weight?.[4]).toBe("400");
    expect(displayFont.weight?.[7]).toBe("700");
    expect(displayFont.weight?.[9]).toBe("900");
  });

  it("body exposes weights 400-600 only", () => {
    expect(bodyFont.weight?.[4]).toBe("400");
    expect(bodyFont.weight?.[6]).toBe("600");
    expect((bodyFont.weight as Record<number, string>)?.[9]).toBeUndefined();
  });

  it("mono exposes weights 400-600", () => {
    expect(monoFont.weight?.[4]).toBe("400");
    expect(monoFont.weight?.[6]).toBe("600");
  });

  it("display maps each weight to the matching Geist face", () => {
    expect(displayFont.face?.["700"]?.normal).toBe("Geist_700Bold");
    expect(displayFont.face?.["900"]?.normal).toBe("Geist_900Black");
  });

  it("mono maps each weight to the matching Geist Mono face", () => {
    expect(monoFont.face?.["400"]?.normal).toBe("GeistMono_400Regular");
    expect(monoFont.face?.["600"]?.normal).toBe("GeistMono_600SemiBold");
  });
});

describe("mono numeric variant (STORY-002 AC 2.3 + 2.5)", () => {
  it("applies tabular figures so numbers do not bounce on update", () => {
    expect(MONO_FONT_VARIANT).toContain("tabular-nums");
  });

  it("does not include slashed-zero in fontVariant (delivered by the face)", () => {
    // RN's `fontVariant` has no slashed-zero token; Geist Mono ships a slashed
    // zero as its default glyph, so rendering in $mono is sufficient for AC 2.5.
    expect(MONO_FONT_VARIANT).not.toContain("slashed-zero");
  });

  it("exposes the large stat sizes used by <Stat> (xl=40 path)", () => {
    expect(monoFont.size?.[7]).toBe(40);
    expect(monoFont.size?.[6]).toBe(28);
    expect(monoFont.size?.[4]).toBe(16);
  });
});
