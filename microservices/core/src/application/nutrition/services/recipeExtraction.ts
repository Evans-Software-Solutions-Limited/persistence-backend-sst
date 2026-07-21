/**
 * Claude-on-Bedrock adapters for Recipes AI (recipe-photo extraction +
 * single-ingredient macro estimation). Reuses the shared Bedrock harness
 * in `./aiBedrockClient` — same injectable-client seam, retry policy, and
 * forced-tool-use pattern as `aiEstimation.ts` (M9.5 Tier B nutrition
 * estimation). See specs/13-nutrition-tracking/design.md and the
 * PR2_BACKEND_AI_BRIEF (Recipes AI) for the feature spec.
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
} from "./aiBedrockClient";

// Re-exported so the extract-recipe / resolve-ingredient handlers (and
// `resolveIngredientFood.ts`) can import the error classes from this
// service module, mirroring aiEstimation.ts's re-export of the same
// classes for the nutrition-estimate handlers.
export { AiUnreadableError, AiUnavailableError };

const RECIPE_MODEL_ID =
  process.env.AI_RECIPE_MODEL_ID ?? "eu.anthropic.claude-opus-4-6-v1";
// Deliberately the SAME env var as aiEstimation.ts's text-estimate model —
// a single ingredient-name → macros lookup is the same "cheap text task"
// shape as the free-text meal estimate, so it reuses that model config
// rather than introducing a redundant env var.
const FOOD_MACROS_MODEL_ID =
  process.env.AI_TEXT_MODEL_ID ?? "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

// Recipes can carry many ingredients + multi-step instructions — a wider
// budget than the 1500-token nutrition estimate (which returns at most a
// handful of food items).
const RECIPE_MAX_TOKENS = 2500;
// A single food-macros lookup returns six scalar fields — comfortably
// fits in a small budget.
const FOOD_MACROS_MAX_TOKENS = 400;

const REPORT_RECIPE_TOOL_NAME = "report_recipe";
const REPORT_FOOD_MACROS_TOOL_NAME = "report_food_macros";
const REPORT_RECIPE_MACROS_TOOL_NAME = "report_recipe_macros";

export type ExtractedIngredient = {
  name: string;
  quantity: number | null;
  unit: string | null;
};

export type ExtractedRecipe = {
  title: string;
  servings: number | null;
  timeMinutes: number | null;
  ingredients: ExtractedIngredient[];
  steps: string[];
  confidence: number; // 0..1
  notes: string | null;
};

export type EstimatedFoodMacros = {
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number; // PER 100 g
  confidence: number; // 0..1
};

export type EstimatedRecipeMacros = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number; // TOTAL for the whole recipe (all servings)
  confidence: number; // 0..1
};

// ─── JSON schemas for the forced tools ──────────────────────────────────

const EXTRACTED_INGREDIENT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    quantity: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
  },
  required: ["name", "quantity", "unit"],
};

const EXTRACTED_RECIPE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    servings: { type: ["number", "null"] },
    timeMinutes: { type: ["number", "null"] },
    ingredients: { type: "array", items: EXTRACTED_INGREDIENT_SCHEMA },
    steps: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    notes: { type: ["string", "null"] },
  },
  required: [
    "title",
    "servings",
    "timeMinutes",
    "ingredients",
    "steps",
    "confidence",
    "notes",
  ],
};

const REPORT_RECIPE_TOOL = {
  name: REPORT_RECIPE_TOOL_NAME,
  input_schema: EXTRACTED_RECIPE_SCHEMA,
};

const REPORT_FOOD_MACROS_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    kcal: { type: "number", minimum: 0 },
    proteinG: { type: "number", minimum: 0 },
    carbsG: { type: "number", minimum: 0 },
    fatG: { type: "number", minimum: 0 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["name", "kcal", "proteinG", "carbsG", "fatG", "confidence"],
};

const REPORT_FOOD_MACROS_TOOL = {
  name: REPORT_FOOD_MACROS_TOOL_NAME,
  input_schema: REPORT_FOOD_MACROS_SCHEMA,
};

const REPORT_RECIPE_MACROS_SCHEMA = {
  type: "object",
  properties: {
    kcal: { type: "number", minimum: 0 },
    proteinG: { type: "number", minimum: 0 },
    carbsG: { type: "number", minimum: 0 },
    fatG: { type: "number", minimum: 0 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["kcal", "proteinG", "carbsG", "fatG", "confidence"],
};

const REPORT_RECIPE_MACROS_TOOL = {
  name: REPORT_RECIPE_MACROS_TOOL_NAME,
  input_schema: REPORT_RECIPE_MACROS_SCHEMA,
};

// ─── Prompts ─────────────────────────────────────────────────────────────

const RECIPE_INSTRUCTIONS = `You are transcribing a recipe from a photographed DOCUMENT — a cookbook page, a printed recipe card, a screenshot of a recipe website or app, or handwritten notes. This is NOT a photo of food on a plate: do not estimate what food is being eaten or its portion size. READ and TRANSCRIBE what is written.

Extract:
- title: the recipe's name/title as written.
- servings: the number of servings/portions stated, or null if not stated.
- timeMinutes: the total time in minutes (however the source states it — prep + cook, or a single total), or null if not stated.
- ingredients: an ORDERED list of every ingredient in the order listed. For each: name, a numeric quantity (or null if no clear number is given), and a unit (or null if none is given / unclear).
- steps: an ORDERED list of the instruction steps, transcribed as written — one array entry per step, do not merge multiple steps into one entry.
- confidence (0-1): your overall confidence in the transcription's accuracy and completeness.
- notes: anything unreadable, ambiguous, or cut off (e.g. "bottom-right corner of the ingredient list was cropped"), or null if there is nothing to flag.

Do NOT invent ingredients or steps that are not in the photo. If part of the document is illegible, omit that item rather than guessing, and mention it in notes.

Call the report_recipe tool with your findings. Do not respond with plain text.`;

const FOOD_MACROS_INSTRUCTIONS = `You are a nutrition-estimation assistant. Given the name of a single food or ingredient, return its TYPICAL macros for a generic, unbranded version of that food, PER 100 g (or per 100 ml for liquids).

- kcal, proteinG, carbsG, fatG: per-100g/100ml values for a typical/generic preparation of this food (assume raw unless the name implies a cooked/prepared form, e.g. "cooked rice" or "grilled chicken").
- confidence (0-1): your confidence in these values being representative of a generic version of this food — lower it if the name is ambiguous (it could plausibly refer to very different foods) or unfamiliar.

Call the report_food_macros tool with your findings. Do not respond with plain text.`;

const RECIPE_MACROS_INSTRUCTIONS = `You are a nutrition-estimation assistant. Given a recipe's name, its full ingredient list, and how many servings it makes, estimate the TOTAL macronutrients for the ENTIRE recipe as prepared — i.e. the sum across ALL servings combined, NOT per serving.

- kcal, proteinG, carbsG, fatG: totals for the whole recipe (every serving added together). Interpret each ingredient's stated quantity/unit (e.g. "200g", "2 cups", "3 large eggs") and sum their contributions. If a quantity is missing or vague, assume a typical amount for that ingredient in this dish.
- confidence (0-1): your confidence in the totals — lower it when quantities are missing/ambiguous or ingredients are unusual.

Treat the servings count as context for sanity-checking the total's scale; still return the WHOLE-recipe total, not the per-serving figure.

Call the report_recipe_macros tool with your findings. Do not respond with plain text.`;

// ─── Public API ──────────────────────────────────────────────────────────

export async function extractRecipeFromPhoto(
  input: { imageBase64: string; mediaType: "image/jpeg" | "image/png" },
  deps: { client?: MinimalBedrockClient } = {},
): Promise<ExtractedRecipe> {
  const client = deps.client ?? getDefaultClient();

  const content: ContentBlockParam[] = [
    { type: "text", text: RECIPE_INSTRUCTIONS },
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
    model: RECIPE_MODEL_ID,
    max_tokens: RECIPE_MAX_TOKENS,
    messages: [{ role: "user", content }],
    tools: [REPORT_RECIPE_TOOL],
    tool_choice: { type: "tool", name: REPORT_RECIPE_TOOL_NAME },
  });

  const rawInput = findToolUse(response, REPORT_RECIPE_TOOL_NAME);
  const recipe = validateExtractedRecipeShape(rawInput);
  if (!recipe) {
    throw new AiUnreadableError(
      "ai_response_shape_invalid: report_recipe input did not match ExtractedRecipe",
    );
  }
  return recipe;
}

export async function estimateFoodMacros(
  input: { name: string },
  deps: { client?: MinimalBedrockClient } = {},
): Promise<EstimatedFoodMacros> {
  const client = deps.client ?? getDefaultClient();

  const content: ContentBlockParam[] = [
    {
      type: "text",
      text: `${FOOD_MACROS_INSTRUCTIONS}\n\nFood name: "${input.name}"`,
    },
  ];

  const response = await createWithRetry(client, {
    model: FOOD_MACROS_MODEL_ID,
    max_tokens: FOOD_MACROS_MAX_TOKENS,
    messages: [{ role: "user", content }],
    tools: [REPORT_FOOD_MACROS_TOOL],
    tool_choice: { type: "tool", name: REPORT_FOOD_MACROS_TOOL_NAME },
  });

  const rawInput = findToolUse(response, REPORT_FOOD_MACROS_TOOL_NAME);
  const macros = validateFoodMacrosShape(rawInput);
  if (!macros) {
    throw new AiUnreadableError(
      "ai_response_shape_invalid: report_food_macros input did not match EstimatedFoodMacros",
    );
  }
  return macros;
}

export async function estimateRecipeMacros(
  input: { name: string; ingredients: string[]; servings?: number | null },
  deps: { client?: MinimalBedrockClient } = {},
): Promise<EstimatedRecipeMacros> {
  const client = deps.client ?? getDefaultClient();

  const ingredientLines =
    input.ingredients.length > 0
      ? input.ingredients.map((i) => `- ${i}`).join("\n")
      : "(no ingredient list provided)";
  const servingsLine =
    typeof input.servings === "number" && input.servings > 0
      ? `\nServings: ${input.servings}`
      : "";

  const content: ContentBlockParam[] = [
    {
      type: "text",
      text: `${RECIPE_MACROS_INSTRUCTIONS}\n\nRecipe: "${input.name}"${servingsLine}\nIngredients:\n${ingredientLines}`,
    },
  ];

  const response = await createWithRetry(client, {
    // A whole-recipe total from a name + ingredient list is the same "cheap
    // text task" shape as the single-ingredient estimate — reuse that model.
    model: FOOD_MACROS_MODEL_ID,
    max_tokens: FOOD_MACROS_MAX_TOKENS,
    messages: [{ role: "user", content }],
    tools: [REPORT_RECIPE_MACROS_TOOL],
    tool_choice: { type: "tool", name: REPORT_RECIPE_MACROS_TOOL_NAME },
  });

  const rawInput = findToolUse(response, REPORT_RECIPE_MACROS_TOOL_NAME);
  const macros = validateRecipeMacrosShape(rawInput);
  if (!macros) {
    throw new AiUnreadableError(
      "ai_response_shape_invalid: report_recipe_macros input did not match EstimatedRecipeMacros",
    );
  }
  return macros;
}

// ─── Internal — shape validation ────────────────────────────────────────

type NullableCoerceResult<T> = { ok: true; value: T | null } | { ok: false };

/**
 * `null`/`undefined` → valid `null` (missing-optional-field tolerance);
 * a finite `number` → valid; anything else (string, NaN, ±Infinity,
 * object) → invalid. Mirrors aiEstimation's non-finite-rejects-the-whole-
 * response rule, but for a field the model is allowed to omit entirely.
 */
