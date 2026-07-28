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
//
// ⚠ CORRECTION (2026-07-27): the binding constraint was never the 30s
// gateway ceiling — it is the LAMBDA's own timeout, and SST defaults
// that to **20 seconds**. So `2 × 12s = 24s` did not fit: on the retry
// path the function was killed ~8s into the second attempt, meaning the
// retry could never complete AND the hard-kill skipped the handlers'
// `finally` blocks, so no `ai_usage_log` row was written for an
// inference the provider had already billed. `infra/api.ts` now sets an
// explicit `timeout: "29 seconds"` on the route, under which the
// arithmetic above finally holds. **Do not lower that route timeout
// without re-deriving this constant.**
export const CLIENT_TIMEOUT_MS = 12_000;

/**
 * Measured output throughput for Haiku-class Claude on Bedrock (eu-west-2).
 *
 * **122 tok/s** over a 5,056-token generation, 2026-07-28. Rounded DOWN to 100
 * for headroom — this number sizes timeouts, so erring slow is the safe
 * direction, and Opus-class surfaces are slower still.
 *
 * ⚠ This exists because a timeout that cannot physically receive `max_tokens`
 * of output is a timeout that fires on success. See `maxTokensForBudget`.
 */
export const OUTPUT_TOKENS_PER_SECOND = 100;

/**
 * Everything before the first output token: request transfer, input prefill,
 * queueing. 3 s covers a ~25 k-token prompt with room to spare (measured ~1.5 s
 * for 23 k input tokens).
 */
export const PREFILL_ALLOWANCE_MS = 3_000;

/**
 * The largest `max_tokens` an attempt of `timeoutMs` can actually receive.
 *
 * ## ⚠ Why this function exists
 *
 * `max_tokens` and the attempt timeout are two halves of one budget, and
 * nothing connected them. Output tokens are generated serially at a bounded
 * rate, so asking for N tokens commits the caller to at least
 * `N / OUTPUT_TOKENS_PER_SECOND` seconds of wall clock. If the timeout is
 * shorter than that, a request that is *working perfectly* still fails — and it
 * fails as a timeout, which reads as a provider problem rather than a
 * misconfiguration.
 *
 * That is exactly what took down Loadout's re-map on 2026-07-28: `max_tokens`
 * up to 16,384 (≈ 134 s of generation) against a 12 s attempt. Every attempt
 * died at 12 s, the SDK silently retried (see `getDefaultClient`), and the
 * Lambda was killed at 29 s before any error could be thrown — no exception, no
 * 503, no log line.
 *
 * **Set `max_tokens` at or below this value.** Then hitting the ceiling raises a
 * clean `ai_response_truncated` (422, actionable) instead of a timeout, which is
 * strictly the better failure: it costs less wall clock and it names its cause.
 *
 * ⚠ `tokensPerSecond` defaults to the HAIKU-class measurement. Opus-class
 * surfaces (the equipment scan, Snap AI photo, recipe extraction) generate
 * slower, so taking the default there would hand out a ceiling the attempt
 * cannot receive — reintroducing this exact bug while looking measured. Pass a
 * measured rate for those, or do not use this function for them.
 */
export function maxTokensForBudget(
  timeoutMs: number,
  tokensPerSecond: number = OUTPUT_TOKENS_PER_SECOND,
): number {
  const generationMs = timeoutMs - PREFILL_ALLOWANCE_MS;
  if (generationMs <= 0) return 0;
  return Math.floor((generationMs / 1000) * tokensPerSecond);
}

/**
 * The route timeout every AI handler on the coreAPI shares (`infra/api.ts`).
 *
 * Exported so the budget arithmetic is asserted against a value rather than a
 * literal repeated in a comment. ⚠ It is a MIRROR, not the source — SST owns the
 * real setting. `aiBudget.test.ts` fails if the two drift.
 */
