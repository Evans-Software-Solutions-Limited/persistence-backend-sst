import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@persistence/db": path.resolve(__dirname, "../../packages/db/src"),
      "@persistence/api-utils": path.resolve(
        __dirname,
        "../../packages/api-utils/src",
      ),
      "drizzle-orm": path.resolve(
        __dirname,
        "../../packages/db/node_modules/drizzle-orm",
      ),
    },
  },
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/application/**/*.ts", "src/**/repositories/*.ts"],
      exclude: [
        "node_modules",
        "**/*.test.ts",
        "**/vitest.config.ts",
        "**/sst-env.d.ts",
        "src/api.ts",
        "src/index.ts",
      ],
      // Target 90% coverage
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
