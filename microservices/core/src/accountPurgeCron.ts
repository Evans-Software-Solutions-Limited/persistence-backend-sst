import { initSentry, wrapLambda } from "./shared/sentry";
import { accountPurgeCron } from "./application/account/purge/accountPurgeCron";
import { AccountRepository } from "./application/account/accountRepository";
import { cancelStripeSubscriptions } from "./application/account/cancelUserStripeSubscriptions";
import { deleteAuthUserWithRetry } from "./application/account/supabaseAdminClient";
import { deleteUserAvatar } from "./application/account/deleteUserAvatar";
import { aiJobMaintenanceSweep } from "./application/jobs/aiJobMaintenanceSweep";
import { AiJobRepository } from "./application/jobs/aiJobRepository";

/**
 * Nightly account-purge sweep — scheduled via `sst.aws.Cron` in
 * infra/api.ts (Cluster 2a Part D/F). Completes every account whose 30-day
 * soft-delete cooling-off window has elapsed. `new Date()` is read here
 * (the impure edge); `accountPurgeCron` takes an injected clock + deps so
 * the sweep logic stays deterministic under test.
 *
 * ALSO carries the async-job spine's nightly maintenance (reap dead `running`
 * jobs, purge terminal ones past retention). It rides this schedule rather than
 * getting a sixth `sst.aws.Cron` — the cadence is already right, and a new
 * scheduled function costs account Lambda concurrency shared with two sibling
 * products. The two sweeps are independent: job maintenance runs in its own
 * try/catch AFTER the compliance-critical account purge, so it can neither
 * delay nor fail it.
 */
async function baseHandler(): Promise<{
  pending: number;
  purged: number;
  failed: number;
}> {
  const now = new Date();
  const summary = await accountPurgeCron({
    accountRepo: new AccountRepository(),
    cancelStripeSubscriptions,
    deleteAuthUser: deleteAuthUserWithRetry,
    deleteAvatar: deleteUserAvatar,
    now,
  });
  console.log(`[account-purge-cron:summary] ${JSON.stringify(summary)}`);

  // Separate summary line, separate guard. The account purge's return value is
  // this Lambda's contract (and what its alarm watches), so job maintenance
  // must not be able to change or fail it — a stuck job row is an annoyance,
  // an unpurged account is a 5.1.1(v) obligation with a 30-day clock.
  try {
    const jobSummary = await aiJobMaintenanceSweep({
      repo: new AiJobRepository(),
      now,
    });
    console.log(`[ai-job-maintenance:summary] ${JSON.stringify(jobSummary)}`);
  } catch (err) {
    console.error("[ai-job-maintenance] sweep threw unexpectedly:", err);
  }

  return summary;
}

// Initialise Sentry (no-op without SENTRY_DSN) and wrap so thrown errors are
// captured + flushed to Sentry before the Lambda container freezes.
initSentry();
export const handler = wrapLambda(baseHandler);