export const ROUTE_TIMEOUT_MS = 29_000;

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
 *
 * ## ⚠ `maxRetries: 0` is load-bearing. Do not remove it.
 *
 * The Anthropic SDK retries internally, and its default is **2** — verified by
 * construction, not assumed. Left unset, every timeout budget in this file is
 * silently wrong by 3×: one `createWithRetry` call becomes
 * `3 attempts × 12 s = 36 s` plus backoff, and `createWithRetry` then retries
 * *that*, for a ~72 s worst case against a 29 s Lambda.
 *
 * The failure mode is worse than slowness. The Lambda is killed mid-attempt, so
 * the code never reaches its own `throw`: no `AiUnavailableError`, no 503, no
 * Sentry exception, no log line — just an execution that stops. That is exactly
 * how Loadout's re-map failed on 2026-07-28, and it is why it took a CloudWatch
 * dig rather than an error report to find.
 *
 * Retries belong to `createWithRetry`, which is visible, bounded and tested.
 * Two retry layers stacked without either knowing about the other is not
 * resilience — it is an unbounded budget.
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
 * ONE attempt at a raised timeout, instead of two short ones.
 *
 * Built for spec-21's equipment scan (T-E1.6) and deliberately general, because
 * the re-map may want it later: Brad kept `createWithRetry` there on 2026-07-27
 * with the explicit note that this variant gets built here and the decision can
 * be revisited once it exists.
 *
 * ## Why the retry is wrong for a slow vision call
 *
 * `createWithRetry`'s budget is `2 × CLIENT_TIMEOUT_MS` = 24 s plus
 * auth/entitlement/ceiling/usage-log overhead, against a hard **30 s** API Gateway
 * HTTP-API integration ceiling. That works when the call is fast: the re-map is
 * 2.6 s p50 / 3.8 s max, so a first-attempt timeout is a real anomaly and paying
 * for a second attempt is a good trade.
 *
 * E1 measured the equipment scan at **mean 10.1 s / max 12.27 s** — the max
 * already over its own 12 s per-attempt budget, on 7 stock photos, which are easy
 * mode. There, a timeout is not an anomaly but the expected tail, and retrying it
 * converts a slow request into a failed one *and* doubles the $0.0272 unit cost.
 * A single long attempt spends the same wall-clock on actually finishing.
 *
 * ## ⚠ It DOES retry a throttle, inside the same deadline
 *
 * "Single attempt" is about not paying for a second full-length GENERATION, not
 * about refusing to resend a request the provider never started.
 *
 * This distinction was missing and it mattered: `getDefaultClient` now sets
 * `maxRetries: 0` (the SDK's hidden retries were tripling every timeout budget),
 * and the SDK's retry policy covered 408/409/429. `createWithRetry` inherited
 * that via `isRetryable`; this function did not, because it never consulted it.
 * The result would have been a NET REGRESSION on exactly the two surfaces the
 * change was meant to fix — a routine Bedrock `ThrottlingException` on a
 * cross-region on-demand profile going from "retried with backoff, usually fine"
 * to an immediate 503 that also burns one of the caller's daily allowances.
 *
 * A throttle fails in milliseconds, so the resend costs nothing measurable. It
 * is bounded four ways:
 *
 *   1. Only a retryable status.
 *   2. Only if the first failure returned inside {@link PREFILL_ALLOWANCE_MS} —
 *      i.e. before generation could have begun. ⚠ This was "half the budget"
 *      and that was too loose: at 50 % elapsed the images or prompt have already
 *      been accepted and BILLED, so the resend doubles the unit cost, which is
 *      the doubling this function's own rationale says it exists to avoid.
 *      Prefill is the honest proxy for "the provider never started".
 *   3. The resend inherits only the time that is LEFT, minus the backoff.
 *   4. `max_tokens` is re-clamped to what that remaining time can receive.
 *      ⚠ Reusing `params` verbatim reintroduced, inside the resend, the exact
 *      ceiling-versus-deadline mismatch this whole module exists to prevent: a
 *      request carrying a ceiling sized for the FULL budget, running against a
 *      shorter one, which times out on success. Clamping only ever lowers it.
 *
 * The backoff matters as much as the bound. The SDK retry being replaced honoured
 * `retry-after`; a zero-delay resend into a live `ThrottlingException` is the
 * single least likely request to succeed, so "we kept the retry" would have been
 * true on paper and false in effect.
 *
 * ## Failure mapping
 *
 * Any surviving failure is `AiUnavailableError` → 503.
 */
export async function createSingleAttempt(
  client: MinimalBedrockClient,
  params: MessagesCreateParams,
  timeoutMs: number,
  deps: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<MessagesCreateResponse> {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const startedAt = now();
  try {
    // Passed per-request rather than relying on the client default, which
    // `getDefaultClient()` fixes at CLIENT_TIMEOUT_MS for the retrying callers.
    return await client.messages.create(params, { timeout: timeoutMs });
  } catch (error) {
    if (!isRetryable(error) || now() - startedAt >= PREFILL_ALLOWANCE_MS) {
      throw new AiUnavailableError(
        `ai_single_attempt_failed: ${describeError(error)}`,
      );
    }

    await sleep(retryAfterMs(error) ?? DEFAULT_RETRY_BACKOFF_MS);

    const remaining = timeoutMs - (now() - startedAt);
    if (remaining <= PREFILL_ALLOWANCE_MS) {
      throw new AiUnavailableError(
        `ai_single_attempt_failed: ${describeError(error)}`,
      );
    }

    try {
      return await client.messages.create(
        {
          ...params,
          max_tokens: Math.min(
            params.max_tokens,
            maxTokensForBudget(remaining),
          ),
        },
        { timeout: remaining },
      );
    } catch (retryError) {
      throw new AiUnavailableError(
        `ai_single_attempt_failed_after_retry: ${describeError(retryError)}`,
      );
    }
  }
}

/** Pause before a resend when the provider did not tell us how long to wait. */
export const DEFAULT_RETRY_BACKOFF_MS = 400;

/**
 * `retry-after-ms` / `retry-after` from a provider error, when present.
 *
 * A throttle carries a cooldown and the SDK retry being replaced honoured it.
 * Ignoring it turns "we kept the retry" into a claim that is true in structure
 * and false in effect.
 */
export function retryAfterMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const headers = (error as { headers?: unknown }).headers;
  if (typeof headers !== "object" || headers === null) return undefined;
  const read = (key: string): string | undefined => {
    const bag = headers as Record<string, unknown> & {
      get?: (k: string) => string | null;
    };
    const viaGet = typeof bag.get === "function" ? bag.get(key) : undefined;
    const raw = viaGet ?? bag[key];
    return typeof raw === "string" ? raw : undefined;
  };
  const ms = Number(read("retry-after-ms"));
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const seconds = Number(read("retry-after"));
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return undefined;
}

/**
 * Retryable = the provider might succeed if asked again: a 5xx, a throttle, a
 * timeout, or a network-shaped error. Anthropic SDK errors carry a numeric
 * `.status` on 4xx/5xx; AbortError / network errors don't carry `.status` at
 * all, and we treat the absence of a definitive client error as retryable too —
 * a malformed-request 4xx wouldn't normally reach here since we control the
 * request shape.
 *
 * ## ⚠ 408/409/429 are here because `maxRetries: 0` removed the SDK's own retry
 *
 * The Anthropic SDK's internal `shouldRetry` covered **408, 409, 429 and ≥500**
 * and honoured `retry-after`. This predicate only covered `>= 500`, so while the
 * SDK was quietly retrying underneath it the gap did not show. Turning the SDK's
 * retries off (see `getDefaultClient` — they were tripling every timeout budget)
 * would have exposed it: **429 is < 500**, so a Bedrock `ThrottlingException` —
 * routine on a cross-region on-demand inference profile under load — would have
 * gone from "retried with backoff, usually fine" to "fails on the first
 * attempt". Removing a hidden retry layer must not silently remove the retry
 * BEHAVIOUR with it; this is the visible layer inheriting the responsibility.
 *
 * 409 is included for parity with the SDK rather than because Bedrock is known
 * to emit it.
 */
export function isRetryable(error: unknown): boolean {
  const status = extractStatus(error);
  if (status === undefined) return true; // network/timeout/unknown
  if (status === 408 || status === 409 || status === 429) return true;
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
