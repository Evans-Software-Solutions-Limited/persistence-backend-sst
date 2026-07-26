/**
 * Phase E · T-E2.3 — ARM B: candidate-constrained model composition.
 *
 * Whole plan in ONE call, forced tool use, selecting `exerciseId` values from
 * the server-built candidate list only (design § 1, D6). The model cannot invent
 * an exercise: every returned id is re-resolved against the candidate set in
 * `pipeline.verify()`, and a non-member is a parse failure (422 in production).
 *
 * Reuses the shipped M9.5 harness rather than a new client
 * (`microservices/core/src/application/nutrition/services/aiBedrockClient.ts`) —
 * `getDefaultClient` / `createWithRetry` / `findToolUse` verbatim, including the
 * 12s × 2 retry policy. That policy is sized for the 30s API Gateway ceiling and
 * is irrelevant offline, but leaving it alone keeps the measured latency
 * comparable to what production would see. Importing through that module is also
 * what resolves `@anthropic-ai/bedrock-sdk`, which is a dependency of
 * `microservices/core`, not of the repo root.
 *
 * ⚠ `ess-dev` only. Bedrock model grants are per-account (STATE.md 2026-07-26) —
 * never point this at `ess-prod`, and never use a `global.` inference profile
 * (routes outside the EU, breaks the DPIA's data-residency commitment).
 */

import {
  createWithRetry,
  findToolUse,
  getDefaultClient,
  type MessagesCreateParams,
  type MinimalBedrockClient,
} from "../../../microservices/core/src/application/nutrition/services/aiBedrockClient.ts";
import type { Exercise } from "./library.ts";
import type {
  AdaptedPlan,
  AdaptedRow,
  CandidatePool,
  PlanRow,
} from "./pipeline.ts";
import type { FixtureContext } from "./fixtures.ts";

/** eu.* cross-region inference profiles. Verified callable in `ess-dev`, eu-west-2. */
export const MODELS = {
  haiku: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  opus: "eu.anthropic.claude-opus-4-6-v1",
} as const;

/**
 * USD per million tokens. Anthropic first-party list rates for the two models
 * (Haiku 4.5 $1/$5, Opus 4.6 $5/$25); Bedrock is partner-priced and can differ,
 * so the verdict's cost line is an ORDER-OF-MAGNITUDE figure to be confirmed
 * against the AWS bill before it becomes a pricing commitment.
 */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  [MODELS.haiku]: { input: 1, output: 5 },
  [MODELS.opus]: { input: 5, output: 25 },
};

const TOOL_NAME = "compose_adapted_plan";

type ComposedRow = {
  sortOrder: number;
  exerciseId: string | null;
  reason: string;
};

function describeCandidate(exercise: Exercise): string {
  const equipment =
    exercise.equipmentRequired.length > 0
      ? exercise.equipmentRequired.join("+")
      : "none";
  const secondary =
    exercise.secondaryMuscles.length > 0
      ? exercise.secondaryMuscles.join("/")
      : "-";
  return `${exercise.id} | ${exercise.name} | primary: ${exercise.primaryMuscles.join("/")} | secondary: ${secondary} | equipment: ${equipment} | ${exercise.difficulty}`;
}

