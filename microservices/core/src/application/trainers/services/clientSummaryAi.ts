import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import {
  AREA_STATUSES,
  parseWeeklySummary,
  type SummaryArea,
  type WeeklySummary,
  type WeeklySummaryEvidence,
} from "./weeklySummary";

/**
 * Claude-on-Bedrock adapter for the coach AI Client Summary (Coach Mode
 * Phase 6, specs/10-trainer-features/design.md § Module g). This mirrors the
 * M9.5 nutrition seam (`nutrition/services/aiEstimation.ts`) exactly — same
 * IAM-SigV4 auth (no API-key secret; see `infra/api.ts`'s `bedrock:InvokeModel`
 * grant), same FORCED-TOOL-USE structured output (`tool_choice:{type:'tool'}`),
 * same injectable `deps.client` seam so unit tests pass a fake and CI never
 * makes a live AWS call — but is deliberately self-contained rather than
 * importing the nutrition module, keeping `trainers/` independent of
 * `nutrition/`.
 *
 * PER-115: the output is the summary by area, `{headline, areas[], ask}`
 * (design B D4), parsed strictly by `parseWeeklySummary`.
 *
 * PRIVACY: the caller passes ONLY `WeeklySummaryEvidence` — adherence counts,
 * the programme week, latest form answers (photo questions removed) and plan
 * meals logged. Never photos, never the coach's private notes, never the
 * food-level entry log. The prompt is grounded strictly in that evidence.
 */

const SUMMARY_MODEL_ID =
  process.env.AI_COACH_SUMMARY_MODEL_ID ??
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

// Per-attempt Bedrock timeout. This handler serves the coreAPI ApiGatewayV2
// (HTTP API) route, whose integration ceiling is a hard 30s. Two attempts must
// fit under it with headroom: 2 × 12s + overhead < 30s (mirrors aiEstimation).
const CLIENT_TIMEOUT_MS = 12_000;
const MAX_TOKENS = 700;
/**
 * Re-exported under an unambiguous name so `aiBudget.test.ts` can assert this
 * surface FITS its attempt — the positive case that stops the over-budget
 * inventory from quietly growing to cover everything.
 */
export const COACH_SUMMARY_MAX_TOKENS = MAX_TOKENS;
const TOOL_NAME = "report_summary";

/**
 * Provider unreachable / timed out after the one retry, a refusal, or a
 * response missing the forced tool block. The handler degrades gracefully on
 * this — the card falls back to the raw modules a–f (design.md § Failure
 * fallback), so a generation failure is never a hard error surface.
 */
export class ClientSummaryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientSummaryUnavailableError";
    Object.setPrototypeOf(this, ClientSummaryUnavailableError.prototype);
  }
}

// ─── Minimal client seam (mirrors aiEstimation.MinimalBedrockClient) ─────────

type ContentBlockParam = { type: "text"; text: string };

type ToolUseResponseBlock = { type: "tool_use"; name: string; input: unknown };
type TextResponseBlock = { type: "text"; text: string };
type ResponseContentBlock = ToolUseResponseBlock | TextResponseBlock;

type MessagesCreateParams = {
  model: string;
  max_tokens: number;
  messages: Array<{ role: "user"; content: ContentBlockParam[] }>;
  tools: Array<{ name: string; input_schema: Record<string, unknown> }>;
  tool_choice: { type: "tool"; name: string };
};

type MessagesCreateResponse = {
  content: ResponseContentBlock[];
  stop_reason: string | null;
};

export type MinimalBedrockClient = {
  messages: {
    create: (
      params: MessagesCreateParams,
      options?: { timeout?: number },
    ) => Promise<MessagesCreateResponse>;
  };
};

let cachedClient: MinimalBedrockClient | null = null;

/**
 * Lazily construct the real client, cached across warm-Lambda calls. Never
 * constructed in tests — they always pass `deps.client`.
 *
 * ## ⚠ `maxRetries: 0` — same reason as `nutrition/services/aiBedrockClient`
 *
 * This module keeps its own copy of the client seam on purpose (see the header:
 * `trainers/` stays independent of the nutrition module). That independence has
 * a cost — a bug fixed over there is NOT fixed here — and this is the bug.
 *
 * The Anthropic SDK defaults `maxRetries` to **2**. Left unset, one
 * `createWithRetry` call below is 3 attempts × 12 s = 36 s, and it then retries
 * that: ~72 s against a 29 s Lambda. The function is killed mid-attempt, so
 * `ClientSummaryUnavailableError` is never thrown — no 503, no log line — and
 * because `didInfer` is set before the call in
 * `trainersMeGenerateClientAiSummaryHandler`, the hard kill also skips the
 * `finally` that writes the usage row for an inference Bedrock has billed.
 *
 * Loadout's re-map failed exactly this way on staging 2026-07-28. This surface
 * had not yet been unlucky enough to hit it.
 *
 * ⚠ If you change the retry policy here, change it in
 * `nutrition/services/aiBedrockClient.ts` too, and vice versa.
 */
export function getDefaultClient(): MinimalBedrockClient {
  if (!cachedClient) {
    cachedClient = new AnthropicBedrock({
      timeout: CLIENT_TIMEOUT_MS,
      maxRetries: 0,
    }) as unknown as MinimalBedrockClient;
  }
  return cachedClient;
}

/** Test seam: drop the cached client so construction can be re-asserted. */
export function resetDefaultClientForTests(): void {
  cachedClient = null;
}

