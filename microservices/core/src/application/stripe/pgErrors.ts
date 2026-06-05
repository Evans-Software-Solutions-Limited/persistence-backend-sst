/**
 * Shared Postgres error detectors used across the Stripe + subscription
 * code paths. Extracted from `eventHandlers/subscriptionCreated.ts` (spec
 * 17 / Phase A T-A.1.1) so the inbound webhook insert path AND the
 * outbound `POST /subscriptions` new-sub insert path share one
 * implementation of "is this the active-subscription unique-index
 * collision?".
 */

/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * postgres-js + Neon both expose the SQLSTATE on the error's `code`
 * property; Drizzle wraps with a `cause` chain, so we walk it up to a
 * bounded depth. Belt-and-braces: postgres-js sometimes drops the code
 * on the cause chain and only leaves the human-readable message on the
 * outer Error, so we also match the `user_subscriptions_active_unique`
 * constraint name literally — narrow enough that we don't mistake some
 * other duplicate-key error for the active-unique collision.
 */
export function isUniqueViolation(err: unknown): boolean {
  let cursor: unknown = err;
  for (
    let depth = 0;
    depth < 4 && cursor !== undefined && cursor !== null;
    depth += 1
  ) {
    const code = (cursor as { code?: unknown }).code;
    if (code === "23505") return true;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /user_subscriptions_active_unique/.test(message);
}
