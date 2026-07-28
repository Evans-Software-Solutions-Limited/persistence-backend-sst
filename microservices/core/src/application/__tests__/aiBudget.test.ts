import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLIENT_TIMEOUT_MS,
  maxTokensForBudget,
  ROUTE_TIMEOUT_MS,
} from "../nutrition/services/aiBedrockClient";
import { REMAP_TIMEOUT_MS, remapMaxTokens } from "../loadout/engine/remapModel";
import {
  EQUIPMENT_SCAN_MAX_TOKENS,
  EQUIPMENT_SCAN_TIMEOUT_MS,
} from "../loadout/scan/equipmentScanModel";
import { RECIPE_MAX_TOKENS } from "../nutrition/services/recipeExtraction";
import { MAX_TOKENS as ESTIMATE_MAX_TOKENS } from "../nutrition/services/aiEstimation";
import { COACH_SUMMARY_MAX_TOKENS } from "../trainers/services/clientSummaryAi";

/**
 * The cross-cutting budget invariants for every model-backed route.
 *
 * ## Why this file exists, in one sentence
 *
 * Three numbers have to agree — the route's Lambda timeout, the per-attempt
 * client timeout, and `max_tokens` — and until 2026-07-28 nothing checked that
 * they did, so Loadout's re-map shipped asking for ~134 s of generation inside a
 * 12 s attempt inside a 29 s Lambda and failed 100 % of the time.
 *
 * Each of those numbers lived in a different file with a comment asserting the
 * relationship in prose. Comments do not fail CI.
 */

describe("AI budgets — the route timeout", () => {
  it("matches what SST actually deploys", () => {
    // ⚠ The one-directional guard Inspector Brad flagged: asserting
    // `REMAP_TIMEOUT_MS + overhead < 29_000` only catches someone RAISING the
    // client timeout. Drop `infra/api.ts` to 20 s — which is SST's own default,
    // and which this route was silently running on until 2026-07-27 — and every
    // budget below becomes wrong while the suite stays green.
    //
    // Reading the infra file is deliberately crude. It is the only way a core
    // unit test can see a value SST owns, and a crude check that fails is worth
    // more than an elegant one that cannot.
    const infra = readFileSync(
      join(__dirname, "../../../../../infra/api.ts"),
      "utf8",
    );
    // ⚠ Anchored to the coreAPI block and CAPTURING the number, not a bare
    // `toContain`. The first version searched the whole file for
    // `timeout: "29 seconds"`, which also contains three `"120 seconds"` and two
    // `"300 seconds"` entries — so raising the mirror to 120_000 PASSED, and
    // every budget assertion below it went vacuous at the same moment. A guard
    // that only fails in one direction is half a guard.
    // ⚠ Assert the anchor before using it. `indexOf` returns -1 on a miss and
    // `slice(0, -1)` is then the whole file minus a character — the guard would
    // silently start checking whichever timeout appears first.
    expect(infra).toContain("Bedrock IAM auth");
    const coreApi = infra.slice(0, infra.indexOf("Bedrock IAM auth"));
    const match = /timeout: "(\d+) seconds"/.exec(coreApi);
    expect(match).not.toBeNull();
    expect(Number(match?.[1]) * 1000).toBe(ROUTE_TIMEOUT_MS);
  });
});

describe("AI budgets — every attempt fits its route", () => {
  it.each([
    { surface: "loadout re-map", attemptMs: REMAP_TIMEOUT_MS },
    { surface: "equipment scan", attemptMs: EQUIPMENT_SCAN_TIMEOUT_MS },
    {
      surface: "retrying callers (2 attempts)",
      attemptMs: CLIENT_TIMEOUT_MS * 2,
    },
  ])(
    "$surface leaves room for auth, queries and the usage-log write",
    ({ attemptMs }) => {
      // Everything outside the model call: Supabase auth, the workout read, the
      // entitlement check, the ceiling count, the candidate query, four
      // reference reads, and the usage-log INSERT in the `finally`.
      const OVERHEAD_ALLOWANCE_MS = 3_000;
      expect(attemptMs + OVERHEAD_ALLOWANCE_MS).toBeLessThan(ROUTE_TIMEOUT_MS);
    },
  );
});

describe("AI budgets — max_tokens is a wall-clock commitment", () => {
  it("keeps the re-map's ceiling inside what its attempt can receive", () => {
    // Generation is serial at a bounded rate, so asking for N tokens commits the
    // caller to at least N / rate seconds. This is the invariant that was missing.
    expect(remapMaxTokens(Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(
      maxTokensForBudget(REMAP_TIMEOUT_MS),
    );
  });

  it("documents the surfaces still over budget rather than pretending otherwise", () => {
    // ⚠ NOT a pass — an inventory. Each entry binds to the REAL exported
    // constant, so fixing any one of them fails this test and forces the list to
    // be updated.
    //
    // The first version hardcoded `{ maxTokens: 4096, attemptMs: 20_000 }` as
    // literals while its comment claimed exactly this property. Changing the
    // scan's real ceiling to 1500 left it green. That is the TODO nobody
    // revisits, wearing a comment that says it isn't — worse than no test, since
    // the next reader trusts it.
    //
    // Rates: Haiku ~122 tok/s, Opus ~45 tok/s, both measured 2026-07-28.
    // `maxTokensForBudget` defaults to the (conservative) Haiku figure, so for
    // the Opus surfaces the real receivable count is well below what it returns.
    const KNOWN_OVER_BUDGET = [
      {
        surface: "equipment scan (Opus)",
        maxTokens: EQUIPMENT_SCAN_MAX_TOKENS,
        attemptMs: EQUIPMENT_SCAN_TIMEOUT_MS,
      },
      {
        surface: "recipe extraction (Opus)",
        maxTokens: RECIPE_MAX_TOKENS,
        attemptMs: CLIENT_TIMEOUT_MS,
      },
      {
        // ⚠ Was missing from the first version of this list, which claimed to
        // document "the surfaces still over budget". An inventory that asserts
        // completeness and isn't is how the next one gets missed.
        surface: "nutrition estimate (Opus)",
        maxTokens: ESTIMATE_MAX_TOKENS,
        attemptMs: CLIENT_TIMEOUT_MS,
      },
    ];
    for (const entry of KNOWN_OVER_BUDGET) {
      expect(entry.maxTokens).toBeGreaterThan(
        maxTokensForBudget(entry.attemptMs),
      );
    }
  });

  it("keeps a surface that DOES fit actually fitting", () => {
    // The counterweight to the inventory above: without a positive case, the
    // list could grow to cover everything and still look like discipline.
    //
    // (Named "a surface", not "the ONLY surface" — `FOOD_MACROS_MAX_TOKENS` at
    // 400 also fits, it is simply not exported. In a file whose whole point is
    // that comments overstate what tests check, that distinction matters.)
    expect(COACH_SUMMARY_MAX_TOKENS).toBeLessThanOrEqual(
      maxTokensForBudget(CLIENT_TIMEOUT_MS),
    );
  });
});
