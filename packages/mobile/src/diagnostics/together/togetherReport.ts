import { isSentryEnabled, Sentry } from "@/lib/sentry";
import { safeTogetherCode } from "./togetherLog";

/**
 * Together connection failures as Sentry events, so a failed two-phone run
 * can be read without anyone opening a page or sharing a log (PER-60).
 *
 * One event per mode, stage and code per app run; outcomes the athlete chose
 * or the host decided (cancel, decline, full, removal) are not failures. The
 * Together log's recent entries ride along as breadcrumbs (togetherLog.ts),
 * stripped to codes, phases, counts and timings.
 */
export interface TogetherFailureReport {
  mode: "nearby" | "lan" | "online";
  stage: string;
  /** The raw native or JS error code. */
  code: string;
  /**
   * Which copy the athlete saw: `fallback` is a generic line (the lobby's
   * "Could not connect securely" or the join card's "Could not connect");
   * `specific` is copy written for that code. Worked out from the lobby copy
   * when left out.
   */
  copy?: "fallback" | "specific";
}

const NOT_FAILURES = new Set([
  "cancelled",
  "declined",
  "full",
  "LOBBY_FULL",
  "removed-from-session",
  "signed-out",
  "own-invitation",
]);
const reported = new Set<string>();

export function reportTogetherFailure(failure: TogetherFailureReport): void {
  if (!isSentryEnabled()) return;
  const code = safeTogetherCode(failure.code);
  if (NOT_FAILURES.has(code)) return;
  const stage = safeTogetherCode(failure.stage);
  const key = `${failure.mode}|${stage}|${code}`;
  if (reported.has(key)) return;
  reported.add(key);
  try {
    const copy = failure.copy ?? lobbyCopyBucket(code, failure.mode);
    Sentry.captureMessage(`Together ${stage} failed: ${code}`, {
      level: "warning",
      fingerprint: ["together-failure", failure.mode, stage, code],
      tags: {
        "together.mode": failure.mode,
        "together.stage": stage,
        "together.code": code,
        "together.copy": copy,
      },
    });
  } catch {
    /* Reporting can never break Together. */
  }
}

/**
 * Whether the lobby copy for this code is the generic line. The presenter is
 * loaded only when a failure is reported, so composing the lobby never pulls
 * in the UI graph.
 */
function lobbyCopyBucket(
  code: string,
  mode: TogetherFailureReport["mode"],
): "fallback" | "specific" {
  const { TOGETHER_FALLBACK_COPY, togetherErrorCopy } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, see above
    require("@/ui/presenters/TogetherLobbyPresenter") as typeof import("@/ui/presenters/TogetherLobbyPresenter");
  return togetherErrorCopy(code, mode === "lan" ? "lan" : "nearby") ===
    TOGETHER_FALLBACK_COPY
    ? "fallback"
    : "specific";
}

/** Tests only: forget what this run has already reported. */
export function resetTogetherReports(): void {
  reported.clear();
}
