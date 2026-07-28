import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSingleAttempt,
  createWithRetry,
  isRetryable,
  extractStatus,
  AiUnavailableError,
  CLIENT_TIMEOUT_MS,
  DEFAULT_RETRY_BACKOFF_MS,
  getDefaultClient,
  OPUS_OUTPUT_TOKENS_PER_SECOND,
  retryAfterMs,
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

/** Backoff is real time; tests must not spend it. */
const noSleep = async () => {};

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

  it("makes exactly ONE GENERATION attempt — a slow failure is not resent", async () => {
    // ⚠ This assertion used to be `toHaveBeenCalledTimes(1)` for ANY failure,
    // which was right only while the SDK retried underneath. What must not be
    // repeated is a full-length generation: a failure that consumed most of the
    // budget means the model was working, and resending it blows the deadline.
    // A failure that came back instantly is a different thing entirely — see the
    // "bounded resend" block below.
    const create = vi.fn(async () => {
      throw statusError(503);
    });
    let reads = 0;
    const slow = () => (reads++ === 0 ? 0 : 19_000);

    await expect(
      createSingleAttempt(client(create), PARAMS, 20_000, {
        now: slow,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("wraps a retryable-shaped failure as AiUnavailableError", async () => {
    const create = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    let reads = 0;
    const slow = () => (reads++ === 0 ? 0 : 19_000);

    await expect(
      createSingleAttempt(client(create), PARAMS, 20_000, {
        now: slow,
        sleep: noSleep,
      }),
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
    let reads = 0;
    const slow = () => (reads++ === 0 ? 0 : 19_000);
    const create = vi.fn(async () => {
      throw "plain string";
    });

    await expect(
      createSingleAttempt(client(create), PARAMS, 20_000, {
        now: slow,
        sleep: noSleep,
      }),
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

describe("createSingleAttempt — the bounded resend", () => {
  // ⚠ `createSingleAttempt` never consulted `isRetryable`, so when
  // `getDefaultClient` turned the SDK's own retries off, the two surfaces using
  // it (the loadout re-map and the equipment scan) lost throttle resilience
  // entirely — a net regression on exactly the surfaces the change was fixing.
  // These pin the refined contract: resend a FAST transient failure, never a
  // slow one, and never exceed the caller's deadline.

  function client(behaviour: Array<() => unknown>) {
    let call = 0;
    // Typed two-arg signature so `create.mock.calls[n][1]` carries the
    // per-request options — asserting the resend inherits only the REMAINING
    // budget is the point of this fake.
    const create = vi.fn(
      async (params: MessagesCreateParams, options?: { timeout?: number }) => {
        void params;
        void options;
        const step = behaviour[Math.min(call, behaviour.length - 1)];
        call += 1;
        return step() as MessagesCreateResponse;
      },
    );
    return { create, client: { messages: { create } } as MinimalBedrockClient };
  }

  const boom = (status?: number) => () => {
    throw status === undefined
      ? new Error("socket hang up")
      : Object.assign(new Error(`http ${status}`), { status });
  };
  const ok = () => ({ content: [], stop_reason: "end_turn" });

  it("resends a throttle that failed instantly", async () => {
    const { client: c, create } = client([boom(429), ok]);
    let t = 0;
    await createSingleAttempt(c, PARAMS, 20_000, {
      now: () => (t += 10),
      sleep: noSleep,
    });

    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does NOT resend a failure that consumed most of the budget", async () => {
    // A slow failure means generation was actually happening. Resending it is
    // how a single long attempt turns into two timeouts and blows the deadline —
    // the precise thing `createSingleAttempt` exists to avoid.
    const { client: c, create } = client([boom(503), ok]);
    let t = 0;
    // 0 ms, then 15 s elapsed against a 20 s budget: past the halfway bound.
    const clock = () => (t === 0 ? ((t = 15_000), 0) : 15_000);
    await expect(
      createSingleAttempt(c, PARAMS, 20_000, { now: clock, sleep: noSleep }),
    ).rejects.toBeInstanceOf(AiUnavailableError);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("gives the resend only the time that is LEFT", async () => {
    // Not a fresh full budget — the caller's deadline is absolute.
    const { client: c, create } = client([boom(429), ok]);
    let reads = 0;
    const clock = () => (reads++ === 0 ? 0 : 1_000);
    await createSingleAttempt(c, PARAMS, 20_000, {
      now: clock,
      sleep: noSleep,
    });

    expect(create.mock.calls[0][1]).toEqual({ timeout: 20_000 });
    expect(create.mock.calls[1][1]).toEqual({ timeout: 19_000 });
  });

  it("resends the ORIGINAL params — never a degraded request", async () => {
    // ⚠ The first version clamped `max_tokens` down to fit the shorter deadline.
    // That looked careful and re-opened the same defect one layer lower: a
    // smaller ceiling on the same work is a truncation 422 — terminal-looking,
    // for a transient cause, with the daily allowance already spent — and at the
    // boundary the clamp reached 0, which the provider rejects outright.
    const { client: c, create } = client([boom(429), ok]);
    let reads = 0;
    const clock = () => (reads++ === 0 ? 0 : 1_000);
    await createSingleAttempt(c, PARAMS, 20_000, {
      now: clock,
      sleep: noSleep,
    });

    expect(create.mock.calls[1][0]).toEqual(PARAMS);
  });

  it("does NOT resend when the time left cannot carry the original ceiling", async () => {
    // A resend that cannot do the whole job is not a retry, it is a different
    // and worse request. A ceiling sized for the full budget cannot fit a
    // shortened one, so the honest answer is to fail.
    const big = { ...PARAMS, max_tokens: maxTokensForBudget(20_000) };
    const { client: c, create } = client([boom(429), ok]);
    let reads = 0;
    const clock = () => (reads++ === 0 ? 0 : 1_000);

    await expect(
      createSingleAttempt(c, big, 20_000, { now: clock, sleep: noSleep }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("uses the CALLER's generation rate for that guard, not the Haiku default", async () => {
    // Opus is ~2.5x slower, so the default would grant a resend the deadline
    // cannot actually deliver — `maxTokensForBudget`'s docstring calls this out
    // explicitly, and `createSingleAttempt` has an Opus caller (the scan).
    const params = { ...PARAMS, max_tokens: 1_200 };
    let reads = 0;
    const clock = () => (reads++ === 0 ? 0 : 1_000);

    const haiku = client([boom(429), ok]);
    await createSingleAttempt(haiku.client, params, 20_000, {
      now: clock,
      sleep: noSleep,
    });
    expect(haiku.create).toHaveBeenCalledTimes(2);

    reads = 0;
    const opus = client([boom(429), ok]);
    await expect(
      createSingleAttempt(opus.client, params, 20_000, {
        now: clock,
        sleep: noSleep,
        tokensPerSecond: OPUS_OUTPUT_TOKENS_PER_SECOND,
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect(opus.create).toHaveBeenCalledTimes(1);
  });

  it("waits before resending, honouring retry-after when the provider sends one", async () => {
    // A zero-delay resend into a live ThrottlingException is the single least
    // likely request to succeed — "we kept the retry" would be true in structure
    // and false in effect.
    const slept: number[] = [];
    const sleep = async (ms: number) => {
      slept.push(ms);
    };
    let reads = 0;
    const clock = () => (reads++ === 0 ? 0 : 1_000);

    const throttled = client([
      () => {
        throw Object.assign(new Error("throttled"), {
          status: 429,
          headers: { "retry-after-ms": "750" },
        });
      },
      ok,
    ]);
    await createSingleAttempt(throttled.client, PARAMS, 20_000, {
      now: clock,
      sleep,
    });
    expect(slept).toEqual([750]);

    slept.length = 0;
    reads = 0;
    const bare = client([boom(429), ok]);
    await createSingleAttempt(bare.client, PARAMS, 20_000, {
      now: clock,
      sleep,
    });
    expect(slept).toEqual([DEFAULT_RETRY_BACKOFF_MS]);
  });

  it("REFUSES a retry-after longer than the deadline can spare", async () => {
    // ⚠ The sleep was unbounded and provider-controlled. `retry-after: 30`
    // against a 12 s budget slept straight through the 29 s Lambda — and a hard
    // kill skips the handler's `finally`, so no usage row is written for an
    // inference Bedrock already billed. Sleeping past your own deadline is worse
    // than not backing off at all.
    const slept: number[] = [];
    const { client: c, create } = client([
      () => {
        throw Object.assign(new Error("throttled"), {
          status: 429,
          headers: { "retry-after": "30" },
        });
      },
      ok,
    ]);
    let reads = 0;
    const clock = () => (reads++ === 0 ? 0 : 1_000);

    await expect(
      createSingleAttempt(c, PARAMS, 12_000, {
        now: clock,
        sleep: async (ms) => {
          slept.push(ms);
        },
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);

    expect(slept).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not resend a client error", async () => {
    const { client: c, create } = client([boom(400), ok]);
    let t = 0;
    await expect(
      createSingleAttempt(c, PARAMS, 20_000, {
        now: () => (t += 10),
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(AiUnavailableError);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("surfaces the SECOND failure when the resend also fails", async () => {
    const { client: c } = client([boom(429), boom(503)]);
    let t = 0;
    await expect(
      createSingleAttempt(c, PARAMS, 20_000, {
        now: () => (t += 10),
        sleep: noSleep,
      }),
    ).rejects.toThrow(/after_retry/);
  });
});

describe("retryAfterMs", () => {
  // ⚠ Both production-shaped branches were mutation survivors: deleting the
  // `Headers`-like `.get()` path, or changing the seconds conversion to `* 1`,
  // left every test green — while `Headers` is exactly what the real Anthropic
  // SDK attaches to an APIError. The mutation set had not reached this function.
  it("reads a Headers-like bag, which is what the SDK actually attaches", () => {
    const headers = {
      get: (k: string) => (k === "retry-after-ms" ? "900" : null),
    };
    expect(retryAfterMs({ headers })).toBe(900);
  });

  it("converts a retry-after in SECONDS to milliseconds", () => {
    expect(retryAfterMs({ headers: { "retry-after": "2" } })).toBe(2_000);
  });

  it("prefers the millisecond header when both are present", () => {
    expect(
      retryAfterMs({
        headers: { "retry-after-ms": "250", "retry-after": "9" },
      }),
    ).toBe(250);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["an HTTP-date", "Wed, 21 Oct 2026 07:28:00 GMT"],
    ["garbage", "soon"],
    ["negative", "-5"],
  ])(
    "falls through on %s so the caller uses its own default",
    (_label, value) => {
      // `Number("")` is 0 — finite and non-negative — so an empty header would
      // otherwise return a 0 ms backoff and restore the zero-delay resend.
      expect(
        retryAfterMs({ headers: { "retry-after-ms": value } }),
      ).toBeUndefined();
    },
  );

  it("tolerates an error with no headers at all", () => {
    expect(retryAfterMs(new Error("boom"))).toBeUndefined();
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs({ headers: "nope" })).toBeUndefined();
  });
});
