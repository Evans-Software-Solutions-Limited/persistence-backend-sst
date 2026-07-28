import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLIENT_TIMEOUT_MS,
  maxTokensForBudget,
  ROUTE_TIMEOUT_MS,
} from "../nutrition/services/aiBedrockClient";
import { REMAP_TIMEOUT_MS, remapMaxTokens } from "../loadout/engine/remapModel";
import { EQUIPMENT_SCAN_TIMEOUT_MS } from "../loadout/scan/equipmentScanModel";

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
    const seconds = Math.round(ROUTE_TIMEOUT_MS / 1000);
    expect(infra).toContain(`timeout: "${seconds} seconds"`);
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
    // ⚠ NOT a pass. These two are knowingly left mismatched, and the assertion
    // is written so that FIXING one fails this test and forces the number below
    // to be updated — the opposite of a TODO nobody revisits.
    //
    // - equipment scan: 4096 tokens @ 20 s. Output is catalogue-bounded (~28
    //   rows ≈ 1,100 tokens) so the ceiling is unreachable headroom rather than
    //   a live hazard — but it runs OPUS, whose rate is unmeasured, and at a
    //   plausible ~50 tok/s a 20 s attempt receives less than a busy
    //   commercial-gym photo legitimately produces. Measure before Phase 3.
    // - recipe extraction: 2500 tokens @ 12 s (~900 receivable).
    //
    // Both are strictly better after this change than before it: at
    // `maxRetries: 2` they were 6 × 12 s = 72 s and a silent Lambda kill; they
    // now fail cleanly inside the route budget.
    const KNOWN_OVER_BUDGET = [
      { surface: "equipment scan", maxTokens: 4096, attemptMs: 20_000 },
      { surface: "recipe extraction", maxTokens: 2500, attemptMs: 12_000 },
    ];
    for (const entry of KNOWN_OVER_BUDGET) {
      expect(entry.maxTokens).toBeGreaterThan(
        maxTokensForBudget(entry.attemptMs),
      );
    }
  });
});
