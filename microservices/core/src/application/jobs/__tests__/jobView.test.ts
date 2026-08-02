/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { STALE_AFTER_MS } from "../aiJobRepository";
import { isStaleRunning, toJobStatusView, toJobView } from "../jobView";

const NOW = new Date("2026-08-02T12:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "j1",
    kind: "test_kind",
    status: "running",
    progressDone: 4,
    progressTotal: 10,
    result: null,
    error: null,
    heartbeatAt: new Date(NOW.getTime() - 1000),
    createdAt: new Date(NOW.getTime() - 60_000),
    startedAt: new Date(NOW.getTime() - 30_000),
    finishedAt: null,
    ...overrides,
  } as any;
}

describe("isStaleRunning", () => {
  it("is false for a terminal job however old its heartbeat", () => {
    expect(
      isStaleRunning(
        row({ status: "succeeded", heartbeatAt: new Date(0) }),
        NOW,
      ),
    ).toBe(false);
  });

  it("is false for a queued job with no heartbeat yet", () => {
    expect(
      isStaleRunning(row({ status: "queued", heartbeatAt: null }), NOW),
    ).toBe(false);
  });

  it("is false while the heartbeat is fresh", () => {
    expect(isStaleRunning(row(), NOW)).toBe(false);
  });

  it("is false exactly AT the threshold — strictly older only", () => {
    expect(
      isStaleRunning(
        row({ heartbeatAt: new Date(NOW.getTime() - STALE_AFTER_MS) }),
        NOW,
      ),
    ).toBe(false);
  });

  it("is true once the heartbeat is past the threshold", () => {
    expect(
      isStaleRunning(
        row({ heartbeatAt: new Date(NOW.getTime() - STALE_AFTER_MS - 1) }),
        NOW,
      ),
    ).toBe(true);
  });

  it("treats a RUNNING job with no heartbeat as stale — that state is a schema violation", () => {
    expect(isStaleRunning(row({ heartbeatAt: null }), NOW)).toBe(true);
  });
});

describe("toJobView", () => {
  it("projects a running job with its progress", () => {
    expect(toJobView(row(), NOW)).toMatchObject({
      id: "j1",
      status: "running",
      progress: { done: 4, total: 10 },
      result: null,
      error: null,
    });
  });

  it("returns a succeeded job's result off the row — no recompute (AC-2.4)", () => {
    const view = toJobView(
      row({ status: "succeeded", result: { plan: ["a"] } }),
      NOW,
    );
    expect(view.status).toBe("succeeded");
    expect(view.result).toEqual({ plan: ["a"] });
  });

  it("AC-2.5: a dead running job reads as failed/stale, so a client never polls it forever", () => {
    const view = toJobView(
      row({ heartbeatAt: new Date(NOW.getTime() - STALE_AFTER_MS - 1) }),
      NOW,
    );
    expect(view.status).toBe("failed");
    expect(view.error).toEqual(
      expect.objectContaining({ code: "stale", retryable: false }),
    );
  });

  it("withholds a stale job's PARTIAL result — a truncated programme must not look whole", () => {
    const view = toJobView(
      row({
        heartbeatAt: new Date(NOW.getTime() - STALE_AFTER_MS - 1),
        result: { plan: ["half"] },
      }),
      NOW,
    );
    expect(view.result).toBeNull();
  });

  it("passes a structured failure through unchanged", () => {
    const error = {
      code: "ai_unavailable",
      message: "temporarily unavailable",
      retryable: true,
    };
    expect(toJobView(row({ status: "failed", error }), NOW).error).toEqual(
      error,
    );
  });
});

describe("toJobStatusView", () => {
  it("omits result entirely — the polling loop must not re-download a large payload each tick", () => {
    const view = toJobStatusView(
      row({ status: "succeeded", result: { big: "x".repeat(100) } }),
      NOW,
    );
    expect(view).not.toHaveProperty("result");
    expect(view.status).toBe("succeeded");
    expect(view.progress).toEqual({ done: 4, total: 10 });
  });

  it("still derives staleness", () => {
    const view = toJobStatusView(
      row({ heartbeatAt: new Date(NOW.getTime() - STALE_AFTER_MS - 1) }),
      NOW,
    );
    expect(view.status).toBe("failed");
  });
});
