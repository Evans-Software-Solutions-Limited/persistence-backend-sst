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
  createSingleAttempt,
  findToolUse,
  getDefaultClient,
  maxTokensForBudget,
  PREFILL_ALLOWANCE_MS,
  AiUnavailableError,
  AiUnreadableError,
  type MessagesCreateParams,
  type MinimalBedrockClient,
} from "../../nutrition/services/aiBedrockClient";
import type { AdaptationCandidate } from "../../repositories/exerciseRepository";
import { capModelProse } from "../modelProse";
import type { PlanRow } from "./types";

const TOOL_NAME = "compose_adapted_plan";

/**
 * Hard cap on the model's per-row sentence. Generous for one sentence, and it
 * bounds a channel an attacker-supplied exercise name can steer (see
 * `parseRemapSelections`).
 */
export const MAX_REASON_LENGTH = 300;

/**
 * Trim to `MAX_REASON_LENGTH` on a whole CODE POINT, not a code unit, and strip
 * unpaired surrogates.
 *
 * The rule (and the jsonb-insert hazard that motivates it) now lives in
 * `../modelProse`, because Phase 3's scan has the same field with the same
 * exposure and a second copy of a security-relevant sanitiser is how the two
 * drift apart. This wrapper stays so the surface both callers and tests use is
 * unchanged.
 */
export function capReason(reason: string): string {
  return capModelProse(reason, MAX_REASON_LENGTH);
}

/**
 * ONE attempt at 24 s, replacing `createWithRetry`'s two at 12 s.
 *
 * ## ⚠ This reverses the 2026-07-27 decision, on the measurement it asked for
 *
 * `createSingleAttempt`'s docstring records that Brad kept the retry here and
 * that the choice "can be revisited once that harness exists and is measured."
 * It now exists, and the measurement is in: Haiku-class Claude on Bedrock
 * generates at **~122 tok/s**, so a 12 s attempt can receive roughly 1,200
 * output tokens after prefill. This surface was asking for up to 16,384.
 *
 * Every attempt therefore timed out *while working correctly*, and because the
 * SDK's own `maxRetries` was left at 2 (now 0 — see `getDefaultClient`), the
 * Lambda was killed at 29 s before any error surfaced. Observed on staging
 * 2026-07-28: 29,014 ms, `Status: timeout`, zero application output, zero
 * Bedrock invocations recorded.
 *
 * The retry was chosen on the premise that a first-attempt timeout is "a real
 * anomaly" at 2.6 s p50. That premise held for LATENCY and not for the OUTPUT
 * budget, which is what actually binds here. A retry is worth having when
 * failures are transient; when the first attempt fails deterministically
 * because it cannot fit the work, a second identical attempt only spends the
 * budget that would have let the first one finish.
 *
 * 24 s + ~3 s of auth/DB/usage-log overhead sits under the 29 s route timeout,
 * where the old 2 × 12 s (really 6 × 12 s through the SDK) never did.
 */
export const REMAP_TIMEOUT_MS = 24_000;

/**
 * Below this much GENERATION time (on top of {@link PREFILL_ALLOWANCE_MS}) the
 * request is not worth sending: 1 s buys ~100 tokens, which cannot describe even
 * one swapped row, so the only possible outcomes are a truncation 422 or a
 * provider 400. Both cost a daily adaptation and neither helps the user.
 */
export const MIN_USEFUL_GENERATION_MS = 5_000;

/**
 * Output ceiling for one re-map, sized so the TRUNCATION guard fires before the
 * TIMEOUT does.
 *
 * Per row the model emits a uuid, a sort key and a `reason` capped at
 * {@link MAX_REASON_LENGTH} chars (~75 tokens) — ~120 tokens with JSON
 * scaffolding, which is the same per-row figure the previous formula used and
 * is generous against E2's measured ~40.
 *
 * ⚠ What changed is the BASE and the CEILING, not the slope. The old formula was
 * `4096 + 120 × rows`, capped at 16,384. That base was inherited as a floor from
 * a fixed budget rather than derived from anything, and it alone was ~41 s of
 * generation — more than the whole route budget, before a single row was
 * counted. A ceiling is free in money (output tokens bill on use) but not in
 * TIME, and that is the distinction the old comment missed.
 *
 * The ceiling is now derived from the attempt timeout, so the two cannot drift
 * apart again. A plan long enough to exceed it raises `ai_response_truncated`
 * (422, names its cause) rather than burning 29 s and dying silently.
 *
 * ## ⚠ Where the worst-case slope stops being honoured, precisely
 *
 * `maxTokensForBudget(24_000)` is 2,100. The clamp therefore engages at
 * `(2100 − 512) / 120 ≈ 13` swap rows, and past ~17 rows the allocation is below
 * even `120 × rows` with no base at all. **This does not preserve the worst case
 * for long plans, and saying otherwise would be the same overclaim the old
 * comment made.**
 *
 * It is a tail risk rather than a common path: E2 measured ~40 tokens/row, at
 * which 2,100 covers ~52 rows, and 120/row is a deliberately pessimistic figure
 * built from a max-length reason. But a 30-exercise full-body workout adapted to
 * a bands-only context is a real input, and if the model is verbose it will
 * truncate and 422.
 *
 * That is accepted for now because the alternative is worse in every direction:
 * the ceiling cannot be raised without raising the attempt timeout, the attempt
 * timeout cannot be raised without exceeding the route's 29 s, and the route's
 * 29 s is an API Gateway limit. A synchronous request simply cannot generate
 * more than ~2,100 tokens here. The real fixes are to shorten what the model
 * must emit per row (`MAX_REASON_LENGTH` dominates) or to make long adaptations
 * asynchronous — both larger than this change.
 *
 * ⚠ The truncation path is LOGGED at the handler for exactly this reason. If
 * `[loadout-remap] unreadable` starts appearing with high `swapRows`, this is
 * why, and the numbers to act on are in the line.
 */
