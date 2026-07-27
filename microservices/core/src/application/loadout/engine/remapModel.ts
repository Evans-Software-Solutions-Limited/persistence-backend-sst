/**
 * Stage 2 of the adaptation pipeline (spec-21 § 1, T-1.9) — candidate-constrained
 * model selection.
 *
 * **This is the stage D7 decided by measurement.** The Phase E2 bake-off
 * (`VERDICT-E2.md`) ran three arms over 80 fixtures with identical candidate sets
 * and blind judging: the hybrid — deterministic § 6.2 shortlist, then model
 * selection over the shortlist — tied the full-pool model arm 25-25 at 28.7 % of
 * its cost, and beat the deterministic ranker 50-4. Do not substitute a different
 * engine for it.
 *
 * ## What the model may and may not do
 *
 * It chooses `exerciseId` values FROM a server-built shortlist and writes one
 * sentence per row. That is all. It never sees or returns sets, reps, rest, order
 * or superset grouping (design § 1 rule 2), and an id outside the shortlist is a
 * PARSE FAILURE — `AiUnreadableError` → 422 — never a fallback and never a
 * fabricated row (§ 1 rule 1, and the explicit counter-example of
 * `resolveIngredientFood.ts`'s fabricate-on-miss behaviour). E2 measured **zero
 * non-member ids across 116 model runs and 341 selected ids**, so this guards a
 * rare event; it is still the thing that makes the whole design safe.
 *
 * ## Why this is not shared with the equipment scan
 *
 * design § 1b: Loadout has TWO AI problems and they are not variants of each
 * other. The scan is perception (Opus-class, 10 s, $0.0272, needs one long
 * attempt); this is composition (Haiku-class sufficed and won the judged axes,
 * 2.6 s, $0.0057, `createWithRetry` fits). They share exactly one thing — the
 * candidate-constrained contract — and a shared "Loadout AI service" would need
 * two model ids, two ceilings and two kill switches anyway. Do not build it.
 *
 * The Bedrock primitives come from `nutrition/services/aiBedrockClient` because
 * that module is already the repo's task-agnostic client seam (its own docstring
 * says so, and Recipes AI reuses it the same way). Relocating it to a neutral
 * package is a refactor across the nutrition surface and is not this phase's job.
 */

import {
  createWithRetry,
  findToolUse,
  getDefaultClient,
  AiUnreadableError,
  type MessagesCreateParams,
  type MinimalBedrockClient,
} from "../../nutrition/services/aiBedrockClient";
import type { AdaptationCandidate } from "../../repositories/exerciseRepository";
import type { PlanRow } from "./types";

const TOOL_NAME = "compose_adapted_plan";

/**
 * Hard cap on the model's per-row sentence. Generous for one sentence, and it
 * bounds a channel an attacker-supplied exercise name can steer (see
 * `parseRemapSelections`).
 */
export const MAX_REASON_LENGTH = 300;

/**
 * Trim to `MAX_REASON_LENGTH` on a whole CODE POINT, not a code unit.
 *
 * A bare `slice()` can cut between the halves of a surrogate pair, leaving a lone
 * surrogate. `JSON.stringify` happily escapes that as `\udXXX`, so the preview
 * responds 200 — but the client round-trips the string back into
 * `POST /workouts/:id/variations` as `substitutionReason`, and **Postgres rejects
 * an unpaired surrogate escape in jsonb input**, aborting the whole
 * `createVariation` transaction as an opaque 500 and losing the user's reviewed
 * adaptation. Same failure class the sibling `badSubstitutions` check exists to
 * prevent. Reachable because the prompt carries attacker-influenced strings, so
 * the prose (and therefore where the cut lands) is steerable.
 */
export function capReason(reason: string): string {
  // Strip surrogates that were ALREADY unpaired in the model's own string, not
  // just ones the cut would create. Bedrock can return a `"\udXXX"` escape in the
  // tool payload, and such a string fails the same jsonb insert — so trimming
  // only the split case would leave the docstring's guarantee untrue.
  const paired = reason.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "",
  );
  if (paired.length <= MAX_REASON_LENGTH) return paired;
  const cut = paired.slice(0, MAX_REASON_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return isHighSurrogate ? cut.slice(0, -1) : cut;
}

