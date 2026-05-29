import { useFonts } from "expo-font";

import { APP_FONT_MAP, useAppFonts } from "../useAppFonts";

describe("useAppFonts (STORY-002 AC 2.1)", () => {
  it("bundles the Geist + Geist Mono weights the design system uses", () => {
    const keys = Object.keys(APP_FONT_MAP);
    // Geist display 400-900 (incl. italics) + Geist Mono 400-600.
    expect(keys).toContain("Geist_400Regular");
    expect(keys).toContain("Geist_700Bold");
    expect(keys).toContain("Geist_900Black");
    expect(keys).toContain("GeistMono_400Regular");
    expect(keys).toContain("GeistMono_600SemiBold");
  });

  it("delegates loading to expo-font's useFonts with the font map", () => {
    const result = useAppFonts();
    expect(useFonts).toHaveBeenCalledWith(APP_FONT_MAP);
    expect(result).toEqual([true, null]);
  });
});
