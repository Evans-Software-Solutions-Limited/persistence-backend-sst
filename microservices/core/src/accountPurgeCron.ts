import { initSentry, wrapLambda } from "./shared/sentry";
import { accountPurgeCron } from "./application/account/purge/accountPurgeCron";
import { AccountRepository } from "./application/account/accountRepository";
import { cancelStripeSubscriptions } from "./application/account/cancelUserStripeSubscriptions";
import { deleteAuthUserWithRetry } from "./application/account/supabaseAdminClient";
import { deleteUserAvatar } from "./application/account/deleteUserAvatar";

/**
 * Nightly account-purge sweep — scheduled via `sst.aws.Cron` in
 * infra/api.ts (Cluster 2a Part D/F). Completes every account whose 30-day
 * soft-delete cooling-off window has elapsed. `new Date()` is read here
 * (the impure edge); `accountPurgeCron` takes an injected clock + deps so
 * the sweep logic stays deterministic under test.
 */
async function baseHandler(): Promise<{
  pending: number;
  purged: number;
  failed: number;
}> {
  const summary = await accountPurgeCron({
    accountRepo: new AccountRepository(),
    cancelStripeSubscriptions,
    deleteAuthUser: deleteAuthUserWithRetry,
    deleteAvatar: deleteUserAvatar,
    now: new Date(),
  });
  console.log(`[account-purge-cron:summary] ${JSON.stringify(summary)}`);
  return summary;
}

// Initialise Sentry (no-op without SENTRY_DSN) and wrap so thrown errors are
// captured + flushed to Sentry before the Lambda container freezes.
initSentry();
export const handler = wrapLambda(baseHandler);
