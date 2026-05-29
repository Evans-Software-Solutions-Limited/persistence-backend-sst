import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@persistence/db": path.resolve(__dirname, "../packages/db/src"),
      "drizzle-orm": path.resolve(
        __dirname,
        "../packages/db/node_modules/drizzle-orm",
      ),
    },
  },
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: ["reconcile-stripe.ts", "codemod-tokens.ts"],
      exclude: ["node_modules", "**/*.test.ts", "**/vitest.config.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
