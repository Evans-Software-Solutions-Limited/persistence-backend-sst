// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const designSystem = require("./eslint-rules/no-raw-hex-colors");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "coverage/*", ".expo/*"],
  },
  // no-raw-hex-colors (01-design-system STORY-006 AC 6.4): block raw hex in
  // token-resolvable positions across the UI layer. theme/** holds the token
  // source (exempt); __tests__/** assert on concrete values (exempt).
  //
  // The new design-system primitives (foundation/**, composite/**) are the
  // RN/SVG bridge: they legitimately hold concrete colour constants for
  // contexts a Tamagui token can't reach (SVG stroke, LinearGradient stops, RN
  // shadowColor). They're authored + reviewed against the prototype by this
  // spec, so they're exempt. The remaining legacy-screen files that still
  // carry concrete RN-StyleSheet / gradient hex are allow-listed until their
  // owning spec ports them (design.md 2026-05-29 codemod-scope revision).
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    ignores: [
      "src/ui/theme/**",
      "src/ui/**/__tests__/**",
      "src/ui/components/foundation/**",
      "src/ui/components/composite/**",
      // Legacy-screen allow-list (owning spec finishes the port):
      "src/ui/components/home/WorkoutCard.tsx",
      "src/ui/components/subscription/SubscriptionBadge.tsx",
    ],
    plugins: { "design-system": designSystem },
    rules: {
      "design-system/no-raw-hex-colors": "error",
    },
  },
  // Enforce domain layer purity: no framework imports in domain/
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-native",
                "expo-*",
                "@react-navigation/*",
                "@expo/*",
                "@/adapters/*",
                "@/ui/*",
              ],
              message:
                "Domain layer must be framework-agnostic. Only imports from @/shared are allowed.",
            },
          ],
        },
      ],
    },
  },
]);
