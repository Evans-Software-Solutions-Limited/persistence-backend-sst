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
    // ⚠ Not arbitrary. Handler suites build their Elysia app through a dynamic
    // `import()` inside the first test, so that test pays module resolution and
    // transform for the whole route tree — ~0.8 s alone, and multiples of that
    // when `turbo run test:unit` has the mobile package saturating the box in
    // parallel. `trainersMeGenerateClientAiSummaryHandler`'s "401 when
    // unauthenticated" tipped over vitest's 5 s default that way: green run
    // alone (286/286), red under turbo, twice.
    //
    // Raised package-wide rather than pinned on that one test, because nothing
    // is special about it — it is simply the suite nearest the edge today, and a
    // per-test band-aid just hands the failure to the next-slowest one. Mirrors
    // the `jest.setTimeout(20_000)` the mobile package's heavy container suites
    // already carry. A real hang now takes 20 s to surface instead of 5; that is
    // the cost, and it is worth less than a red CI run per unlucky schedule.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: [
        "src/application/**/*.ts",
        "src/**/repositories/*.ts",
        "src/shared/**/*.ts",
      ],
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
