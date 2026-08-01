import type { ApiError } from "@/shared/errors";
import { defaultQueryRetry, isNonRetryableClientError } from "@/providers";

/**
 * QueryClient default-retry predicate (launch fan-out reduction). Before this,
 * `retry: 1` retried EVERY failure once — including a permanent 4xx
 * (unauthorized, not-found, entitlement-denied, validation), which meant a
 * doomed request fired twice against the launch-time concurrency budget for
 * no benefit (the second attempt is exactly as wrong as the first).
 *
 * `mapHttpErrorToApiError` (adapters/api/sst-api.adapter.ts) stamps the true
 * HTTP `status` onto every `ApiError` it builds from an actual response —
 * including the codes that don't have a dedicated name (400/403/422/429 all
 * come through as `code: "server"` but keep their real `status`) — so these
 * tests exercise `status`, not just the named `code`s.
 */
describe("isNonRetryableClientError", () => {
  it("is true for a 4xx ApiError regardless of its `code`", () => {
    const cases: ApiError[] = [
      { kind: "api", code: "unauthorized", message: "no", status: 401 },
      { kind: "api", code: "not_found", message: "no", status: 404 },
      { kind: "api", code: "entitlement_denied", message: "no", status: 402 },
      // 400/403/422/429 don't have a dedicated `code` — they fall through to
      // "server" in mapHttpErrorToApiError, but keep their real status.
      { kind: "api", code: "server", message: "no", status: 400 },
      { kind: "api", code: "server", message: "no", status: 403 },
      { kind: "api", code: "server", message: "no", status: 422 },
      { kind: "api", code: "server", message: "no", status: 429 },
    ];
    for (const error of cases) {
      expect(isNonRetryableClientError(error)).toBe(true);
    }
  });

  it("is false for a 5xx ApiError", () => {
    expect(
      isNonRetryableClientError({
        kind: "api",
        code: "server",
        message: "boom",
        status: 500,
      }),
    ).toBe(false);
    expect(
      isNonRetryableClientError({
        kind: "api",
        code: "server",
        message: "boom",
        status: 503,
      }),
    ).toBe(false);
  });

  it("is false for network/timeout ApiErrors (no `status` — never reached a server)", () => {
    expect(
      isNonRetryableClientError({
        kind: "api",
        code: "network",
        message: "offline",
      }),
    ).toBe(false);
    expect(
      isNonRetryableClientError({
        kind: "api",
        code: "timeout",
        message: "slow",
      }),
    ).toBe(false);
  });

  it("is false (fails open, retryable) for a non-ApiError shape", () => {
    expect(isNonRetryableClientError(new Error("some bug"))).toBe(false);
    expect(isNonRetryableClientError("a string")).toBe(false);
    expect(isNonRetryableClientError(null)).toBe(false);
    expect(isNonRetryableClientError(undefined)).toBe(false);
    expect(
      isNonRetryableClientError({ kind: "storage", code: "not_found" }),
    ).toBe(false);
  });
});

describe("defaultQueryRetry", () => {
  const serverError: ApiError = {
    kind: "api",
    code: "server",
    message: "boom",
    status: 500,
  };
  const clientError: ApiError = {
    kind: "api",
    code: "unauthorized",
    message: "no",
    status: 401,
  };

  it("retries a 5xx/network/timeout failure exactly once", () => {
    expect(defaultQueryRetry(0, serverError)).toBe(true);
    expect(defaultQueryRetry(1, serverError)).toBe(false);
  });

  it("never retries a 4xx failure, even on the first attempt", () => {
    expect(defaultQueryRetry(0, clientError)).toBe(false);
    expect(defaultQueryRetry(1, clientError)).toBe(false);
  });
});
