import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";

/**
 * Task-agnostic Claude-on-Bedrock primitives, extracted from
 * `nutrition/services/aiEstimation.ts` (M9.5) so the Recipes AI
 * extraction/resolution services (recipeExtraction.ts) can reuse the same
 * client seam, retry policy, and tool-use parsing scaffolding rather than
 * re-implementing them. See specs/13-nutrition-tracking/design.md
 * § Revised 2026-07-03 and specs/_shared/cross-cuts.md § 4 for the
 * original rationale — everything below is unchanged behaviour, just
 * relocated.
 *
 * Auth is IAM SigV4 from the Lambda execution role (no API-key secret —
 * see `infra/api.ts`'s `bedrock:InvokeModel` permissions on the route).
 * Structured output uses FORCED TOOL USE (`tool_choice: { type: 'tool',
 * name: '<tool>' }`) rather than `output_config.format` — structured-
 * outputs support is fragmented across Bedrock endpoints/models while
 * tool-forcing works on every Claude model on every rail.
 *
 * The client is injectable (`deps.client`) — the exact same seam as
 * `nutrition/barcode/services/openFoodFacts.ts`'s `deps.fetcher` — so
 * unit tests inject a fake `{ messages: { create } }` object and never
 * make a live network call. CI needs no AWS credentials.
 */

// Per-attempt Bedrock timeout. These handlers serve the coreAPI
// ApiGatewayV2 (HTTP API) route, whose integration ceiling is a hard
// 30s — NOT the 120s the cron Lambdas get. Two attempts must fit under
// that ceiling with headroom for auth/validation/usage-log overhead:
// 2 × 12s + overhead < 30s. Eval (2026-07-03) measured opus-4-6 median
// 6.1s / worst ~9s on 640px photos, so 12s clears the real p99 while
// keeping the retry affordable.
export const CLIENT_TIMEOUT_MS = 12_000;

// ─── Minimal client seam ────────────────────────────────────────────────
//
// We depend on only the slice of the Anthropic Messages API surface we
// actually call, rather than the full `AnthropicBedrock` type — this
// keeps the injectable-fake shape trivial in tests (no need to construct
// a real SDK instance) while still type-checking against the real
// client, which structurally satisfies this interface.

export type ContentBlockParam =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png";
        data: string;
      };
    };

export type ToolUseResponseBlock = {
  type: "tool_use";
  name: string;
  input: unknown;
};

type TextResponseBlock = { type: "text"; text: string };

type ResponseContentBlock = ToolUseResponseBlock | TextResponseBlock;

export type MessagesCreateParams = {
  model: string;
  max_tokens: number;
  messages: Array<{ role: "user"; content: ContentBlockParam[] }>;
  tools: Array<{ name: string; input_schema: Record<string, unknown> }>;
  tool_choice: { type: "tool"; name: string };
};

export type MessagesCreateResponse = {
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

/**
 * Model refused, returned no `tool_use` block, or returned a tool input
 * that doesn't match the caller's expected shape. Maps to HTTP 422
 * `ai_unreadable` at the handler.
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

let cachedClient: MinimalBedrockClient | null = null;

/**
 * Lazily construct the real `AnthropicBedrock` client. Cached across
 * calls within a warm Lambda so we don't rebuild the credential-provider
 * chain on every invocation. Never constructed in tests — they always
 * pass `deps.client`.
 */
export function getDefaultClient(): MinimalBedrockClient {
  if (!cachedClient) {
    cachedClient = new AnthropicBedrock({
      timeout: CLIENT_TIMEOUT_MS,
    }) as unknown as MinimalBedrockClient;
  }
  return cachedClient;
}

/**
 * One retry on a 5xx / timeout-shaped failure. A second failure of the
 * same shape (or any non-retryable error) surfaces as
 * `AiUnavailableError` — we do not retry into a slow provider outage
 * indefinitely, and both attempts must fit under the API Gateway HTTP
 * API 30s integration ceiling (2 × 12s client timeout + overhead — see
 * CLIENT_TIMEOUT_MS).
 */
export async function createWithRetry(
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
export function isRetryable(error: unknown): boolean {
  const status = extractStatus(error);
  if (status === undefined) return true; // network/timeout/unknown
  return status >= 500;
}

export function extractStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Find the `toolName` tool_use block in a Messages response, raising
 * `AiUnreadableError` on a refusal stop_reason or a missing/mismatched
 * tool_use block. Returns the raw `.input` — callers own shape
 * validation for their own tool payload (the task-specific half of what
 * was `parseEstimateResponse` in aiEstimation.ts).
 */
export function findToolUse(
  response: MessagesCreateResponse,
  toolName: string,
): unknown {
  if (response.stop_reason === "refusal") {
    throw new AiUnreadableError("ai_refused_to_answer");
  }

  const toolUseBlock = response.content.find(
    (block): block is ToolUseResponseBlock =>
      block.type === "tool_use" && block.name === toolName,
  );

  if (!toolUseBlock) {
    throw new AiUnreadableError(
      `ai_response_missing_tool_use: model did not call ${toolName}`,
    );
  }

  return toolUseBlock.input;
}

/**
 * Bedrock does NOT hard-validate the returned `tool_use.input` against
 * the declared `input_schema` — the schema's `minimum`/`maximum` bounds
 * are advisory to the model. So range enforcement happens at the
 * caller's shape-validation step: non-finite numbers (NaN/±Infinity)
 * reject the whole payload as unreadable, while merely out-of-range
 * values are clamped rather than rejected — one `-0.1 g fat` shouldn't
 * discard an otherwise-usable estimate the user is about to review and
 * edit anyway.
 */
export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function clampNonNegative(n: number): number {
  return Math.max(0, n);
}
