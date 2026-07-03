import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";

/**
 * Claude-on-Bedrock adapter for Tier B AI nutrition estimation (M9.5).
 * See specs/13-nutrition-tracking/design.md § Revised 2026-07-03 and
 * specs/_shared/cross-cuts.md § 4.
 *
 * Auth is IAM SigV4 from the Lambda execution role (no API-key secret —
 * see `infra/api.ts`'s `bedrock:InvokeModel` permissions on the route).
 * Structured output uses FORCED TOOL USE (`tool_choice: { type: 'tool',
 * name: 'report_estimate' }`) rather than `output_config.format` —
 * structured-outputs support is fragmented across Bedrock
 * endpoints/models while tool-forcing works on every Claude model on
 * every rail.
 *
 * The client is injectable (`deps.client`) — the exact same seam as
 * `nutrition/barcode/services/openFoodFacts.ts`'s `deps.fetcher` — so
 * unit tests inject a fake `{ messages: { create } }` object and never
 * make a live network call. CI needs no AWS credentials.
 */

const PHOTO_MODEL_ID =
  process.env.AI_PHOTO_MODEL_ID ?? "eu.anthropic.claude-opus-4-6-v1";
const TEXT_MODEL_ID =
  process.env.AI_TEXT_MODEL_ID ?? "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

const CLIENT_TIMEOUT_MS = 25_000;
const MAX_TOKENS = 1500;
const TOOL_NAME = "report_estimate";

export type AiFoodItem = {
  name: string;
  quantity: number;
  unit: string;
  estimatedGrams: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: number; // 0..1
};

export type AiEstimate = {
  foods: AiFoodItem[];
  overallConfidence: number; // 0..1
  notes: string;
};

/**
 * Model refused, returned no `tool_use` block, or returned a
 * `report_estimate` input that doesn't match the expected shape. Maps to
 * HTTP 422 `ai_unreadable` at the handler.
 */
export class AiUnreadableError extends Error {
  // Plain field declaration, not a constructor parameter property — the
  // web package's tsconfig has `erasableSyntaxOnly: true`, which forbids
  // parameter properties. Mirrors `EntitlementError` in
  // `application/entitlement/assertEntitlement.ts`.
  constructor(message: string) {
    super(message);
    this.name = "AiUnreadableError";
    Object.setPrototypeOf(this, AiUnreadableError.prototype);
  }
}

/**
 * Provider unreachable / timed out after the one retry. Maps to HTTP 503
 * `ai_unavailable` at the handler.
 */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
    Object.setPrototypeOf(this, AiUnavailableError.prototype);
  }
}

// ─── Minimal client seam ────────────────────────────────────────────────
//
// We depend on only the slice of the Anthropic Messages API surface we
// actually call, rather than the full `AnthropicBedrock` type — this
// keeps the injectable-fake shape trivial in tests (no need to construct
// a real SDK instance) while still type-checking against the real
// client, which structurally satisfies this interface.

type ContentBlockParam =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png";
        data: string;
      };
    };

type ToolUseResponseBlock = {
  type: "tool_use";
  name: string;
  input: unknown;
};

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
 * Lazily construct the real `AnthropicBedrock` client. Cached across
 * calls within a warm Lambda so we don't rebuild the credential-provider
 * chain on every invocation. Never constructed in tests — they always
 * pass `deps.client`.
 */
function getDefaultClient(): MinimalBedrockClient {
  if (!cachedClient) {
    cachedClient = new AnthropicBedrock({
      timeout: CLIENT_TIMEOUT_MS,
    }) as unknown as MinimalBedrockClient;
  }
  return cachedClient;
}

// ─── JSON schema for the forced tool ────────────────────────────────────

const AI_FOOD_ITEM_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    quantity: { type: "number", minimum: 0 },
    unit: { type: "string" },
    estimatedGrams: { type: "number", minimum: 0 },
    kcal: { type: "number", minimum: 0 },
    proteinG: { type: "number", minimum: 0 },
    carbsG: { type: "number", minimum: 0 },
    fatG: { type: "number", minimum: 0 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "name",
    "quantity",
    "unit",
    "estimatedGrams",
    "kcal",
    "proteinG",
    "carbsG",
    "fatG",
    "confidence",
  ],
};