export function buildPrompt(
  plan: PlanRow[],
  pool: CandidatePool,
  context: FixtureContext,
  workoutName: string,
): string {
  const planLines = plan.map((row) => {
    const equipment =
      row.source.equipmentRequired.length > 0
        ? row.source.equipmentRequired.join("+")
        : "none";
    const state = row.needsSwap ? "NEEDS_SWAP" : "KEEP (fixed — do not change)";
    const superset = row.supersetGroup
      ? ` | superset ${row.supersetGroup}`
      : "";
    return `${row.sortOrder}. [${state}] ${row.source.name} | primary: ${row.source.primaryMuscles.join("/")} | equipment: ${equipment} | ${row.sets}×${row.repsMin}-${row.repsMax}${superset}`;
  });

  const swapOrders = plan
    .filter((row) => row.needsSwap)
    .map((row) => row.sortOrder);

  return [
    "You are adapting a strength-training workout to the equipment a user has available today.",
    "",
    `WORKOUT: ${workoutName}`,
    `AVAILABLE EQUIPMENT: ${context.equipment.join(", ")}`,
    "",
    "THE PLAN (in order):",
    ...planLines,
    "",
    "CANDIDATE EXERCISES — you may choose ONLY from this list. Every one is already",
    "verified as performable with the available equipment.",
    ...pool.candidates.map((candidate) => `- ${describeCandidate(candidate)}`),
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

function parseComposedRows(input: unknown): ComposedRow[] {
  if (typeof input !== "object" || input === null || !("rows" in input)) {
    throw new Error("ai_response_shape: missing rows");
  }
  const rows = (input as { rows: unknown }).rows;
  if (!Array.isArray(rows))
    throw new Error("ai_response_shape: rows is not an array");

  return rows.map((row) => {
    if (typeof row !== "object" || row === null) {
      throw new Error("ai_response_shape: row is not an object");
    }
    const record = row as Record<string, unknown>;
    if (!Number.isInteger(record.sortOrder)) {
      throw new Error("ai_response_shape: sortOrder is not an integer");
    }
    const exerciseId = record.exerciseId;
    if (exerciseId !== null && typeof exerciseId !== "string") {
      throw new Error(
        "ai_response_shape: exerciseId is neither string nor null",
      );
    }
    return {
      sortOrder: record.sortOrder as number,
      exerciseId,
      reason: typeof record.reason === "string" ? record.reason : "",
    };
  });
}

/**
 * `getDefaultClient()` builds `AnthropicBedrock` with no explicit region or
 * profile, so the harness silently inherits whatever the shell exports. A stray
 * `ess-prod` in the environment would fire 160 Bedrock calls at the production
 * account. Convention in a comment is not a control — assert before the first
 * call (IB sweep 1, and the 2026-07-26 per-account-grant lesson).
 */
export function assertDevEnvironment(modelId: string): void {
  const profile = process.env.AWS_PROFILE;
  if (profile !== "ess-dev") {
    throw new Error(
      `refusing to run: AWS_PROFILE must be "ess-dev", got ${profile ?? "(unset)"}`,
    );
  }
  if (!modelId.startsWith("eu.")) {
    throw new Error(
      `refusing to run: model id must be an eu.* inference profile (EU data residency), got ${modelId}`,
    );
  }
}

export async function adaptWithModel(
  plan: PlanRow[],
  pool: CandidatePool,
  context: FixtureContext,
  workoutName: string,
  options: { modelId: string; client?: MinimalBedrockClient },
): Promise<AdaptedPlan> {
  if (!options.client) assertDevEnvironment(options.modelId);
  const client = options.client ?? getDefaultClient();
  const prompt = buildPrompt(plan, pool, context, workoutName);

  const params: MessagesCreateParams = {
    model: options.modelId,
    max_tokens: 4096,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    tools: [
      {
        name: TOOL_NAME,
        input_schema: TOOL_SCHEMA as unknown as Record<string, unknown>,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
  };

  const startedAt = performance.now();
  const response = await createWithRetry(client, params);
  const latencyMs = Math.round(performance.now() - startedAt);

  // `usage` is on the real Bedrock response but not on the harness's minimal
  // response type (it only models what the shipped handlers read).
  const usage = (
    response as unknown as {
      usage?: { input_tokens?: number; output_tokens?: number };
    }
  ).usage;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  // Throw rather than default to zero: an unpriced model id silently costing $0
  // would make a model arm look as free as the deterministic one (IB sweep 1).
  const price = PRICE_PER_MTOK[options.modelId];
  if (!price) throw new Error(`unpriced model id: ${options.modelId}`);
  const costUsd =
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output;

  const composed = parseComposedRows(findToolUse(response, TOOL_NAME));
  const bySortOrder = new Map(composed.map((row) => [row.sortOrder, row]));

  const rows: AdaptedRow[] = plan.map((row) => {
    const targets = {
      sortOrder: row.sortOrder,
      fromExerciseId: row.source.id,
      sets: row.sets,
      repsMin: row.repsMin,
      repsMax: row.repsMax,
      rest: row.rest,
      supersetGroup: row.supersetGroup,
    };

    // Stage 3: KEPT rows are a database property, never a model output.
    if (!row.needsSwap) {
      const kit = row.source.equipmentRequired.filter(
        (e) => e !== "Bodyweight",
      );
      return {
        ...targets,
        status: "kept" as const,
        exerciseId: row.source.id,
        reason:
          kit.length > 0
            ? `Kept · your kit has ${kit.join(" + ").toLowerCase()}`
            : "Kept · needs no equipment",
      };
    }

    const choice = bySortOrder.get(row.sortOrder);
    if (!choice || choice.exerciseId === null) {
      return {
        ...targets,
        status: "unresolved" as const,
        exerciseId: null,
        reason:
          choice?.reason ||
          `No compatible alternative for ${row.source.name} with this kit`,
      };
    }

    return {
      ...targets,
      status: "swapped" as const,
      exerciseId: choice.exerciseId,
      reason: choice.reason,
    };
  });

  const returnedForKeptRows = composed.filter((row) =>
    plan.some(
      (planRow) => planRow.sortOrder === row.sortOrder && !planRow.needsSwap,
    ),
  ).length;

  return {
    rows,
    meta: {
      modelId: options.modelId,
      latencyMs,
      inputTokens,
      outputTokens,
      costUsd,
      candidateCount: pool.candidates.length,
      /** Rule-2 violations: the model answered for a row it was told was fixed. */
      returnedForKeptRows,
      /** Rule-5 violations are measured in metrics.ts (duplicate picks). */
    },
  };
}
