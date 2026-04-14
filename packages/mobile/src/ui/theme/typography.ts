import { createFont } from "@tamagui/core";

export const bodyFont = createFont({
  family: "System",
  size: {
    1: 12, // caption
    2: 14, // bodySmall / label
    3: 16, // body
    4: 18, // h4
    5: 20, // h3
    6: 24, // h2
    7: 32, // h1
    true: 16,
  },
  lineHeight: {
    1: 16, // caption
    2: 20, // bodySmall / label
    3: 24, // body
    4: 24, // h4
    5: 28, // h3
    6: 32, // h2
    7: 40, // h1
    true: 24,
  },
  weight: {
    1: "400", // regular
    2: "500", // medium
    3: "600", // semibold
    4: "700", // bold
    true: "400",
  },
  letterSpacing: {
    1: 0,
    2: 0,
    3: 0,
    4: -0.2,
    5: -0.3,
    6: -0.4,
    7: -0.5,
    true: 0,
  },
});

export const headingFont = createFont({
  family: "System",
  size: {
    4: 18,
    5: 20,
    6: 24,
    7: 32,
    true: 24,
  },
  lineHeight: {
    4: 24,
    5: 28,
    6: 32,
    7: 40,
    true: 32,
  },
  weight: {
    4: "600",
    5: "600",
    6: "700",
    7: "700",
    true: "700",
  },
  letterSpacing: {
    4: -0.2,
    5: -0.3,
    6: -0.4,
    7: -0.5,
    true: -0.4,
  },
});
