import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createWithRetry,
  isRetryable,
  extractStatus,
  AiUnavailableError,
  type MessagesCreateParams,
} from "../aiBedrockClient";

/**
 * `createWithRetry` is the ONLY place a Bedrock failure gets logged.
 *
 * Every AI handler catches `AiUnavailableError` and RETURNS a 503 body, so the
 * throw never reaches `coreErrorHandler` (which only logs uncaught errors).
 * Before this logging existed, Haiku 4.5 being ungranted in the production
 * account produced 30 days of 503s with **zero log lines anywhere** — the
 * `AccessDeniedException` detail was captured into a string and discarded, and
 * mobile relabelled the 503 as "try rephrasing".
 *
 * These tests exist so that regression cannot recur silently: if the log call is
 * removed, they fail.
 */

const PARAMS: MessagesCreateParams = {
  model: "eu.anthropic.test-model-v1:0",
  max_tokens: 10,
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [{ name: "t", input_schema: {} }],
  tool_choice: { type: "tool", name: "t" },
};

const OK_RESPONSE = {
  content: [{ type: "tool_use" as const, name: "t", input: {} }],
  stop_reason: "tool_use",
};

/** An Anthropic SDK-shaped error: numeric `status`, named constructor. */
function providerError(
  status: number | undefined,
  name: string,
  message = "x",
) {
  const e = Object.assign(new Error(message), { name });
  if (status !== undefined) Object.assign(e, { status });
  return e;
}

function fakeClient(create: ReturnType<typeof vi.fn>) {
  return { messages: { create } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWithRetry — success paths", () => {
  it("returns the first response and does not retry or log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockResolvedValue(OK_RESPONSE);

    await expect(createWithRetry(fakeClient(create), PARAMS)).resolves.toBe(
      OK_RESPONSE,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it("retries once on a 5xx and succeeds without logging a failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi
      .fn()
      .mockRejectedValueOnce(providerError(503, "InternalServerError"))
      .mockResolvedValueOnce(OK_RESPONSE);

    await expect(createWithRetry(fakeClient(create), PARAMS)).resolves.toBe(
      OK_RESPONSE,
    );
    expect(create).toHaveBeenCalledTimes(2);
    // A recovered blip is not an incident — logging it would be noise.
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("createWithRetry — the AccessDenied case that went undetected", () => {
  // The literal production failure: Bedrock returns 403 for an unsubscribed
  // model. 403 is not retryable, so this is the FIRST-attempt throw path.
  const accessDenied = providerError(
    403,
    "AccessDeniedException",
    "Model access is denied ... AWS Marketplace subscription for this model cannot be completed at this time.",
  );

  it("logs the model id, status and provider message, then throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(accessDenied);

    await expect(
      createWithRetry(fakeClient(create), PARAMS),
    ).rejects.toBeInstanceOf(AiUnavailableError);

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = String(spy.mock.calls[0][0]);
    // Which model — the first question when four are configured and two share
    // an id.
    expect(logged).toContain("eu.anthropic.test-model-v1:0");
    expect(logged).toContain("status=403");
    expect(logged).toContain("AccessDeniedException");
    // The provider's own wording is the actionable part; it must survive.
    expect(logged).toContain("Marketplace");
  });

  it("does NOT retry a 403 — one wasted call, not two", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(accessDenied);

    await expect(createWithRetry(fakeClient(create), PARAMS)).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("createWithRetry — retry-exhausted path", () => {
  it("logs with an after-retry marker when both attempts fail", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi
      .fn()
      .mockRejectedValue(providerError(500, "InternalServerError", "upstream"));

    await expect(
      createWithRetry(fakeClient(create), PARAMS),
    ).rejects.toBeInstanceOf(AiUnavailableError);

    expect(create).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = String(spy.mock.calls[0][0]);
    // Distinguishes "provider is flaky" from "provider rejected us outright" —
    // different responses, so the log must say which.
    expect(logged).toContain("after retry");
  });

  it("logs a timeout/network error (no status) as status=none", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // No `.status` ⇒ treated as retryable, so this is the after-retry path.
    const create = vi.fn().mockRejectedValue(new Error("socket hang up"));

    await expect(createWithRetry(fakeClient(create), PARAMS)).rejects.toThrow();
    const logged = String(spy.mock.calls[0][0]);
    expect(logged).toContain("status=none");
    expect(logged).toContain("socket hang up");
  });
});

describe("isRetryable / extractStatus", () => {
  it("retries 5xx and unknown-shaped errors, never a 4xx", () => {
    expect(isRetryable(providerError(500, "E"))).toBe(true);
    expect(isRetryable(providerError(503, "E"))).toBe(true);
    // The whole reason the AccessDenied case failed fast (~400ms) rather than
    // after two 12s attempts — which is how we identified it from latency alone.
    expect(isRetryable(providerError(403, "AccessDeniedException"))).toBe(
      false,
    );
    expect(isRetryable(providerError(400, "ValidationException"))).toBe(false);
    expect(isRetryable(new Error("timeout"))).toBe(true);
  });

  it("extracts only numeric statuses", () => {
    expect(extractStatus(providerError(429, "E"))).toBe(429);
    expect(extractStatus(new Error("x"))).toBeUndefined();
    expect(extractStatus({ status: "503" })).toBeUndefined();
    expect(extractStatus(null)).toBeUndefined();
  });
});
