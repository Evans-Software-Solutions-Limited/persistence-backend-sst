// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "coverage/*", ".expo/*"],
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