// ─── Forced tool ─────────────────────────────────────────────────────────────

/**
 * The tool schema. `area` is limited to the areas that have evidence, so the
 * model is never offered an area it has no data for (the parser drops any it
 * writes anyway).
 */
export function reportSummaryTool(allowed: readonly SummaryArea[]) {
  return {
    name: TOOL_NAME,
    input_schema: {
      type: "object",
      properties: {
        headline: {
          type: "string",
          description: "One short sentence on the client's week.",
        },
        areas: {
          type: "array",
          description: "One line per area in the facts, and no others.",
          items: {
            type: "object",
            properties: {
              area: { type: "string", enum: [...allowed] },
              status: { type: "string", enum: [...AREA_STATUSES] },
              text: {
                type: "string",
                description: "One short sentence with the numbers.",
              },
            },
            required: ["area", "status", "text"],
          },
        },
        ask: {
          type: "string",
          description: "One thing worth raising at the next check-in.",
        },
      },
      required: ["headline", "areas", "ask"],
    },
  };
}

// Kept short: the facts carry the numbers, the tool schema carries the shape.
const INSTRUCTIONS = `You brief a fitness coach on one client's last 7 days. Use ONLY the JSON facts below and call report_summary.
Facts: training = workouts done in the last 7 days vs the weekly target. calories = days within 10% of target over the last 7 completed days; unlogged days are misses. programme = week of the client's programme. checkIns = their latest form answers. mealPlan = meals from the coach's plans logged in the last 7 completed days.
Status: good = on track, check = worth the coach's attention, info = neutral.
Never invent numbers, foods, workouts or trends. Refer to the client in the third person. Plain text, no emojis.`;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * One inference for the summary by area. `allowed` must be non-empty (the
 * route skips the call when no area has evidence). Throws
 * `ClientSummaryUnavailableError` on provider failure, a refusal, or output
 * that fails the strict parse.
 */
export async function generateClientSummary(
  evidence: WeeklySummaryEvidence,
  allowed: readonly SummaryArea[],
  deps: { client?: MinimalBedrockClient } = {},
): Promise<WeeklySummary> {
  const client = deps.client ?? getDefaultClient();

  const content: ContentBlockParam[] = [
    { type: "text", text: INSTRUCTIONS },
    // Compact JSON: no indentation, fewer input tokens.
    { type: "text", text: JSON.stringify(evidence) },
  ];

  const response = await createWithRetry(client, {
    model: SUMMARY_MODEL_ID,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content }],
    tools: [reportSummaryTool(allowed)],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  return parseSummaryResponse(response, allowed);
}

/** The model id this service resolves to (for the cache's `model` column). */
export function resolveSummaryModelId(): string {
  return SUMMARY_MODEL_ID;
}

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * One retry on a 5xx / timeout-shaped failure, then surface as
 * `ClientSummaryUnavailableError`. Both attempts must fit under the API Gateway
 * HTTP API 30s ceiling (2 × 12s + overhead — see CLIENT_TIMEOUT_MS).
 */
async function createWithRetry(
  client: MinimalBedrockClient,
  params: MessagesCreateParams,
): Promise<MessagesCreateResponse> {
  try {
    return await client.messages.create(params, {
      timeout: CLIENT_TIMEOUT_MS,
    });
  } catch (firstError) {
    if (!isRetryable(firstError)) {
      throw new ClientSummaryUnavailableError(
        `ai_summary_failed: ${describeError(firstError)}`,
      );
    }
    try {
      return await client.messages.create(params, {
        timeout: CLIENT_TIMEOUT_MS,
      });
    } catch (secondError) {
      throw new ClientSummaryUnavailableError(
        `ai_summary_failed_after_retry: ${describeError(secondError)}`,
      );
    }
  }
}

/**
 * ⚠ 408/409/429 are here because `maxRetries: 0` above removed the SDK's own
 * retry, which covered them. 429 is a Bedrock throttle and is `< 500`, so
 * without this line turning the hidden retries off would have turned a routine
 * throttle into a first-attempt failure. Mirrors
 * `nutrition/services/aiBedrockClient.isRetryable` — keep them in step.
 */
function isRetryable(error: unknown): boolean {
  const status = extractStatus(error);
  if (status === undefined) return true; // network/timeout/unknown
  if (status === 408 || status === 409 || status === 429) return true;
  return status >= 500;
}

function extractStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pull the `report_summary` tool_use block and parse it strictly. A refusal,
 * a missing tool block or any shape error raises
 * `ClientSummaryUnavailableError` (→ ai_unavailable at the route).
 */
function parseSummaryResponse(
  response: MessagesCreateResponse,
  allowed: readonly SummaryArea[],
): WeeklySummary {
  if (response.stop_reason === "refusal") {
    throw new ClientSummaryUnavailableError("ai_summary_refused");
  }

  const toolUseBlock = response.content.find(
    (block): block is ToolUseResponseBlock =>
      block.type === "tool_use" && block.name === TOOL_NAME,
  );
  if (!toolUseBlock) {
    throw new ClientSummaryUnavailableError(
      "ai_summary_missing_tool_use: model did not call report_summary",
    );
  }

  const parsed = parseWeeklySummary(toolUseBlock.input, allowed);
  if (!parsed) {
    throw new ClientSummaryUnavailableError("ai_summary_shape_invalid");
  }
  return parsed;
}
