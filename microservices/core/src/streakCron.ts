import { streakCron } from "./application/streaks/cron";
import { StreakRepository } from "./application/repositories/streakRepository";
import { StreakNotificationDispatcher } from "./application/streaks/notifier";

/**
 * Nightly streak sweep — scheduled at 02:00 UTC via `sst.aws.Cron` in
 * infra/api.ts (06-progress-goals, Phase 06.2; cross-cuts § 3.4).
 *
 * Detects streaks that fell behind their most-recently-completed user-local
 * period and either spends a freeze token (quiet recovery) or breaks the
 * streak. Emits one structured summary log line per run.
 *
 * `new Date()` is read here (the impure edge); the engine + cron logic take an
 * injected clock so they stay deterministic under test.
 */
export async function handler(): Promise<{
  swept: number;
  upToDate: number;
  frozen: number;
  broken: number;
}> {
  const summary = await streakCron({
    data: new StreakRepository(),
    notifier: new StreakNotificationDispatcher(),
    now: new Date(),
  });

  console.log(`[streak-cron:summary] ${JSON.stringify(summary)}`);
  return summary;
}