function coerceNullableNumber(value: unknown): NullableCoerceResult<number> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === "number") {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  return { ok: false };
}

function coerceNullableString(value: unknown): NullableCoerceResult<string> {
  if (value === null || value === undefined) return { ok: true, value: null };
  return typeof value === "string" ? { ok: true, value } : { ok: false };
}

function validateExtractedIngredientShape(
  input: unknown,
): ExtractedIngredient | null {
  if (typeof input !== "object" || input === null) return null;
  const obj = input as Record<string, unknown>;

  if (typeof obj.name !== "string") return null;

  const quantity = coerceNullableNumber(obj.quantity);
  if (!quantity.ok) return null;

  const unit = coerceNullableString(obj.unit);
  if (!unit.ok) return null;

  return { name: obj.name, quantity: quantity.value, unit: unit.value };
}

/**
 * Validates the `report_recipe` tool input against `ExtractedRecipe`.
 * Non-finite numbers reject the whole payload as unreadable; confidence
 * is clamped 0..1 (Bedrock doesn't hard-enforce the schema's advisory
 * min/max — same rationale as aiEstimation's clamp helpers); a missing
 * `ingredients`/`steps` array coerces to `[]` rather than rejecting, since
 * an otherwise-good transcription shouldn't be discarded for omitting an
 * empty list.
 */
