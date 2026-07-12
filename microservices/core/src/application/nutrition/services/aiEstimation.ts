/**
 * Claude-on-Bedrock adapter for Tier B AI nutrition estimation (M9.5).
 * See specs/13-nutrition-tracking/design.md § Revised 2026-07-03 and
 * specs/_shared/cross-cuts.md § 4.
 *
 * The task-agnostic Bedrock client seam (injectable client, retry policy,
 * tool-use lookup) lives in `./aiBedrockClient` and is shared with
 * `recipeExtraction.ts` (Recipes AI). This module keeps only the
 * nutrition-estimate-specific prompts, schema, and shape validation.
 */
import {
  getDefaultClient,
  createWithRetry,
  findToolUse,
  clamp01,
  clampNonNegative,
  AiUnreadableError,
  AiUnavailableError,
  type MinimalBedrockClient,
  type ContentBlockParam,
  type MessagesCreateResponse,
} from "./aiBedrockClient";

// Re-exported so existing importers (the estimate + estimate-text
// handlers) keep working unchanged after the extraction.
export { AiUnreadableError, AiUnavailableError };
export type { MinimalBedrockClient } from "./aiBedrockClient";

const PHOTO_MODEL_ID =
  process.env.AI_PHOTO_MODEL_ID ?? "eu.anthropic.claude-opus-4-6-v1";
const TEXT_MODEL_ID =
  process.env.AI_TEXT_MODEL_ID ?? "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

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
 * Find the `report_estimate` tool_use block, validate its `.input`
 * roughly matches `AiEstimate`, and return it. Missing block, a refusal
 * stop_reason, or a shape mismatch all raise `AiUnreadableError`.
 */
function parseEstimateResponse(response: MessagesCreateResponse): AiEstimate {
  const rawInput = findToolUse(response, TOOL_NAME);

  const estimate = validateEstimateShape(rawInput);
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
  if (!Number.isFinite(obj.overallConfidence)) return null;
  if (typeof obj.notes !== "string") return null;

  const foods: AiFoodItem[] = [];
  for (const rawItem of obj.foods) {
    const item = validateFoodItemShape(rawItem);
    if (!item) return null;
    foods.push(item);
  }

  return {
    foods,
    overallConfidence: clamp01(obj.overallConfidence as number),
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
    if (!Number.isFinite(obj[field])) return null;
  }
  if (typeof obj.name !== "string") return null;
  if (typeof obj.unit !== "string") return null;

  return {
    name: obj.name,
    quantity: clampNonNegative(obj.quantity as number),
    unit: obj.unit,
    estimatedGrams: clampNonNegative(obj.estimatedGrams as number),
    kcal: clampNonNegative(obj.kcal as number),
    proteinG: clampNonNegative(obj.proteinG as number),
    carbsG: clampNonNegative(obj.carbsG as number),
    fatG: clampNonNegative(obj.fatG as number),
    confidence: clamp01(obj.confidence as number),
  };
}