/**
 * Haiku-class by evidence, not by thrift: arm B/C ran on Haiku 4.5 and it won
 * every judged axis against the deterministic ranker. design § 1b records the
 * opposite finding for the scan, which needs Opus-class — hence two env vars.
 *
 * ⚠ Bedrock model access is PER-ACCOUNT and PER-MODEL. Haiku 4.5 is granted in
 * both the development and production accounts (STATE.md 2026-07-26 — a 30-day
 * production outage was caused by assuming otherwise), but re-verify per account
 * before shipping. **Never a `global.` inference profile** — it routes outside the
 * EU and breaks the DPIA's data-residency commitment.
 */
export const DEFAULT_REMAP_MODEL_ID =
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

export function remapModelId(): string {
  const configured = process.env.AI_LOADOUT_REMAP_MODEL_ID;
  return configured && configured.trim().length > 0
    ? configured
    : DEFAULT_REMAP_MODEL_ID;
}

/**
 * The model's answer for one row. `exerciseId: null` is the model saying "nothing
 * on this list can replace this row" — an AC-3.4 unresolved row, honoured rather
 * than repaired.
 */
export interface RemapSelection {
  /**
   * The plan row this answers for — `PlanRow.rowKey`, i.e. the row's 0-based
   * position in the ordered plan.
   *
   * The TOOL FIELD is still named `sortOrder`, deliberately: the prompt and tool
   * schema are byte-identical to the arm the E2 bake-off measured, and renaming a
   * field the model sees is a prompt change that would invalidate that
   * measurement. Only the value differs, and only for plans whose `sort_order`
   * values are not already 0..n-1 — which are exactly the plans where keying on
   * `sort_order` was unsafe (see `PlanRow.rowKey`).
   */
  rowKey: number;
  exerciseId: string | null;
  reason: string;
}

export interface RemapUsage {
  modelId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RemapResult {
  /** Keyed by `PlanRow.rowKey`. Rows the model omitted are simply absent. */
  selections: Map<number, RemapSelection>;
  usage: RemapUsage;
}

export interface RemapNameLookups {
  muscleNames: ReadonlyMap<string, string>;
  equipmentNames: ReadonlyMap<string, string>;
}

/**
 * Ids are opaque to a model, so every uuid in the prompt is rendered with its
 * name. An id with no name row falls back to the id itself rather than being
 * dropped — a missing reference row must not silently delete a muscle from the
 * model's view of an exercise.
 */
function describeIds(
  ids: readonly string[],
  names: ReadonlyMap<string, string>,
): string {
  if (ids.length === 0) return "none";
  return ids.map((id) => names.get(id) ?? id).join("/");
}

function describeCandidate(
  candidate: AdaptationCandidate,
  lookups: RemapNameLookups,
): string {
  const parts = [
    candidate.id,
    candidate.name,
    `primary: ${describeIds(candidate.primaryMuscles, lookups.muscleNames)}`,
    `secondary: ${describeIds(candidate.secondaryMuscles, lookups.muscleNames)}`,
    `equipment: ${describeIds(candidate.equipmentRequired, lookups.equipmentNames)}`,
    candidate.difficultyLevel ?? "unknown",
  ];
  return parts.join(" | ");
}

/**
 * Prompt shape carried over from the winning arm (`scratchpad/loadout-phase-e/src/armB.ts`)
 * with uuids resolved to names. Changing it invalidates the E2 measurement, so
 * changes should come with a re-run rather than an argument.
 */
export function buildRemapPrompt(input: {
  workoutName: string;
  plan: readonly PlanRow[];
  candidates: readonly AdaptationCandidate[];
  equipmentTypeIds: readonly string[];
  lookups: RemapNameLookups;
}): string {
  const { lookups } = input;

  const planLines = input.plan.map((row) => {
    const state = row.needsSwap ? "NEEDS_SWAP" : "KEEP (fixed — do not change)";
    const superset =
      row.supersetGroup !== null ? ` | superset ${row.supersetGroup}` : "";
    const sets = row.targetSets ?? 1;
    return `${row.rowKey}. [${state}] ${row.source.name} | primary: ${describeIds(
      row.source.primaryMuscles,
      lookups.muscleNames,
    )} | equipment: ${describeIds(
      row.source.equipmentRequired,
      lookups.equipmentNames,
    )} | ${sets}×${row.targetRepsMin}-${row.targetRepsMax}${superset}`;
  });

  const swapOrders = input.plan
    .filter((row) => row.needsSwap)
    .map((row) => row.rowKey);

  return [
    "You are adapting a strength-training workout to the equipment a user has available today.",
    "",
    `WORKOUT: ${input.workoutName}`,
    `AVAILABLE EQUIPMENT: ${describeIds(input.equipmentTypeIds, lookups.equipmentNames)}`,
    "",
    "THE PLAN (in order):",
    ...planLines,
    "",
    "CANDIDATE EXERCISES — you may choose ONLY from this list. Every one is already",
    "verified as performable with the available equipment.",
    ...input.candidates.map(
      (candidate) => `- ${describeCandidate(candidate, lookups)}`,
    ),
    "",
    "TASK",
    `Choose a replacement for each NEEDS_SWAP row (sortOrder: ${swapOrders.join(", ") || "none"}).`,
    "Rules:",
    "1. `exerciseId` MUST be an id copied exactly from the candidate list above. Never invent one.",
    "2. Return one entry per NEEDS_SWAP row and nothing else — do not return KEEP rows.",
    "3. Preserve the training intent of the row you are replacing: same movement pattern",
    "   (a hinge stays a hinge, a horizontal press stays a horizontal press) and the same",
    "   primary muscles wherever the candidate list allows it.",
    "4. Consider the plan as a WHOLE. Do not fill several rows with near-identical",
    "   exercises, and do not drop a movement pattern the original plan covered.",
    "5. Never choose an exercise that already appears in the plan or that you have",
    "   already chosen for another row.",
    "6. If no candidate can reasonably replace a row, set `exerciseId` to null and say why.",
    "7. `reason` is shown to the user: one short sentence saying what was unavailable and",
    "   why this replacement fits. No preamble.",
    "",
    "Sets, reps, rest and superset grouping are fixed by the server — do not return them.",
  ].join("\n");
}

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sortOrder: { type: "integer" },
          exerciseId: {
            type: ["string", "null"],
            description:
              "An id copied exactly from the candidate list, or null if unresolved.",
          },
          reason: { type: "string" },
        },
        required: ["sortOrder", "exerciseId", "reason"],
      },
    },
  },
  required: ["rows"],
} as const;