export function remapMaxTokens(
  swapRowCount: number,
  timeoutMs: number = REMAP_TIMEOUT_MS,
): number {
  return Math.min(maxTokensForBudget(timeoutMs), 512 + 120 * swapRowCount);
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
 * ⚠ **This used `createWithRetry` (12 s × 2) until 2026-07-28 and it never
 * worked in production.** The retry was chosen on latency evidence — E2's p50
 * 2.60 s / max 3.79 s over 58 fixtures — but latency was not the binding
 * constraint. OUTPUT BUDGET was: at ~122 tok/s a 12 s attempt receives ~1,200
 * tokens, and this surface asked for up to 16,384. See {@link REMAP_TIMEOUT_MS}
 * and {@link remapMaxTokens} for the full account and the numbers.
 */
export async function selectSubstitutes(
  input: {
    workoutName: string;
    plan: readonly PlanRow[];
    candidates: readonly AdaptationCandidate[];
    equipmentTypeIds: readonly string[];
    lookups: RemapNameLookups;
  },
  deps: {
    client?: MinimalBedrockClient;
    modelId?: string;
    /**
     * Caps the attempt at what is LEFT of the route budget, rather than assuming
     * the full {@link REMAP_TIMEOUT_MS} is still available.
     *
     * ⚠ Without this the 24 s is asserted, never enforced. The handler makes
     * ~seven sequential round trips before reaching here (auth, workout read,
     * entitlement, gym/equipment read, plan rows, ceiling count, candidate
     * query, then four reference reads); on a cold start with a fresh pooler
     * connection that is comfortably over the 3 s allowance the arithmetic
     * assumes. 4 s of preamble plus a full 24 s attempt plus the usage-log
     * INSERT exceeds 29 s — and a Lambda killed there produces no 503, no usage
     * row and no log line, which is a narrower version of the exact bug this
     * change exists to fix.
     */
    timeoutMs?: number;
  } = {},
): Promise<RemapResult> {
  const client = deps.client ?? getDefaultClient();
  const modelId = deps.modelId ?? remapModelId();
  // ⚠ FAIL FAST rather than send a doomed request. The previous version floored
  // the timeout at `PREFILL_ALLOWANCE_MS` and called that "failing honestly" — it
  // is not. `maxTokensForBudget(PREFILL_ALLOWANCE_MS)` is exactly 0, so the floor
  // sent `max_tokens: 0`, which the provider rejects as a 400. The band just
  // above is worse: 3.0–5.5 s of remaining budget buys 0–250 tokens, the model
  // hits the ceiling, and the caller gets a 422 `ai_unreadable` — a
  // TERMINAL-looking error for a transient cause, so the client will not retry
  // something that would have worked a second later.
  //
  // `MIN_USEFUL_GENERATION_MS` is the floor below which there is no point paying
  // for an inference at all.
  //
  // ⚠ DEFENCE IN DEPTH, not the primary guard. The handler runs the same check
  // before it marks the request as billable, because the quota decision belongs
  // to the layer that owns the usage log — an earlier version delegated it here
  // via a callback, which made "did we bill?" depend on a collaborator
  // remembering to invoke it, and silently stopped writing usage rows in every
  // test that mocked this function. This copy stays so a direct caller cannot
  // send a doomed request.
  const requested = deps.timeoutMs ?? REMAP_TIMEOUT_MS;
  if (requested < PREFILL_ALLOWANCE_MS + MIN_USEFUL_GENERATION_MS) {
    throw new AiUnavailableError(
      `ai_budget_exhausted: ${Math.max(0, requested)}ms left is not enough to adapt this workout`,
    );
  }
  const timeoutMs = Math.min(REMAP_TIMEOUT_MS, requested);

  const swapRowCount = input.plan.filter((row) => row.needsSwap).length;

  const params: MessagesCreateParams = {
    model: modelId,
    // Scaled to the work asked for AND to what the attempt can receive — see
    // `remapMaxTokens`, which derives the ceiling from `REMAP_TIMEOUT_MS`.
    // Follows the ACTUAL attempt budget, not the nominal one — a shortened
    // deadline must shorten the ceiling with it, or the pairing this whole
    // change is about comes apart again on exactly the slow requests that need
    // it most.
    max_tokens: remapMaxTokens(swapRowCount, timeoutMs),
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
  const response = await createSingleAttempt(client, params, timeoutMs);
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
