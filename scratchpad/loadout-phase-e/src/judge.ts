/**
 * Phase E · T-E2.4 (judged half) — BLIND rubric scoring.
 *
 * The three axes that need a reader — movement-pattern fidelity, whole-plan
 * coherence, reason quality — scored by a model that is not told which arm
 * produced which plan. Presentation order is derived from an FNV-1a hash of the
 * fixture key, so it varies across fixtures (a judge with a first-position bias
 * cannot systematically favour one arm) and is identical on every re-run.
 *
 * The judge is Opus 4.6 while arm B's shipping candidate is Haiku 4.5 —
 * deliberately a different model, to keep self-preference out of the primary
 * comparison. Where an Opus-4.6 arm B is also measured, self-preference IS a
 * live caveat and the verdict says so; the hard metrics in `metrics.ts` are
 * unaffected either way.
 */

import {
  createWithRetry,
  findToolUse,
  getDefaultClient,
  type MessagesCreateParams,
  type MinimalBedrockClient,
} from "../../../microservices/core/src/application/nutrition/services/aiBedrockClient.ts";
import { MODELS } from "./armB.ts";

export const JUDGE_MODEL = MODELS.opus;

const TOOL_NAME = "score_plans";

export type PlanScore = {
  patternFidelity: number;
  coherence: number;
  reasonQuality: number;
  note: string;
};

export type JudgeVerdict = {
  planOne: PlanScore;
  planTwo: PlanScore;
  preference: "one" | "two" | "tie";
  rationale: string;
};

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    patternFidelity: { type: "integer", minimum: 1, maximum: 5 },
    coherence: { type: "integer", minimum: 1, maximum: 5 },
    reasonQuality: { type: "integer", minimum: 1, maximum: 5 },
    note: { type: "string" },
  },
  required: ["patternFidelity", "coherence", "reasonQuality", "note"],
} as const;

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    planOne: SCORE_SCHEMA,
    planTwo: SCORE_SCHEMA,
    preference: { type: "string", enum: ["one", "two", "tie"] },
    rationale: { type: "string" },
  },
  required: ["planOne", "planTwo", "preference", "rationale"],
} as const;

export function buildJudgePrompt(args: {
  workoutName: string;
  equipment: string[];
  originalPlan: string;
  planOne: string;
  planTwo: string;
}): string {
  return [
    "You are a strength-and-conditioning coach reviewing two adaptations of the same",
    "workout to the same limited set of equipment. Both were produced by automated",
    "systems whose identity you do not know. Score them independently and fairly.",
    "",
    `WORKOUT: ${args.workoutName}`,
    `EQUIPMENT AVAILABLE: ${args.equipment.join(", ")}`,
    "",
    "ORIGINAL PLAN:",
    args.originalPlan,
    "",
    "PLAN ONE:",
    args.planOne,
    "",
    "PLAN TWO:",
    args.planTwo,
    "",
    "Score each plan 1–5 on each axis. Both plans have already been machine-verified as",
    "equipment-legal, so do not score legality — assume every exercise is performable.",
    "",
    "patternFidelity — does each swap preserve the MOVEMENT PATTERN and training intent of",
    "  the exercise it replaced? A hinge should stay a hinge; a horizontal press should not",
    "  become a quad isolation just because they share a muscle. 5 = every swap keeps the",
    "  pattern; 1 = swaps are muscle-matched at best and pattern-blind.",
    "",
    "coherence — read the adapted plan as a WHOLE SESSION. Is it something you would give a",
    "  client? Penalise several near-identical exercises, a movement pattern the original",
    "  covered that has vanished, a lost push/pull or upper/lower balance, and unresolved",
    "  rows that a listed alternative could have filled. 5 = a coherent session; 1 = a",
    "  per-row substitution list that does not work as a session.",
    "",
    "reasonQuality — the text after each em dash is shown to the athlete in the app.",
    "  Is it accurate, specific and worth reading? 5 = tells them what was missing and why",
    "  this replacement works; 1 = generic, repetitive, or misdescribes the swap.",
    "",
    "Then state a preference between the two plans, or 'tie' if they are genuinely equivalent.",
    "Keep `note` and `rationale` to one or two sentences each.",
  ].join("\n");
}

function parseScore(value: unknown, label: string): PlanScore {
  if (typeof value !== "object" || value === null) {
    throw new Error(`judge_shape: ${label} is not an object`);
  }
  const record = value as Record<string, unknown>;
  const read = (key: string): number => {
    const raw = record[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`judge_shape: ${label}.${key} is not a finite number`);
    }
    // Bedrock does not enforce the schema's min/max (aiBedrockClient.ts:221-230),
    // so clamp rather than reject a 6.
    return Math.min(5, Math.max(1, Math.round(raw)));
  };
  return {
    patternFidelity: read("patternFidelity"),
    coherence: read("coherence"),
    reasonQuality: read("reasonQuality"),
    note: typeof record.note === "string" ? record.note : "",
  };
}

export async function judgePlans(
  args: {
    workoutName: string;
    equipment: string[];
    originalPlan: string;
    planOne: string;
    planTwo: string;
  },
  options: { client?: MinimalBedrockClient; modelId?: string } = {},
): Promise<JudgeVerdict & { latencyMs: number }> {
  const client = options.client ?? getDefaultClient();
  const params: MessagesCreateParams = {
    model: options.modelId ?? JUDGE_MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: buildJudgePrompt(args) }],
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

  const startedAt = performance.now();
  const response = await createWithRetry(client, params);
  const latencyMs = Math.round(performance.now() - startedAt);

  const input = findToolUse(response, TOOL_NAME);
  if (typeof input !== "object" || input === null) {
    throw new Error("judge_shape: tool input is not an object");
  }
  const record = input as Record<string, unknown>;
  const preference =
    record.preference === "one" || record.preference === "two"
      ? record.preference
      : "tie";

  return {
    planOne: parseScore(record.planOne, "planOne"),
    planTwo: parseScore(record.planTwo, "planTwo"),
    preference,
    rationale: typeof record.rationale === "string" ? record.rationale : "",
    latencyMs,
  };
}
