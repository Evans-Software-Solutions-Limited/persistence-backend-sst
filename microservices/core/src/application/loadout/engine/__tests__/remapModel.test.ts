/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildRemapPrompt,
  capReason,
  DEFAULT_REMAP_MODEL_ID,
  MAX_REASON_LENGTH,
  parseRemapSelections,
  MIN_USEFUL_GENERATION_MS,
  remapMaxTokens,
  remapModelId,
  REMAP_TIMEOUT_MS,
  selectSubstitutes,
} from "../remapModel";
import {
  AiUnreadableError,
  maxTokensForBudget,
  PREFILL_ALLOWANCE_MS,
} from "../../../nutrition/services/aiBedrockClient";
import type { AdaptationCandidate } from "../../../repositories/exerciseRepository";
import type { PlanRow } from "../types";

const CHEST = "m-chest";
const BARBELL = "eq-barbell";
const DUMBBELL = "eq-dumbbell";

function ex(
  overrides: Partial<AdaptationCandidate> & { id: string; name: string },
): AdaptationCandidate {
  return {
    category: "strength",
    difficultyLevel: "intermediate",
    movementType: null,
    primaryMuscles: [CHEST],
    secondaryMuscles: [],
    equipmentRequired: [],
    thumbnailUrl: null,
    ...overrides,
  };
}

function planRow(
  sortOrder: number,
  source: AdaptationCandidate,
  needsSwap: boolean,
): PlanRow {
  return {
    rowKey: sortOrder,
    sortOrder,
    source,
    needsSwap,
    missingEquipment: needsSwap ? [BARBELL] : [],
    supersetGroup: null,
    targetSets: 4,
    targetRepsMin: 4,
    targetRepsMax: 6,
    targetDurationSeconds: null,
    restSeconds: 120,
    notes: null,
  };
}

const lookups = {
  muscleNames: new Map([[CHEST, "Chest"]]),
  equipmentNames: new Map([
    [BARBELL, "Barbell"],
    [DUMBBELL, "Dumbbells"],
  ]),
};

const swapSource = ex({
  id: "src",
  name: "Barbell Bench Press",
  equipmentRequired: [BARBELL],
});
const keptSource = ex({ id: "kept", name: "Push-Up" });
const candidate = ex({
  id: "cand-1",
  name: "Dumbbell Bench Press",
  equipmentRequired: [DUMBBELL],
});

const PLAN = [planRow(0, keptSource, false), planRow(1, swapSource, true)];

function fakeClient(
  response: unknown,
  capture: { params?: any; options?: any } = {},
) {
  return {
    messages: {
      create: vi.fn(async (params: any, options?: any) => {
        capture.params = params;
        capture.options = options;
        return response as any;
      }),
    },
  };
}

function toolResponse(rows: unknown) {
  return {
    stop_reason: "tool_use",
    content: [
      { type: "tool_use", name: "compose_adapted_plan", input: { rows } },
    ],
    usage: { input_tokens: 4543, output_tokens: 120 },
  };
}

describe("remapModelId", () => {
  const original = process.env.AI_LOADOUT_REMAP_MODEL_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.AI_LOADOUT_REMAP_MODEL_ID;
    else process.env.AI_LOADOUT_REMAP_MODEL_ID = original;
  });

  it("defaults to the Haiku-class EU inference profile", () => {
    delete process.env.AI_LOADOUT_REMAP_MODEL_ID;
    expect(remapModelId()).toBe(DEFAULT_REMAP_MODEL_ID);
  });

  it("never routes outside the EU by default", () => {
    // A `global.` inference profile breaks the DPIA's data-residency commitment
    // (STATE.md). The default must be an `eu.` profile.
    expect(DEFAULT_REMAP_MODEL_ID.startsWith("eu.")).toBe(true);
  });

  it("honours the env override, ignoring blank values", () => {
    process.env.AI_LOADOUT_REMAP_MODEL_ID = "eu.anthropic.something-else";
    expect(remapModelId()).toBe("eu.anthropic.something-else");

    process.env.AI_LOADOUT_REMAP_MODEL_ID = "   ";
    expect(remapModelId()).toBe(DEFAULT_REMAP_MODEL_ID);
  });
});

