import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSingleAttempt,
  createWithRetry,
  isRetryable,
  extractStatus,
  AiUnavailableError,
  CLIENT_TIMEOUT_MS,
  getDefaultClient,
  maxTokensForBudget,
  OUTPUT_TOKENS_PER_SECOND,
  PREFILL_ALLOWANCE_MS,
  resetDefaultClientForTests,
  type MessagesCreateParams,
  type MessagesCreateResponse,
  type MinimalBedrockClient,
} from "../aiBedrockClient";

const PARAMS: MessagesCreateParams = {
  model: "eu.anthropic.claude-opus-4-6-v1",
  max_tokens: 1024,
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [{ name: "t", input_schema: {} }],
  tool_choice: { type: "tool", name: "t" },
};

const OK: MessagesCreateResponse = {
  content: [{ type: "tool_use", name: "t", input: { ok: true } }],
  stop_reason: "tool_use",
};

function client(
  create: MinimalBedrockClient["messages"]["create"],
): MinimalBedrockClient {
  return { messages: { create } };
}

function statusError(status: number): Error & { status: number } {
  return Object.assign(new Error(`http ${status}`), { status });
}

describe("createSingleAttempt (spec-21 T-E1.6)", () => {
  it("returns the response on success", async () => {
    const create = vi.fn(async () => OK);
    await expect(
      createSingleAttempt(client(create), PARAMS, 20_000),
    ).resolves.toBe(OK);
  });

  it("passes the caller's timeout through, NOT the module default", async () => {
    // The whole point of this function is a longer per-attempt budget than the
    // retrying path gets, and `getDefaultClient()` fixes the client-level default
    // at CLIENT_TIMEOUT_MS — so if the per-request override were dropped, the
    // scan would silently run on a 12s budget its own eval already exceeds.
    const create = vi.fn(async () => OK);
    await createSingleAttempt(client(create), PARAMS, 20_000);

    expect(create).toHaveBeenCalledWith(PARAMS, { timeout: 20_000 });
    expect(create).not.toHaveBeenCalledWith(PARAMS, {
      timeout: CLIENT_TIMEOUT_MS,
    });
  });

  it("makes exactly ONE attempt — it must not retry", async () => {
    const create = vi.fn(async () => {
      throw statusError(503);
    });

    await expect(
      createSingleAttempt(client(create), PARAMS, 20_000),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    // A 503 is exactly the shape `createWithRetry` DOES retry, so this pins the
    // difference between the two rather than just "it throws".
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("wraps a retryable-shaped failure as AiUnavailableError", async () => {
    const create = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    await expect(
      createSingleAttempt(client(create), PARAMS, 20_000),
    ).rejects.toThrow(/ai_single_attempt_failed: socket hang up/);
  });

  it("wraps a 4xx as AiUnavailableError too — there is no retry split to make", async () => {
    const create = vi.fn(async () => {
      throw statusError(403);
    });

    await expect(
      createSingleAttempt(client(create), PARAMS, 20_000),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("describes a non-Error throw rather than losing it", async () => {
    const create = vi.fn(async () => {
      throw "plain string";
    });

    await expect(
      createSingleAttempt(client(create), PARAMS, 20_000),
    ).rejects.toThrow(/ai_single_attempt_failed: plain string/);
  });

  it("honours a different timeout value", async () => {
    const create = vi.fn(async () => OK);
    await createSingleAttempt(client(create), PARAMS, 7_000);
    expect(create).toHaveBeenCalledWith(PARAMS, { timeout: 7_000 });
  });
});

describe("createWithRetry (contrast — the retrying path is unchanged)", () => {
  it("retries once on a 5xx and succeeds", async () => {
    let calls = 0;
    const create = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw statusError(500);
      return OK;
    });

    await expect(createWithRetry(client(create), PARAMS)).resolves.toBe(OK);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx", async () => {
    const create = vi.fn(async () => {
      throw statusError(400);
    });

    await expect(createWithRetry(client(create), PARAMS)).rejects.toThrow(
      /ai_estimation_failed:/,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("gives up after the second failure", async () => {
    const create = vi.fn(async () => {
      throw statusError(503);
    });

    await expect(createWithRetry(client(create), PARAMS)).rejects.toThrow(
      /ai_estimation_failed_after_retry:/,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("isRetryable / extractStatus", () => {
  it("treats a missing status as retryable (network/timeout)", () => {
    expect(isRetryable(new Error("aborted"))).toBe(true);
    expect(extractStatus(new Error("aborted"))).toBeUndefined();
  });

  it("retries 5xx, throttles and the SDK's other transient statuses", () => {
    // ⚠ This assertion used to read `isRetryable(429) === false`, and it was
    // wrong the whole time — it was just invisible, because the SDK was
    // retrying 429 underneath this layer with `maxRetries: 2`. Turning those off
    // (they were tripling every timeout budget) would have converted a routine
    // Bedrock `ThrottlingException` into a first-attempt failure across every AI
    // surface. Removing a hidden retry must not remove the retry BEHAVIOUR.
    expect(isRetryable(statusError(500))).toBe(true);
    expect(isRetryable(statusError(503))).toBe(true);
    expect(isRetryable(statusError(429))).toBe(true);
    expect(isRetryable(statusError(408))).toBe(true);
    expect(isRetryable(statusError(409))).toBe(true);
  });

  it("does NOT retry a genuine client error", () => {
    // The other half: a 400/403 fails identically however many times it is sent,
    // and retrying it just spends the route budget twice.
    expect(isRetryable(statusError(400))).toBe(false);
    expect(isRetryable(statusError(403))).toBe(false);
    expect(isRetryable(statusError(404))).toBe(false);
    expect(isRetryable(statusError(422))).toBe(false);
  });

  it("ignores a non-numeric status", () => {
    expect(extractStatus({ status: "500" })).toBeUndefined();
    expect(isRetryable({ status: "500" })).toBe(true);
  });

  it("handles a null/primitive throw", () => {
    expect(extractStatus(null)).toBeUndefined();
    expect(extractStatus("boom")).toBeUndefined();
  });
});

describe("getDefaultClient — the SDK's own retries", () => {
  beforeEach(() => resetDefaultClientForTests());
  afterEach(() => resetDefaultClientForTests());

  it("disables them, because two stacked retry layers is an unbounded budget", () => {
    // ⚠ THE BUG THIS FILE NOW GUARDS. The Anthropic SDK defaults `maxRetries` to
    // 2 — verified against the installed package, not assumed. Left unset, one
    // `createWithRetry` call is 3 attempts x 12 s = 36 s, and `createWithRetry`
    // retries THAT: ~72 s worst case against a 29 s Lambda.
    //
    // The damage is not the slowness. The Lambda is killed mid-attempt, so the
    // code never reaches its own `throw` — no AiUnavailableError, no 503, no
    // Sentry exception, no log line. Loadout's re-map failed exactly this way on
    // staging 2026-07-28 and presented as a silent 29 s timeout.
    const client = getDefaultClient() as unknown as {
      maxRetries: number;
      timeout: number;
    };

    expect(client.maxRetries).toBe(0);
    expect(client.timeout).toBe(CLIENT_TIMEOUT_MS);
  });

  it("caches, so a warm Lambda does not rebuild the credential chain", () => {
    expect(getDefaultClient()).toBe(getDefaultClient());
  });
});

describe("maxTokensForBudget", () => {
  it("converts an attempt timeout into the output it can actually receive", () => {
    // Generation is serial at a bounded rate, so a timeout IS a token budget.
    expect(maxTokensForBudget(24_000)).toBe(
      Math.floor(
        ((24_000 - PREFILL_ALLOWANCE_MS) / 1000) * OUTPUT_TOKENS_PER_SECOND,
      ),
    );
  });

  it("shows why the old 12 s / 16,384-token pairing could never work", () => {
    // ~1,200 tokens against a ceiling of 16,384 — every attempt timed out while
    // the request was working correctly.
    expect(maxTokensForBudget(12_000)).toBeLessThan(2_000);
  });

  it("returns 0 rather than a negative budget when the timeout cannot even prefill", () => {
    // A negative ceiling would flow into `Math.min` and produce a nonsense
    // `max_tokens` the provider would reject with a confusing 400.
    expect(maxTokensForBudget(PREFILL_ALLOWANCE_MS)).toBe(0);
    expect(maxTokensForBudget(500)).toBe(0);
  });

  it("is rounded DOWN, so the budget is never optimistic", () => {
    expect(maxTokensForBudget(3_015)).toBe(1);
  });
});
