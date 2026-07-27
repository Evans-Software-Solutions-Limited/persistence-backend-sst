import { describe, it, expect, vi } from "vitest";
import {
  createSingleAttempt,
  createWithRetry,
  isRetryable,
  extractStatus,
  AiUnavailableError,
  CLIENT_TIMEOUT_MS,
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

  it("treats 5xx as retryable and 4xx as not", () => {
    expect(isRetryable(statusError(500))).toBe(true);
    expect(isRetryable(statusError(429))).toBe(false);
    expect(isRetryable(statusError(403))).toBe(false);
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