function validateExtractedRecipeShape(input: unknown): ExtractedRecipe | null {
  if (typeof input !== "object" || input === null) return null;
  const obj = input as Record<string, unknown>;

  if (typeof obj.title !== "string") return null;

  const servings = coerceNullableNumber(obj.servings);
  if (!servings.ok) return null;

  const timeMinutes = coerceNullableNumber(obj.timeMinutes);
  if (!timeMinutes.ok) return null;

  const rawIngredients = obj.ingredients ?? [];
  if (!Array.isArray(rawIngredients)) return null;
  const ingredients: ExtractedIngredient[] = [];
  for (const rawItem of rawIngredients) {
    const item = validateExtractedIngredientShape(rawItem);
    if (!item) return null;
    ingredients.push(item);
  }

  const rawSteps = obj.steps ?? [];
  if (!Array.isArray(rawSteps)) return null;
  const steps: string[] = [];
  for (const step of rawSteps) {
    if (typeof step !== "string") return null;
    steps.push(step);
  }

  if (!Number.isFinite(obj.confidence)) return null;

  const notes = coerceNullableString(obj.notes);
  if (!notes.ok) return null;

  return {
    title: obj.title,
    servings: servings.value,
    timeMinutes: timeMinutes.value,
    ingredients,
    steps,
    confidence: clamp01(obj.confidence as number),
    notes: notes.value,
  };
}

