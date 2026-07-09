import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";

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
 * PRIVACY: the caller passes ONLY Client Detail modules a–f (per-day totals +
 * adherence — design.md:605-606). This service never sees the food-level entry
 * log; the prompt is grounded strictly in the structured summary it is handed.
 */

const SUMMARY_MODEL_ID =
  process.env.AI_COACH_SUMMARY_MODEL_ID ??
  "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

// Per-attempt Bedrock timeout. This handler serves the coreAPI ApiGatewayV2
// (HTTP API) route, whose integration ceiling is a hard 30s. Two attempts must
// fit under it with headroom: 2 × 12s + overhead < 30s (mirrors aiEstimation).
const CLIENT_TIMEOUT_MS = 12_000;
const MAX_TOKENS = 700;
const TOOL_NAME = "report_summary";

/** Structured inputs = Client Detail modules a–f + this-week rollup. */
export type ClientSummaryInput = {
  clientName: string;
  coversDate: string; // YYYY-MM-DD — the concluded client-local day
  adherence: {
    overall: number | null; // 28-day completed-vs-target %
    band: string | null;
  };
  prs: { exerciseName: string; type: string; value: number; unit: string }[];
  volume: { weekKg: number | null };
  calorieHit: {
    targetKcal: number | null;
    daysHit: number;
    daysLogged: number;
    todayKcal: number | null;
  } | null;
  goal: {
    title: string;
    assignedByCoach: boolean;
    startKg: number | null;
    nowKg: number | null;
    targetKg: number | null;
    pct: number | null;
  } | null;
  habits: {
    collectionStreak: number;
    collectionSatisfied: boolean;
    items: { label: string; met: boolean }[];
  } | null;
  thisWeek: {
    workoutsCompleted: number;
    workoutsPlanned: number | null;
    prs: number;
  };
};

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
 */
function getDefaultClient(): MinimalBedrockClient {
  if (!cachedClient) {
    cachedClient = new AnthropicBedrock({
      timeout: CLIENT_TIMEOUT_MS,
    }) as unknown as MinimalBedrockClient;
  }
  return cachedClient;
}

// ─── Forced tool ─────────────────────────────────────────────────────────────

const REPORT_SUMMARY_TOOL = {
  name: TOOL_NAME,
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description:
          "A short coach-facing summary (2–4 sentences) plus one suggested focus, grounded ONLY in the provided data.",
      },
    },
    required: ["summary"],
  },
};

const INSTRUCTIONS = `You are a strength-and-conditioning coach's assistant. You are given a structured snapshot of ONE client's recent training, nutrition-adherence, goal, and habit data for the concluded day. Write a concise, coach-facing summary the coach can read at a glance before their next check-in.

Rules:
- 2–4 sentences of summary, then ONE short suggested focus for the coach (prefix it "Focus: ").
- Ground EVERYTHING strictly in the numbers provided — never invent workouts, foods, weights, or trends that are not in the data.
- If a section is null/empty, treat it as "no data" — do not speculate.
- Be specific and quantitative where the data allows (e.g. "hit calories 4/6 logged days", "volume 12,400 kg this week").
- Neutral, professional tone. No emojis. No markdown headings. Do not address the client directly — you are briefing the coach.
- This data is per-day totals and adherence only; you do NOT have the client's food log, so never reference individual foods or meals.

Call the report_summary tool with your summary text. Do not respond with plain text.`;

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generateClientSummary(
  input: ClientSummaryInput,
  deps: { client?: MinimalBedrockClient } = {},
): Promise<string> {
  const client = deps.client ?? getDefaultClient();

  const content: ContentBlockParam[] = [
    { type: "text", text: INSTRUCTIONS },
    {
      type: "text",
      text: `Client data for ${input.coversDate}:\n${JSON.stringify(
        input,
        null,
        2,
      )}`,
    },
  ];

  const response = await createWithRetry(client, {
    model: SUMMARY_MODEL_ID,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content }],
    tools: [REPORT_SUMMARY_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  return parseSummaryResponse(response);
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

function isRetryable(error: unknown): boolean {
  const status = extractStatus(error);
  if (status === undefined) return true; // network/timeout/unknown
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
 * Pull the `report_summary` tool_use block and its non-empty `summary` string.
 * A refusal, a missing tool block, or an empty/invalid summary all raise
 * `ClientSummaryUnavailableError` (→ graceful card fallback at the handler).
 */
function parseSummaryResponse(response: MessagesCreateResponse): string {
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

  const input = toolUseBlock.input;
  if (typeof input !== "object" || input === null) {
    throw new ClientSummaryUnavailableError("ai_summary_shape_invalid");
  }
  const summary = (input as { summary?: unknown }).summary;
  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new ClientSummaryUnavailableError("ai_summary_empty");
  }
  return summary.trim();
}
