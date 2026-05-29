import { createAnimations } from "@tamagui/animations-react-native";
import { createTamagui } from "@tamagui/core";

import { bodyFont, displayFont, monoFont } from "./src/ui/theme/fonts";
import { themes } from "./src/ui/theme/themes";
import { tokens } from "./src/ui/theme/tokens";

const animations = createAnimations({
  fast: {
    type: "spring",
    damping: 20,
    mass: 1.2,
    stiffness: 250,
  },
  medium: {
    type: "spring",
    damping: 15,
    mass: 1,
    stiffness: 150,
  },
  slow: {
    type: "spring",
    damping: 20,
    mass: 1,
    stiffness: 100,
  },
});

const config = createTamagui({
  tokens,
  themes,
  fonts: {
    // New design-system families (01-design-system STORY-002).
    display: displayFont,
    body: bodyFont,
    mono: monoFont,
    // Legacy alias: existing screens reference `$heading`. Point it at the
    // Geist display font so they pick up the refreshed typeface unchanged.
    // Retired alongside the adoption sweep / M11 Polish.
    heading: displayFont,
  },
  animations,
  defaultFont: "body",
  shouldAddPrefersColorThemes: true,
  themeClassNameOnRoot: true,
});

export type AppConfig = typeof config;

declare module "@tamagui/core" {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