const AI_ESTIMATE_SCHEMA = {
  type: "object",
  properties: {
    foods: { type: "array", items: AI_FOOD_ITEM_SCHEMA },
    overallConfidence: { type: "number", minimum: 0, maximum: 1 },
    notes: { type: "string" },
  },
  required: ["foods", "overallConfidence", "notes"],
};

const REPORT_ESTIMATE_TOOL = {
  name: TOOL_NAME,
  input_schema: AI_ESTIMATE_SCHEMA,
};

// ─── Prompts ─────────────────────────────────────────────────────────────

const PHOTO_INSTRUCTIONS = `You are a nutrition-estimation assistant. Look at the attached photo of food/drink and identify each distinct item visible.

For each item:
- Estimate the portion AS SERVED in the photo, in grams (or millilitres for liquids) — NOT a per-100g reference value.
- Compute kcal, protein (g), carbs (g), and fat (g) for THAT portion, not per 100g.
- If packaging or a nutrition label is visible, use its stated values assuming the whole visible unit was consumed, unless it's clearly partially eaten/poured.
- Infer added cooking fats (oil, butter) from visual cues such as shine, pooling, or frying residue, and fold their calories into the relevant item.
- Do NOT invent items that are not visible in the photo.
- Set each item's confidence (0–1) to reflect your combined certainty about BOTH what the food is AND how big the portion is.

Set overallConfidence (0-1) to your combined confidence across all identified items. Use notes for anything the user should know (e.g. "couldn't see under the sauce", "assumed a standard slice size").

Call the report_estimate tool with your findings. Do not respond with plain text.`;

const TEXT_INSTRUCTIONS = `You are a nutrition-estimation assistant. The user has described a meal in free text (no photo). Read the description and identify each distinct food/drink item mentioned or clearly implied.

For each item:
- Estimate a realistic portion in grams (or millilitres for liquids) based on the description (use standard serving sizes when the user doesn't specify an amount).
- Compute kcal, protein (g), carbs (g), and fat (g) for THAT portion, not per 100g.
- Do NOT invent items that are not mentioned or clearly implied by the description.
- Set each item's confidence (0–1) to reflect your combined certainty about BOTH what the food is AND how big the portion is — text descriptions are inherently less certain than a photo, so confidence should usually be lower than a photo-based estimate for the same food.

Set overallConfidence (0-1) to your combined confidence across all identified items. Use notes for anything the user should know (e.g. "assumed a medium portion since no size was given").

Call the report_estimate tool with your findings. Do not respond with plain text.`;

// ─── Public API ──────────────────────────────────────────────────────────

export async function estimateFromPhoto(
  input: {
    imageBase64: string;
    mediaType: "image/jpeg" | "image/png";
    mealType?: string;
  },
  deps: { client?: MinimalBedrockClient } = {},
): Promise<AiEstimate> {
  const client = deps.client ?? getDefaultClient();

  const instructions = input.mealType
    ? `${PHOTO_INSTRUCTIONS}\n\nThe user tagged this meal as: ${input.mealType}.`
    : PHOTO_INSTRUCTIONS;

  const content: ContentBlockParam[] = [
    { type: "text", text: instructions },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: input.mediaType,
        data: input.imageBase64,
      },
    },
  ];

  const response = await createWithRetry(client, {
    model: PHOTO_MODEL_ID,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content }],
    tools: [REPORT_ESTIMATE_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  return parseEstimateResponse(response);
}

export async function estimateFromText(
  input: { description: string },
  deps: { client?: MinimalBedrockClient } = {},
): Promise<AiEstimate> {
  const client = deps.client ?? getDefaultClient();

  const content: ContentBlockParam[] = [
    {
      type: "text",
      text: `${TEXT_INSTRUCTIONS}\n\nMeal description: "${input.description}"`,
    },
  ];

  const response = await createWithRetry(client, {
    model: TEXT_MODEL_ID,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content }],
    tools: [REPORT_ESTIMATE_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });

  return parseEstimateResponse(response);
}