/**
 * Validates the `report_food_macros` tool input against
 * `EstimatedFoodMacros`. Non-finite numbers reject as unreadable; macro
 * fields clamp non-negative and confidence clamps 0..1 (same advisory-
 * schema rationale as aiEstimation.ts).
 */
function validateFoodMacrosShape(input: unknown): EstimatedFoodMacros | null {
  if (typeof input !== "object" || input === null) return null;
  const obj = input as Record<string, unknown>;

  if (typeof obj.name !== "string") return null;

  const numericFields = [
    "kcal",
    "proteinG",
    "carbsG",
    "fatG",
    "confidence",
  ] as const;
  for (const field of numericFields) {
    if (!Number.isFinite(obj[field])) return null;
  }

  return {
    name: obj.name,
    kcal: clampNonNegative(obj.kcal as number),
    proteinG: clampNonNegative(obj.proteinG as number),
    carbsG: clampNonNegative(obj.carbsG as number),
    fatG: clampNonNegative(obj.fatG as number),
    confidence: clamp01(obj.confidence as number),
  };
}

/**
 * Validates the `report_recipe_macros` tool input against
 * `EstimatedRecipeMacros` (whole-recipe totals; no `name` field). Same
 * non-finite-rejects + clamp rules as `validateFoodMacrosShape`.
 */
function validateRecipeMacrosShape(
  input: unknown,
): EstimatedRecipeMacros | null {
  if (typeof input !== "object" || input === null) return null;
  const obj = input as Record<string, unknown>;

  const numericFields = [
    "kcal",
    "proteinG",
    "carbsG",
    "fatG",
    "confidence",
  ] as const;
  for (const field of numericFields) {
    if (!Number.isFinite(obj[field])) return null;
  }

  return {
    kcal: clampNonNegative(obj.kcal as number),
    proteinG: clampNonNegative(obj.proteinG as number),
    carbsG: clampNonNegative(obj.carbsG as number),
    fatG: clampNonNegative(obj.fatG as number),
    confidence: clamp01(obj.confidence as number),
  };
}