describe("buildRemapPrompt", () => {
  const prompt = buildRemapPrompt({
    workoutName: "Upper Body",
    plan: PLAN,
    candidates: [candidate],
    equipmentTypeIds: [DUMBBELL],
    lookups,
  });

  it("marks kept rows as fixed and names only the swap rows as the task", () => {
    expect(prompt).toContain("[KEEP (fixed — do not change)] Push-Up");
    expect(prompt).toContain("[NEEDS_SWAP] Barbell Bench Press");
    expect(prompt).toContain("sortOrder: 1)");
  });

  it("resolves every uuid to a human name — a model cannot reason about ids", () => {
    expect(prompt).toContain("Chest");
    expect(prompt).toContain("Barbell");
    expect(prompt).toContain("AVAILABLE EQUIPMENT: Dumbbells");
    expect(prompt).not.toContain(CHEST);
  });

  it("falls back to the id when a reference row is missing, never dropping it", () => {
    const withUnknown = buildRemapPrompt({
      workoutName: "Upper Body",
      plan: PLAN,
      candidates: [candidate],
      equipmentTypeIds: ["eq-unmapped"],
      lookups,
    });

    expect(withUnknown).toContain("eq-unmapped");
  });

  it("lists the candidate ids the model must copy from", () => {
    expect(prompt).toContain("cand-1");
    expect(prompt).toContain("Dumbbell Bench Press");
  });

  it("states the two rules that keep the contract safe", () => {
    // §1 rule 1 (ids come from the list) and rule 2 (targets are the server's).
    expect(prompt).toContain("copied exactly from the candidate list");
    expect(prompt).toContain(
      "Sets, reps, rest and superset grouping are fixed by the server",
    );
  });
});

describe("parseRemapSelections", () => {
  it("accepts a well-formed payload", () => {
    expect(
      parseRemapSelections({
        rows: [{ sortOrder: 1, exerciseId: "cand-1", reason: "fits" }],
      }),
    ).toEqual([{ rowKey: 1, exerciseId: "cand-1", reason: "fits" }]);
  });

  it("accepts an explicit null selection", () => {
    expect(
      parseRemapSelections({
        rows: [{ sortOrder: 1, exerciseId: null, reason: "nothing fits" }],
      })[0].exerciseId,
    ).toBeNull();
  });

  it.each([
    ["a non-object", 42],
    ["a payload with no rows", {}],
    ["rows that are not an array", { rows: "nope" }],
    ["a row that is not an object", { rows: [null] }],
    [
      "a non-integer sortOrder",
      { rows: [{ sortOrder: 1.5, exerciseId: null, reason: "" }] },
    ],
    [
      "an exerciseId that is neither string nor null",
      { rows: [{ sortOrder: 1, exerciseId: 7, reason: "" }] },
    ],
  ])("rejects %s as unreadable", (_label, payload) => {
    // Bedrock does not hard-validate tool input against the declared schema, so
    // every field is checked here. There is nothing sensible to clamp a bad
    // exercise selection to, unlike a nutrition estimate.
    expect(() => parseRemapSelections(payload)).toThrow(AiUnreadableError);
  });

  it("tolerates a missing reason rather than failing the whole plan", () => {
    expect(
      parseRemapSelections({ rows: [{ sortOrder: 1, exerciseId: "x" }] })[0]
        .reason,
    ).toBe("");
  });
});

