# MARKETING-PLANS — smoke test (Sprint 1)

Covers WP1, WP2 and WP10 as shipped in PR 1. Sprint 2's checks (WP3–WP7) get
their own section when that PR lands.

Run on **staging**, with Stripe in **test mode**. Nothing here needs the
production account.

## Preconditions — Brad, before any of this

1. Apply both migrations on staging, in this order (they are additive and safe
   to apply ahead of the deploy):
   - `20260905140000_founding_checkout_sessions.sql`
2. In Stripe, confirm the four one-off GBP Prices carry these **lookup keys**
   in **both** test and live mode — there is nothing to set per stage, because
   a lookup key is the same in both:

   | Lookup key                  | Amount | Term                |
   | --------------------------- | ------ | ------------------- |
   | `founding_premium_6m`       | £30    | Premium, 6 months   |
   | `founding_premium_12m`      | £60    | Premium, 12 months  |
   | `founding_premium_plus_6m`  | £50    | Premium+, 6 months  |
   | `founding_premium_plus_12m` | £100   | Premium+, 12 months |

   The amounts are checked at runtime, so a Price whose figure or currency does
   not match this table is refused rather than used.
   ⚠ Do **not** enable Adaptive Pricing on the account: the Session is created
   with a GBP Price and a converted currency would make the recorded amount and
   the bank disagree.

3. Add `checkout.session.completed` and `checkout.session.expired` to the
   staging Stripe webhook endpoint's event list. Without them nothing grants.
4. Set **both** Turnstile values on staging — `TURNSTILE_SECRET` (backend) and
   `VITE_TURNSTILE_SITE_KEY` (web build). `/founding/checkout` REQUIRES a real
   challenge, unlike the lead forms, because a hold there takes a place out of a
   capped pool for free. Setting only one of the pair breaks every checkout on
   that stage while the lead forms keep working, so the failure is invisible
   until somebody tries to buy.
5. Deploy staging.

## (a) The offer page sells four terms

Visit `/founding`. Expect four buttons — Premium 6/12 months, Premium+ 6/12 —
each showing its price, and a live "n of 200 founding places taken" line.

Copy is still `PLACEHOLDER` until `LANDING_PAGE.md` lands. That is expected;
check the mechanics, not the words.

## (b) A purchase, end to end

1. Choose **Premium · 6 months**, enter a fresh address, continue.
2. Stripe Checkout opens. Confirm: the email is **pre-filled and not editable**,
   the amount is £30, and a terms tick box is required.
3. Pay with `4242 4242 4242 4242`, any future expiry, any CVC.
4. You land on `/founding/thanks?session_id=…`. It shows "finishing up" and then
   the paid state — a second or two, while the webhook lands.
5. The address shown is **masked** (`bu•••@…`). It must never be whole.
6. In `/admin → Access grants`: a new grant for that address, tier `premium`,
   6 months, contribution £30, method `stripe_checkout`, reference the Stripe
   `pi_…` id, status **pending**.
7. The invite email arrives.
8. Sign up in the app with that same address and confirm the email. The app
   shows Premium active until roughly six months out.

## (c) The seat hold

1. Note the count on `/founding`.
2. Start a checkout and **stop** at Stripe's page without paying.
3. Reload `/founding` (wait ~30s for the cache). The count has gone **up by
   one** even though no grant exists.
4. Wait 30 minutes, or expire the session from the Stripe dashboard. The count
   drops back.

The hold is what stops the last place being sold twice while two people are
both on Stripe's page.

## (c2) Abandon and come back

Start a checkout, then hit **back** on Stripe's page (you land on
`/founding?cancelled=1`). Pick a plan again and continue. Expect to be returned
to the **same** Stripe page, not refused — Stripe does not expire a cancelled
Session, so the hold is still live and a refusal would lock you out for half an
hour.

## (d) Idempotency

In the Stripe dashboard, **resend** the `checkout.session.completed` event for
the purchase from (b). Expect: still exactly one grant, no second invite email,
no duplicate `purchase` row in `analytics_events`.

## (e) A refund revokes access

Refund the payment from (b) **in full** in the Stripe dashboard. Expect: the
grant shows revoked with reason `refund ch_…`, the checkout row reads
`refunded`, and the account loses the tier.

Then check a **partial** refund on a second purchase does **not** revoke — it
logs `[stripe:alert] … founding_checkout.partial_refund` and leaves access
alone, for Brad to decide.

## (f) The close date

Temporarily set the device clock past 30 September 2026, or simply re-read the
code path: `/founding` shows the closed state, the plan buttons are gone, and
`POST /founding/checkout` answers **410**. Both sides enforce it; the server is
the one that matters.

## (g) Attribution reaches the row

Visit `/meta?ref=<CODE>` first, then buy. Expect the `founding_checkout_sessions`
row to carry `campaign_slug = 'meta'` and `referral_code = '<CODE>'`, and the
`purchase` event in `analytics_events` to carry the same two.

## (h) Meta events

With consent granted, in the browser's network tab: `InitiateCheckout` fires
when you are sent to Stripe, `Purchase` fires on the thanks page. Both carry an
`eventID`, and the `Purchase` id **matches** the `event_id` on the server's
`purchase` row — that is what stops one sale being counted twice.

With consent **withheld**, neither fires and nothing is forwarded to Meta.

## (i) A store click carries its channel (WP1 + WP2)

Visit `/meta` and tap a store button. Expect one `analytics_events` row,
`event_name = 'store_click'`, with `properties.campaign = 'meta'`. Tap the same
button from `/` and expect a row with **no** `campaign` property.

Confirm `campaign` is absent from anything forwarded to Meta.

## (u) The prices resolve against the sandbox

With `STRIPE_SECRET_KEY` pointing at the **test-mode** account, load `/founding`
and start one checkout. Expect it to succeed with no price configuration of any
kind, and the CloudWatch log for that invocation to show the four resolved
`price_…` ids (one `prices.list` call, then nothing on subsequent checkouts —
the set is memoised per container).

Then check the guard: in the Stripe dashboard, move `founding_premium_6m` to a
Price with a different amount. The next checkout must answer **503**
`founding_prices_unavailable` and log which key mismatched — not sell at the
new figure. Put it back afterwards.

## (j) The needs-review path — optional, worth doing once

Buy with an address that already holds a live App Store subscription. Expect:
the money is taken, **no** grant, an `admin_audit_log` row
`founding_checkout.needs_review`, an email to the admin address, and a
`[stripe:alert]` line. Stripe must **not** retry.

This is the one case the webhook deliberately refuses to decide.
