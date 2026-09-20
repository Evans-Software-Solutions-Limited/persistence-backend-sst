# Founding membership changes and refunds

Approved scope: Brad's request on 20 September 2026, including his correction that refunds automatically remove access.

## Behaviour

- Admins can change an active or pending grant's tier without collecting another payment. Keep the grant, original payment details, duration and expiry. A pending grant applies its new tier on first sign-in.
- Founding changes stay within the existing offer pool. Complimentary changes stay within the same account audience. Do not overwrite store, voucher, expired, revoked or protected-account access.
- A founding website purchase can be refunded from Access grants, including after access has been revoked or its account deleted. Show Stripe's original, refunded and remaining amounts. Refund the full remaining balance to the original payment method.
- The confirmation states that refunding cancels access. There is no keep-access option. An accepted refund request cancels this grant immediately, even while Stripe reports processing. A rejected request does not cancel access. A later failed/canceled refund does not silently restore access; the admin reviews it in Stripe.
- Existing full-refund webhook revocation remains in place. Partial dashboard refunds retain their existing policy; partial refunds are not added to the panel.

## Implementation

Admin-only routes, protected by the existing verified JWT admin guard:

- `POST /admin/founding-grants/:id/change-tier`: tierName and reason.
- `GET /admin/founding-grants/:id/refund`: payment amounts and current refund state. Reconciles an already-requested refund; never initiates a payment operation.
- `POST /admin/founding-grants/:id/refund`: reason. Returns Stripe state and refund ID.

Tier changes update the grant and linked subscription in one transaction with audit. A nonblocking user lock avoids deadlock with pending application and extension paths.

The new admin-only `founding_refunds` table commits one durable request per grant before calling Stripe. Requests use a stable idempotency key and recover lost responses by listing refunds for the original payment intent. The reason is immutable across retries. An unresolved request older than 23 hours requires manual Stripe review, avoiding reuse after Stripe's idempotency retention window. Rejected/failed/canceled attempts are surfaced for manual review instead of silently creating a second financial operation.

A payment must match the recorded purchase amount and currency. Status and actor/reason are audited. Cancellation always targets the original grant's linked subscription. Full-refund webhook retries can finish checkout reconciliation even after access was already revoked.

## Validation and release

Cover real Postgres transactions with PGlite: paid/pending upgrades, preserved payment/expiry, rollback on audit failure, protected accounts, one refund intent and migration access controls. Cover Stripe timeouts, replay/recovery, pending/failed responses, authenticated routes and admin confirmation UI. Inspect desktop/mobile screenshots with synthetic records.

Apply the additive migration through the normal release pipeline before using the new routes. No native app build is required. This PR does not issue any real refund, upgrade a live customer, deploy or send customer messages.

Stripe references: [create refund](https://docs.stripe.com/api/refunds/create), [refund lifecycle](https://docs.stripe.com/refunds).

## Apple Hide My Email and different purchase emails

The same session identified that automatic activation only matched the authenticated email. A purchase/invitation sent to a personal address could therefore remain pending after native Apple sign-in created a relay-email account.

The subscription/onboarding screen now offers **Claim existing access**. The signed-in user enters the purchase/invitation email and verifies a six-digit code delivered there. This attaches the existing pending grant to that account. It does not reveal Apple's underlying email, merge accounts, change login details, transfer already-active grants or create replacement access. Ordinary same-email activation continues unchanged.

Authenticated routes: `POST /founding/claims/request` (`email`) and `POST /founding/claims/verify` (`challengeId`, `code`). Proofs are account-bound, expire after ten minutes, allow five attempts, store only challenge-specific hashes and are consumed atomically with activation/referral processing. Both existing and absent purchases receive the same code email and HTTP response; availability is only disclosed after email ownership is proven. Persistent account/email limits reuse the existing verification rate-limit storage with a separate namespace. No active paid membership is replaced.

The additive `founding_claim_challenges` migration has RLS and denies direct browser roles. Proof cleanup is bounded; account deletion cascades proofs. Successful retries preserve expiry and cannot re-enable refunded access. Tests cover Apple relay ownership, bad/expired/replayed proofs, account/email mismatch, revoked/attached grants, paid-access conflicts and rollback on audit failure. The native UI adds no new native dependency; Brad controls its release/build. Apple relay email-sender registration was not inspected or changed.

Visual evidence (synthetic records/responses, actual components rendered): admin upgrade confirmation at desktop size; refund confirmation at desktop and 390px; mobile purchase-email entry, code entry and success at 390px. Screenshots saved outside the repository in the task's `founding-access-review` folder.
