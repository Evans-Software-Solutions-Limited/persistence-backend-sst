# MARKETING-PLANS — follow-ups

Things deliberately left out of Sprint 1, with why, so none of them is
rediscovered as a surprise.

## 1. Pre-flight checks the checkout route does not make

`POST /founding/checkout` refuses before payment when the pool is full, when the
address already holds a live or pending grant, and when the address already has
a hold in flight. It does **not** pre-check two other cases that
`FoundingGrantService.grant` will refuse afterwards:

- **a live App Store / Play subscription** (`active_store_subscription`) — a
  grant may not displace one (FOUNDING-OFFER D3);
- **a coach account buying a consumer tier** (`coach_demotion`).

In both, money is taken and the webhook lands in the `needs_review` path: the
session is marked `completed`, an `admin_audit_log` row is written, an ops alert
fires and Brad gets an email. Nothing is lost silently and nothing retries
forever — but he refunds or overrides by hand.

Left as-is for Sprint 1 because both need an email → profile → subscription
lookup on a public unauthenticated route, which is a user-enumeration surface
of its own (the refusal tells an anonymous caller whether an address has an
account and what it is subscribed to). Doing it properly means answering
identically for "no account" and "account with a live subscription", which is a
design question, not a line of code.

Worth revisiting if `needs_review` fires more than a couple of times.

## 1b. One seat can be double-counted for a moment

Between the grant transaction committing and `attachGrant` landing, the same
seat is counted twice — once by `countLiveInPool` (the grant row is visible)
and once by `countHeldInPool`'s settling clause (`completed`, no `grant_id`
yet). The gap spans the invite email send inside `FoundingGrantService.grant`,
so it is a Resend round trip wide.

The only effect is a false "sold out" for a concurrent buyer when the pool is
on its very last seat, for a second or so. It errs the safe way — it can never
oversell — so it is left alone rather than restructured.

## 1c. The price check is a floor, not a lock

`resolveFoundingPrice` refuses a Price whose amount or currency does not match
`FOUNDING_PRICE_LOOKUP_KEYS`, so a dashboard edit cannot silently change what
the page charges — it takes the offer offline instead, loudly.

What it does not do is notice a change made _between_ two container lifetimes
while the amounts still match the table (there is nothing to notice), or verify
anything else about the Price — recurring vs one-off, tax behaviour, currency
options. Stripe's own configuration is the authority on those.

If the offer is ever run with prices that change during its life, the table
becomes the thing to update, and it is the only place to update it.

## 2. App Store Connect API

Offer codes, their caps and their expiry are configured by hand in App Store
Connect. The admin panel (Sprint 2, WP4–WP6) records them per plan so Brad can
see what is live; it does not read or write ASC.

An integration would use the App Store Connect API's
`subscriptionOfferCodes`, `subscriptionOfferCodeCustomCodes` and
`subscriptionOfferCodeOneTimeUseCodes` resources, authenticated with an ES256
JWT signed by an ASC API key. That would let the panel show real redemption
counts against the cap instead of hand-entered numbers, and eventually create
codes.

Out of scope for the 30 September window.

## 3. Origin-lock on the public marketing routes

`/leads/*`, `/store-click` and now `/founding/checkout` are reachable directly
at the API Gateway URL, bypassing the CloudFront edge and its WAF rate-based
rule. The origin-side limiter keys on the first `X-Forwarded-For` hop, which on
that path is client-controllable — so it stops a naive script, not a
header-spoofing one. This is documented at length in `leadsRoutes.ts`.

The durable fix is the same one already written up there: a shared-secret header
CloudFront injects and these routes require. `/founding/checkout` raises the
stakes (a hold consumes capacity), which is why it now requires Turnstile
outright rather than failing open — but the origin-lock is still the real answer.

## 4. Sweeping expired holds

An abandoned checkout's seat frees itself when `hold_expires_at` passes: nothing
counts a lapsed hold. `checkout.session.expired` additionally flips the row to
`expired` so the admin view reads truthfully, but if that event is never
delivered the row stays `open` forever while counting for nothing.

Harmless, and deliberately so — the alternative is a scheduled sweeper whose own
failure modes would be worse. If the admin view ever needs to be exact, a
`WHERE status = 'open' AND hold_expires_at < now()` update in the existing
`dataRetentionSweep` cron is a few lines.

## 5. `registration_completed` still carries no channel

The admin attribution (Sprint 2) shows registrations as a plan-window total
labelled "all sources", because the event is emitted server-side at sign-up with
no campaign context left. Attributing it would need the campaign carried through
sign-up — a mobile change, and out of scope while nothing about the web offer
may appear in the app.
