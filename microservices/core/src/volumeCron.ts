import { initSentry, wrapLambda } from "./shared/sentry";
import { volumeCron } from "./application/progress/volumeCron";
import { VolumeRepository } from "./application/repositories/volumeRepository";

/**
 * Nightly volume aggregation sweep — scheduled at 03:00 UTC via `sst.aws.Cron`
 * in infra/api.ts (06-progress-goals, Phase 06.4). Re-materialises every
 * active user's current-week + current-month volume so Home/You reads stay
 * warm. `new Date()` is read here (impure edge); the cron logic takes an
 * injected clock for deterministic tests.
 */
async function baseHandler(): Promise<{
  users: number;
  recomputed: number;
  failed: number;
}> {
  const summary = await volumeCron({
    repo: new VolumeRepository(),
    now: new Date(),
  });
  console.log(`[volume-cron:summary] ${JSON.stringify(summary)}`);
  return summary;
}

// Initialise Sentry (no-op without SENTRY_DSN) and wrap so thrown errors are
// captured + flushed to Sentry before the Lambda container freezes.
initSentry();
export const handler = wrapLambda(baseHandler);
