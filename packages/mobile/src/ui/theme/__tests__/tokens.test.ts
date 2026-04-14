import { colorPalette, tokens } from "../tokens";

describe("colorPalette", () => {
  it("has complete primary scale", () => {
    expect(colorPalette.primary50).toBe("#E0F7FF");
    expect(colorPalette.primary500).toBe("#00D4FF");
    expect(colorPalette.primary900).toBe("#0088A3");
  });

  it("has complete gold accent scale", () => {
    expect(colorPalette.gold500).toBe("#FFD700");
  });

  it("has neutral scale from white to near-black", () => {
    expect(colorPalette.neutral0).toBe("#FFFFFF");
    expect(colorPalette.neutral1000).toBe("#0A0A0F");
  });

  it("has semantic colors", () => {
    expect(colorPalette.success).toBe("#22C55E");
    expect(colorPalette.warning).toBe("#F59E0B");
    expect(colorPalette.error).toBe("#EF4444");
    expect(colorPalette.info).toBe("#00D4FF");
  });

  it("all color values are valid hex or rgba", () => {
    const hexOrRgba =
      /^(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8}|rgba?\(.+\)|transparent)$/;
    for (const [, value] of Object.entries(colorPalette)) {
      expect(value).toMatch(hexOrRgba);
    }
  });
});

describe("tokens", () => {
  it("has space tokens with positive values", () => {
    const space = tokens.space;
    expect(space.xs.val).toBe(4);
    expect(space.sm.val).toBe(8);
    expect(space.base.val).toBe(16);
    expect(space["2xl"].val).toBe(32);
  });

  it("has radius tokens", () => {
    expect(tokens.radius.sm.val).toBe(4);
    expect(tokens.radius.md.val).toBe(8);
    expect(tokens.radius.full.val).toBe(9999);
  });

  it("has size tokens with 44pt minimum for default", () => {
    expect(tokens.size.md.val).toBe(44);
    expect(tokens.size.true.val).toBe(44);
  });
});
