import { captureFatal, initSentry, wrapLambda } from "./shared/sentry";
import { accountPurgeCron } from "./application/account/purge/accountPurgeCron";
import { AccountRepository } from "./application/account/accountRepository";
import { cancelStripeSubscriptions } from "./application/account/cancelUserStripeSubscriptions";
import { deleteAuthUserWithRetry } from "./application/account/supabaseAdminClient";
import { deleteUserAvatar } from "./application/account/deleteUserAvatar";
import { aiJobMaintenanceSweep } from "./application/jobs/aiJobMaintenanceSweep";
import { AiJobRepository } from "./application/jobs/aiJobRepository";
import { dataRetentionSweep } from "./application/retention/dataRetentionSweep";
import { DataRetentionRepository } from "./application/retention/dataRetentionRepository";

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

  // Nightly data-retention sweep — the mechanism behind the 12-month retention
  // promise in the published privacy policy. Same rationale for riding this
  // schedule as job maintenance above (the cadence is already right, and a new
  // scheduled function costs account Lambda concurrency shared with two sibling
  // products), and the same isolation: its own try/catch AFTER the
  // compliance-critical account purge, so it can neither delay nor fail it.
  //
  // Deleting nothing on a given night is not an error — it means no row aged
  // past the window since the last run.
  try {
    const retentionSummary = await dataRetentionSweep({
      repo: new DataRetentionRepository(),
      now,
    });
    console.log(`[data-retention:summary] ${JSON.stringify(retentionSummary)}`);
  } catch (err) {
    // ⚠ Swallowed so it can never fail the account purge — but NOT silent.
    //
    // The privacy policy now states that records older than 12 months "are
    // deleted automatically each night". Because this catch does not rethrow,
    // the Lambda's `Errors` metric stays at zero, so
    // `cron-errors-account-purge-sweep` (infra/monitoring.ts) never fires and
    // the dead-man's-switch alarm only detects non-INVOCATION, not a failing
    // sub-sweep. Without this capture the sweep could be broken from night one
    // while looking perfectly wired up — which is the exact failure mode this
    // whole change exists to eliminate, reintroduced one layer up.
    //
    // `aiJobMaintenanceSweep` above does not do this, and that asymmetry is
    // deliberate: a stuck job row is an annoyance, a dead retention sweep makes
    // a published legal claim false.
    console.error("[data-retention] sweep threw unexpectedly:", err);
    captureFatal(err, { sweep: "data-retention" });
  }

  return summary;
}

// Initialise Sentry (no-op without SENTRY_DSN) and wrap so thrown errors are
// captured + flushed to Sentry before the Lambda container freezes.
initSentry();
export const handler = wrapLambda(baseHandler);