/**
 * Bedrock does NOT hard-validate `tool_use.input` against the declared
 * `input_schema` (`aiBedrockClient.ts:221-230`), so every field is checked here.
 * A malformed payload is `AiUnreadableError` → 422: unlike a nutrition estimate,
 * there is nothing sensible to clamp a bad exercise selection to.
 */
export function parseRemapSelections(input: unknown): RemapSelection[] {
  if (typeof input !== "object" || input === null || !("rows" in input)) {
    throw new AiUnreadableError("ai_response_shape: missing rows");
  }
  const rows = (input as { rows: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new AiUnreadableError("ai_response_shape: rows is not an array");
  }

  return rows.map((row) => {
    if (typeof row !== "object" || row === null) {
      throw new AiUnreadableError("ai_response_shape: row is not an object");
    }
    const record = row as Record<string, unknown>;
    if (!Number.isInteger(record.sortOrder)) {
      throw new AiUnreadableError(
        "ai_response_shape: sortOrder is not an integer",
      );
    }
    const exerciseId = record.exerciseId;
    if (exerciseId !== null && typeof exerciseId !== "string") {
      throw new AiUnreadableError(
        "ai_response_shape: exerciseId is neither string nor null",
      );
    }
    return {
      rowKey: record.sortOrder as number,
      exerciseId,
      // Capped, and treated as untrusted text.
      //
      // ⚠ The prompt necessarily contains strings this caller does not control:
      // AC-1.2 makes a STRANGER'S PUBLIC workout adaptable, `listAdaptationRows`
      // applies no catalogue visibility predicate, and neither `workouts.name`
      // nor `exercises.name` has a length bound at its create handler. So an
      // attacker can publish a workout whose exercise name instructs the model
      // what to write here, and this field is passed through to the user as the
      // app's own explanation (`SubstitutionReason.note`). Membership validation
      // keeps the PLAN legal regardless — the prose is the only steerable channel
      // — but it must not be unbounded, and Phase 2 must render it as plain text.
      reason: typeof record.reason === "string" ? capReason(record.reason) : "",
    };
  });
}

/**
 * ONE call for the whole plan (§ 1 stage 2), forced tool use, ids validated for
 * membership in TypeScript before anything downstream sees them.
 *
 * `createWithRetry` — 12 s per attempt, one retry — is what design § 1b specifies
 * for this surface and what E2 measured through (p50 2.60 s, max 3.79 s over 58
 * swap-bearing fixtures, i.e. ~3× headroom on a single attempt). ⚠ The retry PATH
 * is unmeasured: 12 s × 2 plus auth/SQL/usage-log overhead sits close to the hard
 * 30 s API Gateway integration ceiling, so a first-attempt timeout converts a
 * slow request into a failed one. The alternative — a single ~20 s attempt, which
 * is what the scan needs (T-E1.6) — trades the retry for more per-attempt budget.
 * **Brad chose the retry, 2026-07-27**, on the measured evidence: the retry path
 * is only reached after an actual first failure, where a ~24 s worst case still
 * beats failing the request outright. The single-long-attempt variant is NOT
 * abandoned — Phase 3's scan requires it (T-E1.6), so it gets built there and this
 * decision can be revisited once that harness exists and is measured.
 */
export async function selectSubstitutes(
  input: {
    workoutName: string;
    plan: readonly PlanRow[];
    candidates: readonly AdaptationCandidate[];
    equipmentTypeIds: readonly string[];
    lookups: RemapNameLookups;
  },
  deps: { client?: MinimalBedrockClient; modelId?: string } = {},
): Promise<RemapResult> {
  const client = deps.client ?? getDefaultClient();
  const modelId = deps.modelId ?? remapModelId();

  const swapRowCount = input.plan.filter((row) => row.needsSwap).length;

  const params: MessagesCreateParams = {
    model: modelId,
    // Scaled to the work asked for, not fixed.
    //
    // Nothing bounds how many exercises a workout may contain, so the number of
    // rows needing a swap is unbounded while a fixed 4096 is not. A bands-only
    // context on a long plan cannot fit one entry plus a sentence per row, and the
    // truncation guard below then converts that into a permanent 422: the workout
    // is un-adaptable, and because the usage row is written for every inference
    // that reached the provider, each retry costs the user one of their daily
    // adaptations.
    //
    // Sized off the WORST case per row and floored at the budget it replaces: a
    // max-length `reason` is 300 chars (~75 tokens) plus a 36-char uuid and JSON
    // scaffolding, so ~120 tokens/row. E2 measured ~40, so this is generous —
    // which costs nothing, because output tokens are billed on use, not on the
    // ceiling. The base matters as much as the slope: a per-row-only formula would
    // have given every realistic plan LESS headroom than the fixed 4096 it
    // replaced, narrowing the tail while making the common case worse.
    max_tokens: Math.min(16_384, 4096 + 120 * swapRowCount),
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: buildRemapPrompt(input) }],
      },
    ],
    tools: [
      {
        name: TOOL_NAME,
        input_schema: TOOL_SCHEMA as unknown as Record<string, unknown>,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  };

  const startedAt = Date.now();
  const response = await createWithRetry(client, params);
  const latencyMs = Date.now() - startedAt;

  // A truncated tool payload PARSES — the surviving rows are well-formed and the
  // dropped ones simply look like rows the model skipped, which stage 3 then
  // "repairs" from the ranker. That is the silent deterministic fallback this
  // design forbids, arriving under a Premium+ badge. `findToolUse` only rejects a
  // refusal, so the truncation case is caught here.
  if (response.stop_reason === "max_tokens") {
    throw new AiUnreadableError(
      "ai_response_truncated: model hit max_tokens before completing the plan",
    );
  }

  const selections = parseRemapSelections(findToolUse(response, TOOL_NAME));

  // MEMBERSHIP VALIDATION (§ 1 rule 1). The candidate list handed to the model is
  // the shortlist, so this is checked against the shortlist and not the wider
  // pool — a laxer check was a disclosed limitation of the eval harness and there
  // is no reason to inherit it in production.
  const offered = new Set(input.candidates.map((candidate) => candidate.id));
  for (const selection of selections) {
    if (selection.exerciseId !== null && !offered.has(selection.exerciseId)) {
      throw new AiUnreadableError(
        `ai_non_member_exercise_id: ${selection.exerciseId} was not offered as a candidate`,
      );
    }
  }

  // `usage` is on the real Bedrock response but not on the minimal response type
  // (which models only what the shipped handlers read). Absent in unit fakes.
  const usage = (
    response as unknown as {
      usage?: { input_tokens?: number; output_tokens?: number };
    }
  ).usage;

  return {
    selections: new Map(
      selections.map((selection) => [selection.rowKey, selection]),
    ),
    usage: {
      modelId,
      latencyMs,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
    },
  };
}