describe("selectSubstitutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forces the tool, sends one call for the whole plan, and returns usage", async () => {
    const capture: { params?: any } = {};
    const client = fakeClient(
      toolResponse([{ sortOrder: 1, exerciseId: "cand-1", reason: "fits" }]),
      capture,
    );

    const result = await selectSubstitutes(
      {
        workoutName: "Upper Body",
        plan: PLAN,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client, modelId: "eu.anthropic.test" },
    );

    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(capture.params.tool_choice).toEqual({
      type: "tool",
      name: "compose_adapted_plan",
    });
    expect(capture.params.model).toBe("eu.anthropic.test");
    expect(result.selections.get(1)).toEqual({
      rowKey: 1,
      exerciseId: "cand-1",
      reason: "fits",
    });
    expect(result.usage).toMatchObject({
      modelId: "eu.anthropic.test",
      inputTokens: 4543,
      outputTokens: 120,
    });
  });

  it("REJECTS an id that was not offered — a parse failure, never a fallback", async () => {
    // §1 rule 1. E2 measured zero non-member ids across 116 runs and 341 ids, so
    // this guards a rare event; it is still what makes the design safe.
    const client = fakeClient(
      toolResponse([
        { sortOrder: 1, exerciseId: "hallucinated", reason: "invented" },
      ]),
    );

    await expect(
      selectSubstitutes(
        {
          workoutName: "Upper Body",
          plan: PLAN,
          candidates: [candidate],
          equipmentTypeIds: [DUMBBELL],
          lookups,
        },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("validates membership against the SHORTLIST it offered, not a wider pool", async () => {
    // A disclosed laxity of the eval harness (it verified arm C against the full
    // pool). Production must not inherit it.
    const notOffered = ex({ id: "cand-2", name: "Cable Fly" });
    const client = fakeClient(
      toolResponse([{ sortOrder: 1, exerciseId: "cand-2", reason: "x" }]),
    );

    await expect(
      selectSubstitutes(
        {
          workoutName: "Upper Body",
          plan: PLAN,
          candidates: [candidate],
          equipmentTypeIds: [DUMBBELL],
          lookups,
        },
        { client },
      ),
    ).rejects.toThrow(/cand-2/);

    // …and it is accepted once actually offered.
    const permissive = fakeClient(
      toolResponse([{ sortOrder: 1, exerciseId: "cand-2", reason: "x" }]),
    );
    const ok = await selectSubstitutes(
      {
        workoutName: "Upper Body",
        plan: PLAN,
        candidates: [candidate, notOffered],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client: permissive },
    );
    expect(ok.selections.get(1)?.exerciseId).toBe("cand-2");
  });

  it("allows a null selection through membership validation", async () => {
    const client = fakeClient(
      toolResponse([{ sortOrder: 1, exerciseId: null, reason: "nothing" }]),
    );

    const result = await selectSubstitutes(
      {
        workoutName: "Upper Body",
        plan: PLAN,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client },
    );

    expect(result.selections.get(1)?.exerciseId).toBeNull();
  });

  it("surfaces a refusal as unreadable", async () => {
    const client = fakeClient({ stop_reason: "refusal", content: [] });

    await expect(
      selectSubstitutes(
        {
          workoutName: "Upper Body",
          plan: PLAN,
          candidates: [candidate],
          equipmentTypeIds: [DUMBBELL],
          lookups,
        },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("reports zero tokens rather than crashing when usage is absent", async () => {
    const client = fakeClient({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          name: "compose_adapted_plan",
          input: { rows: [] },
        },
      ],
    });

    const result = await selectSubstitutes(
      {
        workoutName: "Upper Body",
        plan: PLAN,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client },
    );

    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });
});

describe("selectSubstitutes — truncation and untrusted prose", () => {
  it("rejects a TRUNCATED response instead of letting it parse", async () => {
    // A `max_tokens` stop leaves well-formed surviving rows, so the payload parses
    // and the dropped rows look like rows the model chose to skip — which stage 3
    // then "repairs" from the ranker. That is the silent deterministic fallback the
    // design forbids, under a Premium+ badge. `findToolUse` only rejects a refusal.
    const client = fakeClient({
      stop_reason: "max_tokens",
      content: [
        {
          type: "tool_use",
          name: "compose_adapted_plan",
          input: {
            rows: [{ sortOrder: 1, exerciseId: "cand-1", reason: "x" }],
          },
        },
      ],
    });

    await expect(
      selectSubstitutes(
        {
          workoutName: "Upper Body",
          plan: PLAN,
          candidates: [candidate],
          equipmentTypeIds: [DUMBBELL],
          lookups,
        },
        { client },
      ),
    ).rejects.toThrow(/truncated/);
  });

  it("caps the model's sentence — it is a channel an injected name can steer", async () => {
    // AC-1.2 makes a stranger's PUBLIC workout adaptable and neither workout nor
    // exercise names have a length bound, so the prompt contains text this caller
    // does not control and `reason` is passed through to the user.
    const client = fakeClient(
      toolResponse([
        { sortOrder: 1, exerciseId: "cand-1", reason: "x".repeat(5000) },
      ]),
    );

    const result = await selectSubstitutes(
      {
        workoutName: "Upper Body",
        plan: PLAN,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client },
    );

    expect(result.selections.get(1)?.reason).toHaveLength(MAX_REASON_LENGTH);
  });

  it("identifies rows by rowKey, so duplicate sort_order values cannot collide", async () => {
    // Two plan rows sharing `sort_order` (legal — no unique constraint) get
    // distinct row keys, and the prompt numbers them distinctly.
    const collidingPlan = [
      { ...planRow(0, swapSource, true), rowKey: 0, sortOrder: 0 },
      { ...planRow(0, keptSource, true), rowKey: 1, sortOrder: 0 },
    ];

    const prompt = buildRemapPrompt({
      workoutName: "Upper Body",
      plan: collidingPlan,
      candidates: [candidate],
      equipmentTypeIds: [DUMBBELL],
      lookups,
    });

    expect(prompt).toContain("sortOrder: 0, 1");
    expect(prompt).toContain("0. [NEEDS_SWAP]");
    expect(prompt).toContain("1. [NEEDS_SWAP]");
  });
});

describe("capReason", () => {
  it("leaves a short reason untouched", () => {
    expect(capReason("short")).toBe("short");
  });

  it("caps at MAX_REASON_LENGTH", () => {
    expect(capReason("x".repeat(1000))).toHaveLength(MAX_REASON_LENGTH);
  });

  it("strips a lone surrogate the model itself sent, not just one the cut creates", () => {
    // Bedrock can return a `"\udXXX"` escape in the tool payload. Such a string
    // fails the same jsonb insert, so capping only the split case would leave this
    // function's stated guarantee untrue.
    const withOrphan = "hi \uD83D there";
    const capped = capReason(withOrphan);

    expect(capped).toBe("hi  there");
    expect(capped).toBe(JSON.parse(JSON.stringify(capped)));
  });

  it("strips a lone LOW surrogate too", () => {
    expect(capReason("a\uDC00b")).toBe("ab");
  });

  it("keeps well-formed astral characters intact", () => {
    expect(capReason("lift 😀 heavy")).toBe("lift 😀 heavy");
  });

  it("never leaves a LONE SURROGATE at the cut", () => {
    // A bare `slice()` splits a surrogate pair here. `JSON.stringify` escapes the
    // orphan happily, so the preview 200s — and then Postgres rejects the unpaired
    // escape when the client saves the plan into the `substitution_reason` jsonb
    // column, aborting `createVariation` as an opaque 500 and losing the user's
    // reviewed adaptation.
    const reason = "x".repeat(MAX_REASON_LENGTH - 1) + "😀" + "y".repeat(20);
    const capped = capReason(reason);

    expect(capped).toHaveLength(MAX_REASON_LENGTH - 1);
    // A lone surrogate survives a JSON round trip as an escape but is not a valid
    // scalar; the check is that the string is fully paired.
    expect(capped).toBe(JSON.parse(JSON.stringify(capped)));
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(capped)).toBe(false);
  });

  it("keeps a complete pair that ends exactly on the boundary", () => {
    const reason = "x".repeat(MAX_REASON_LENGTH - 2) + "😀" + "y".repeat(20);
    expect(capReason(reason)).toHaveLength(MAX_REASON_LENGTH);
    expect(capReason(reason).endsWith("😀")).toBe(true);
  });
});

describe("selectSubstitutes — output budget", () => {
  // ⚠ These replace tests that PINNED THE BUG. The originals asserted
  // `max_tokens >= 4096` and `<= 16_384` and passed happily, because they only
  // ever checked the ceiling against itself. Nothing tied `max_tokens` to the
  // attempt timeout, so nothing could notice that the ceiling described ~134 s
  // of generation inside a 12 s attempt inside a 29 s Lambda.
  //
  // The invariant worth testing is the RELATIONSHIP, not either number alone.

  it("never asks for more output than the attempt can physically receive", async () => {
    // The whole defect in one assertion. Generation is serial at a bounded rate,
    // so `max_tokens` is a wall-clock commitment: ask for more than the timeout
    // can receive and a perfectly healthy request still times out.
    const hugePlan = Array.from({ length: 500 }, (_, i) => ({
      ...planRow(i, swapSource, true),
      rowKey: i,
    }));
    const capture: { params?: any; options?: any } = {};
    await selectSubstitutes(
      {
        workoutName: "W",
        plan: hugePlan,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client: fakeClient(toolResponse([]), capture) },
    );

    expect(capture.params.max_tokens).toBeLessThanOrEqual(
      maxTokensForBudget(REMAP_TIMEOUT_MS),
    );
  });

  it("sends ONE attempt at the raised timeout, not two short ones", async () => {
    // `createWithRetry` at 12 s could not fit this surface's output, so a second
    // identical attempt only spent the budget that would have let the first one
    // finish.
    const capture: { params?: any; options?: any } = {};
    const client = fakeClient(toolResponse([]), capture);
    await selectSubstitutes(
      {
        workoutName: "W",
        plan: PLAN,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client },
    );

    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(capture.options?.timeout).toBe(REMAP_TIMEOUT_MS);
  });

  it("keeps the whole attempt inside the 29 s route timeout", () => {
    // The arithmetic that was wrong before: 2 × 12 s through an SDK defaulting
    // to 2 internal retries is ~72 s worst case. Leave room for auth, the
    // candidate query and the usage-log write.
    const OVERHEAD_ALLOWANCE_MS = 3_000;
    const ROUTE_TIMEOUT_MS = 29_000;
    expect(REMAP_TIMEOUT_MS + OVERHEAD_ALLOWANCE_MS).toBeLessThan(
      ROUTE_TIMEOUT_MS,
    );
  });

  it("still scales with the number of rows the model must answer for", async () => {
    // The slope was never the problem — the base and the ceiling were.
    const small: { params?: any } = {};
    await selectSubstitutes(
      {
        workoutName: "W",
        plan: PLAN,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client: fakeClient(toolResponse([]), small) },
    );

    const bigPlan = Array.from({ length: 8 }, (_, i) => ({
      ...planRow(i, swapSource, true),
      rowKey: i,
    }));
    const big: { params?: any } = {};
    await selectSubstitutes(
      {
        workoutName: "W",
        plan: bigPlan,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client: fakeClient(toolResponse([]), big) },
    );

    expect(big.params.max_tokens).toBeGreaterThan(small.params.max_tokens);
  });
});

describe("remapMaxTokens", () => {
  it("leaves real plans well inside the budget, so truncation stays rare", () => {
    // ~120 tokens/row is the worst case (a 300-char reason plus a uuid and JSON
    // scaffolding); E2 measured ~40. A 10-exercise workout must not be anywhere
    // near the ceiling, or the 422 stops being an edge case.
    expect(remapMaxTokens(10)).toBeLessThan(
      maxTokensForBudget(REMAP_TIMEOUT_MS),
    );
    expect(remapMaxTokens(10)).toBeGreaterThanOrEqual(512 + 120 * 10);
  });

  it("caps rather than growing without bound", () => {
    expect(remapMaxTokens(500)).toBe(maxTokensForBudget(REMAP_TIMEOUT_MS));
  });

  it("gives a swap-free plan a floor, not zero", () => {
    // `selectSubstitutes` is not called with zero swap rows today, but a formula
    // returning ~0 for one would turn a future caller into an instant 422.
    expect(remapMaxTokens(0)).toBeGreaterThan(0);
  });
});

describe("selectSubstitutes — the remaining-budget deadline", () => {
  // ⚠ This whole mechanism shipped with ZERO coverage in the first version of
  // this change. Inspector Brad made `deps.timeoutMs` a no-op — reverting
  // `createSingleAttempt(client, params, timeoutMs)` to pass the constant — and
  // all 40 tests stayed green. The one test that read `options.timeout` never
  // passed a `timeoutMs`, so it only ever exercised the default.

  it("honours a SHORTENED deadline in both the timeout and the ceiling", async () => {
    // Both halves matter. A shortened deadline that leaves `max_tokens` at the
    // full-budget figure re-creates the exact mismatch this change exists to fix,
    // on precisely the slow requests that can least afford it.
    const capture: { params?: any; options?: any } = {};
    await selectSubstitutes(
      {
        workoutName: "W",
        plan: PLAN,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client: fakeClient(toolResponse([]), capture), timeoutMs: 9_000 },
    );

    expect(capture.options?.timeout).toBe(9_000);
    expect(capture.params.max_tokens).toBe(remapMaxTokens(1, 9_000));
    expect(capture.params.max_tokens).toBeLessThan(remapMaxTokens(1));
  });

  it("never lets a caller ask for MORE than the surface's own budget", async () => {
    const capture: { params?: any; options?: any } = {};
    await selectSubstitutes(
      {
        workoutName: "W",
        plan: PLAN,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client: fakeClient(toolResponse([]), capture), timeoutMs: 120_000 },
    );

    expect(capture.options?.timeout).toBe(REMAP_TIMEOUT_MS);
  });

  it("FAILS FAST rather than sending a request that cannot succeed", async () => {
    // The bug in the first version: the deadline was floored at
    // `PREFILL_ALLOWANCE_MS`, and `maxTokensForBudget(PREFILL_ALLOWANCE_MS)` is
    // exactly 0 — so it sent `max_tokens: 0`, which the provider rejects as a
    // 400. The band just above sent 0–250 tokens and got back a truncation 422,
    // a terminal-looking error for a transient cause.
    const client = fakeClient(toolResponse([]));
    await expect(
      selectSubstitutes(
        {
          workoutName: "W",
          plan: PLAN,
          candidates: [candidate],
          equipmentTypeIds: [DUMBBELL],
          lookups,
        },
        // Exactly the old floor, which is also exactly where
        // `maxTokensForBudget` returns 0.
        { client, timeoutMs: PREFILL_ALLOWANCE_MS },
      ),
    ).rejects.toThrow(/ai_budget_exhausted/);

    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it("sends anything at or above the useful-generation floor", async () => {
    // The other side of the boundary — without this the guard could reject
    // everything and still look correct.
    const capture: { params?: any; options?: any } = {};
    const client = fakeClient(toolResponse([]), capture);
    await selectSubstitutes(
      {
        workoutName: "W",
        plan: PLAN,
        candidates: [candidate],
        equipmentTypeIds: [DUMBBELL],
        lookups,
      },
      { client, timeoutMs: PREFILL_ALLOWANCE_MS + MIN_USEFUL_GENERATION_MS },
    );

    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(capture.params.max_tokens).toBeGreaterThan(0);
  });

  it("fails fast on a NEGATIVE budget too", async () => {
    // Reachable whenever the preamble overruns: the handler subtracts elapsed
    // time from the route budget and does not clamp.
    const client = fakeClient(toolResponse([]));
    await expect(
      selectSubstitutes(
        {
          workoutName: "W",
          plan: PLAN,
          candidates: [candidate],
          equipmentTypeIds: [DUMBBELL],
          lookups,
        },
        { client, timeoutMs: -4_000 },
      ),
    ).rejects.toThrow(/ai_budget_exhausted/);
    expect(client.messages.create).not.toHaveBeenCalled();
  });
});
