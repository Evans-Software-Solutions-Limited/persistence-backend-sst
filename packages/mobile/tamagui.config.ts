import { createAnimations } from "@tamagui/animations-react-native";
import { createTamagui } from "@tamagui/core";

import { themes } from "./src/ui/theme/themes";
import { tokens } from "./src/ui/theme/tokens";
import { bodyFont, headingFont } from "./src/ui/theme/typography";

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
    body: bodyFont,
    heading: headingFont,
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
