import { color, colorPalette, radius, size, space, tokens } from "../tokens";

describe("handoff color surface", () => {
  it("exposes the refined brand cyan (#22D3EE) and its family", () => {
    expect(color.$primary).toBe("#22D3EE");
    expect(color.$primaryBright).toBe("#67E8F9");
    expect(color.$primary7).toBe("#0E7490");
    expect(color.$primaryDim).toBe("rgba(34,211,238,0.10)");
    expect(color.$primaryGlow).toBe("rgba(34,211,238,0.22)");
    expect(color.$primaryInk).toBe("#042F39");
  });

  it("exposes the coach-mode trainer accent family", () => {
    expect(color.$accentTrainer).toBe("#A78BFA");
    expect(color.$accentTrainerBright).toBe("#C4B5FD");
    expect(color.$accentTrainer7).toBe("#6D28D9");
    expect(color.$accentTrainerGlow).toBe("rgba(167,139,250,0.22)");
    expect(color.$accentTrainerDim).toBe("rgba(167,139,250,0.10)");
    expect(color.$accentTrainerInk).toBe("#1E1B4B");
  });

  it("exposes the gold + ember + semantic families", () => {
    expect(color.$gold).toBe("#F5C518");
    expect(color.$ember).toBe("#FB923C");
    expect(color.$success).toBe("#34D399");
    expect(color.$warning).toBe("#FBBF24");
    expect(color.$error).toBe("#F87171");
    expect(color.$info).toBe("#60A5FA");
  });

  it("exposes the warm-cool dark background + surface ramp", () => {
    expect(color.$bg).toBe("#0A0B12");
    expect(color.$surface).toBe("#12141D");
    expect(color.$surface2).toBe("#1A1D29");
    expect(color.$surface3).toBe("#232735");
    expect(color.$surface4).toBe("#2D3243");
    expect(color.$surface5).toBe("#3A4055");
  });

  it("exposes the text ramp with AA+ values for rendered text", () => {
    expect(color.$text).toBe("#F4F4F8");
    expect(color.$text2).toBe("#C2C2CE");
    expect(color.$text3).toBe("#8A8A98");
    expect(color.$text4).toBe("#5C5C68");
    expect(color.$text5).toBe("#383841");
  });

  it("all handoff color values are valid hex or rgba", () => {
    const hexOrRgba =
      /^(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8}|rgba?\(.+\)|transparent)$/;
    for (const value of Object.values(color)) {
      expect(value).toMatch(hexOrRgba);
    }
  });
});

describe("handoff dimension surface", () => {
  it("exposes the space ramp", () => {
    expect(space.$xxs).toBe(2);
    expect(space.$xs).toBe(4);
    expect(space.$sm).toBe(8);
    expect(space.$md).toBe(12);
    expect(space.$base).toBe(16);
    expect(space.$4xl).toBe(64);
  });

  it("exposes named size tokens including the 44pt touch-target floor", () => {
    expect(size.$touchTarget).toBe(44);
    expect(size.$tabBarHeight).toBe(72);
    expect(size.$headerHeight).toBe(54);
    expect(size.$bottomPadding).toBe(140);
  });

  it("exposes the radius ramp", () => {
    expect(radius.$sm).toBe(6);
    expect(radius.$md).toBe(10);
    expect(radius.$lg).toBe(14);
    expect(radius.$xl).toBe(20);
    expect(radius.$2xl).toBe(28);
    expect(radius.$pill).toBe(9999);
  });
});

describe("legacy colorPalette (preserved additively, retired in M11)", () => {
  it("still exposes the legacy primary scale", () => {
    expect(colorPalette.primary50).toBe("#E0F7FF");
    expect(colorPalette.primary500).toBe("#00D4FF");
    expect(colorPalette.primary900).toBe("#0088A3");
  });

  it("still exposes the legacy gold + neutral scales", () => {
    expect(colorPalette.gold500).toBe("#FFD700");
    expect(colorPalette.neutral0).toBe("#FFFFFF");
    expect(colorPalette.neutral1000).toBe("#0A0A0F");
  });

  it("still exposes legacy semantic colors", () => {
    expect(colorPalette.success).toBe("#22C55E");
    expect(colorPalette.warning).toBe("#F59E0B");
    expect(colorPalette.error).toBe("#EF4444");
    expect(colorPalette.info).toBe("#00D4FF");
  });
});

describe("createTokens combined surface", () => {
  // `createTokens` strips the leading `$` from runtime keys (verified against
  // @tamagui/core 2.0.0-rc), while the static type retains it. We read through
  // a runtime-safe accessor so the assertions reflect actual resolution.
  const val = (group: Record<string, { val: unknown }>, key: string): unknown =>
    group[key]?.val;
  const space = tokens.space as unknown as Record<string, { val: unknown }>;
  const size = tokens.size as unknown as Record<string, { val: unknown }>;
  const radius = tokens.radius as unknown as Record<string, { val: unknown }>;
  const color = tokens.color as unknown as Record<string, { val: unknown }>;

  it("resolves handoff space references (the $ prefix is stripped)", () => {
    expect(val(space, "base")).toBe(16);
    expect(val(space, "sm")).toBe(8);
    expect(val(space, "2xl")).toBe(32);
  });

  it("resolves the named size tokens", () => {
    expect(val(size, "touchTarget")).toBe(44);
    expect(val(size, "tabBarHeight")).toBe(72);
  });

  it("keeps legacy radius keys ($full) resolvable for un-swept screens", () => {
    expect(val(radius, "full")).toBe(9999);
    expect(val(radius, "pill")).toBe(9999);
  });

  it("keeps legacy size.md (44) resolvable for un-swept screens", () => {
    expect(val(size, "md")).toBe(44);
    expect(val(size, "true")).toBe(44);
  });

  it("resolves the new handoff colour tokens", () => {
    expect(val(color, "primary")).toBe("#22D3EE");
    expect(val(color, "accentTrainer")).toBe("#A78BFA");
    expect(val(color, "bg")).toBe("#0A0B12");
  });
});
