/**
 * newIdempotencyKey — a per-attempt idempotency token for money-moving
 * backend calls (spec 17 / Phase A frontend, closes audit HIGH-1's mobile
 * follow-up).
 *
 * The backend's `POST /subscriptions` + `POST /subscriptions/:id/cancel`
 * accept an optional `idempotency_key`. When the client sends one, the
 * backend uses it as the base for every outbound Stripe call in that flow;
 * when absent it falls back to a deterministic server-side key. Sending a
 * client key gives the strongest guarantee: one user action → one token, so a
 * transport-level retry of the same submission can never create a duplicate
 * Stripe subscription / charge.
 *
 * Contract:
 *   - Generated ONCE per user action (one Subscribe press, one Cancel
 *     confirmation) and reused for that whole attempt — NOT regenerated per
 *     render or per retry. A genuinely new attempt mints a new key.
 *   - Uniqueness, not unguessability, is what matters — this is a dedup token,
 *     not a secret. We mirror the repo's existing client-id style
 *     (`Date.now()` + a short random suffix) rather than pull in a crypto/uuid
 *     dependency. Collisions are astronomically unlikely at human action rates.
 *
 * Each Apple Pay authorisation yields a single-use payment-method token, so a
 * per-attempt key never collides across distinct purchase intents.
 */
export function newIdempotencyKey(scope: string): string {
  const rand = Math.random().toString(36).slice(2, 12);
  return `${scope}-${Date.now()}-${rand}`;
}