// ─── Internal ────────────────────────────────────────────────────────────

/**
 * One retry on a 5xx / timeout-shaped failure. A second failure of the
 * same shape (or any non-retryable error) surfaces as
 * `AiUnavailableError` — we do not retry into a slow provider outage
 * indefinitely, and the whole call must fit well inside the Lambda's
 * 120s budget (2 × 25s client timeout + a comfortable margin).
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
      throw new AiUnavailableError(
        `ai_estimation_failed: ${describeError(firstError)}`,
      );
    }
    try {
      return await client.messages.create(params, {
        timeout: CLIENT_TIMEOUT_MS,
      });
    } catch (secondError) {
      throw new AiUnavailableError(
        `ai_estimation_failed_after_retry: ${describeError(secondError)}`,
      );
    }
  }
}

/**
 * Retryable = 5xx status from the provider, or a timeout/network-shaped
 * error. Anthropic SDK errors carry a numeric `.status` on 4xx/5xx;
 * AbortError / network errors don't carry `.status` at all, and we treat
 * the absence of a definitive 4xx client error as retryable too — a
 * malformed-request 4xx wouldn't normally reach here since we control
 * the request shape.
 */
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
 * Find the `report_estimate` tool_use block, validate its `.input`
 * roughly matches `AiEstimate`, and return it. Missing block, a refusal
 * stop_reason, or a shape mismatch all raise `AiUnreadableError`.
 */
function parseEstimateResponse(response: MessagesCreateResponse): AiEstimate {
  if (response.stop_reason === "refusal") {
    throw new AiUnreadableError("ai_refused_to_answer");
  }

  const toolUseBlock = response.content.find(
    (block): block is ToolUseResponseBlock =>
      block.type === "tool_use" && block.name === TOOL_NAME,
  );

  if (!toolUseBlock) {
    throw new AiUnreadableError(
      "ai_response_missing_tool_use: model did not call report_estimate",
    );
  }

  const estimate = validateEstimateShape(toolUseBlock.input);
  if (!estimate) {
    throw new AiUnreadableError(
      "ai_response_shape_invalid: report_estimate input did not match AiEstimate",
    );
  }

  return estimate;
}

function validateEstimateShape(input: unknown): AiEstimate | null {
  if (typeof input !== "object" || input === null) return null;
  const obj = input as Record<string, unknown>;

  if (!Array.isArray(obj.foods)) return null;
  if (typeof obj.overallConfidence !== "number") return null;
  if (typeof obj.notes !== "string") return null;

  const foods: AiFoodItem[] = [];
  for (const rawItem of obj.foods) {
    const item = validateFoodItemShape(rawItem);
    if (!item) return null;
    foods.push(item);
  }

  return {
    foods,
    overallConfidence: obj.overallConfidence,
    notes: obj.notes,
  };
}

function validateFoodItemShape(input: unknown): AiFoodItem | null {
  if (typeof input !== "object" || input === null) return null;
  const obj = input as Record<string, unknown>;

  const numericFields = [
    "quantity",
    "estimatedGrams",
    "kcal",
    "proteinG",
    "carbsG",
    "fatG",
    "confidence",
  ] as const;

  for (const field of numericFields) {
    if (typeof obj[field] !== "number") return null;
  }
  if (typeof obj.name !== "string") return null;
  if (typeof obj.unit !== "string") return null;

  return {
    name: obj.name,
    quantity: obj.quantity as number,
    unit: obj.unit,
    estimatedGrams: obj.estimatedGrams as number,
    kcal: obj.kcal as number,
    proteinG: obj.proteinG as number,
    carbsG: obj.carbsG as number,
    fatG: obj.fatG as number,
    confidence: obj.confidence as number,
  };
}
