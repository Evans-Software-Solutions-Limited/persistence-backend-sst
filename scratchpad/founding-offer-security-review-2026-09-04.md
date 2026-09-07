# Founding offer — payment and fulfilment security review (4 Sept 2026)

Scope: PR #432 (`feat/founding-offer-admin` @ `16831151`), read-only. Nothing was changed, deployed, or created. Not legal or tax advice; the GDPR, consumer-law and record-keeping points below are things to confirm with your accountant/solicitor.

## Recommendation: approve with changes

Brad's preferred direction (payment out of band, cleared funds verified by hand, grant recorded in the authenticated admin panel, buyer creates and confirms their own account, pending grant applied only after authoritative email verification, no bank details or Payment Links on the website) is the right model for a 220-seat launch, and the code already implements almost exactly that. Two things must change before the first production grant, and one Supabase setting must be verified, because the whole pending-grant safety argument rests on it.

**Admins should record pending grants only. They should not create Supabase Auth users.** See § 4.

## 1. Threat model (what actually matters at this scale)

Assets: ~£8k of pre-sold access, the seat cap, Brad's admin identity, buyers' emails and payment references, the entitlement path every mobile build already trusts.

| Actor                                         | Goal                                         | Path                                                                                             | Where it is stopped                                                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stranger who learns a buyer's email           | Take the buyer's paid access                 | Sign up with that email before the buyer does; `GET /subscriptions/me` applies the pending grant | `applyPendingForUser` requires `email_confirmed_at` on the Auth record — **only if "Confirm email" is ON in prod** (finding 1)                                                                                     |
| Non-admin user with a valid JWT               | Grant themselves a tier                      | `POST /admin/founding-grants`                                                                    | `requireAdmin` reads `app_metadata.admin === true` from the verified JWT; `app_metadata` is service-role-only (Supabase docs: `user_metadata` is "editable by the user without any checks", `app_metadata` is not) |
| Anyone                                        | Enumerate accounts / spam sign-in emails     | `/admin/login` magic-link sender                                                                 | `create_user:false`; Supabase per-address rate limit; constant 403 body on the API                                                                                                                                 |
| Buyer                                         | Double-dip a seat                            | Pay once, get two grants                                                                         | Partial unique indexes (one live grant per user / per pending email) + advisory lock per pool                                                                                                                      |
| Buyer with an existing App Store subscription | Nothing malicious — but loses the paid grant | Next RevenueCat sync re-asserts the `rc_` row                                                    | **Not stopped** (finding 2)                                                                                                                                                                                        |
| Deleted account                               | Payment record disappears                    | `founding_grants.user_id ON DELETE CASCADE`                                                      | **Not stopped** (finding 3)                                                                                                                                                                                        |
| Whoever controls Brad's mailbox               | Full admin                                   | Magic link → `/admin/callback`                                                                   | Nothing beyond mailbox security (finding 6, later hardening)                                                                                                                                                       |
| Website visitor                               | Anything                                     | `/founding`                                                                                      | Page grants nothing; with payment CTAs removed it is purely informational                                                                                                                                          |

## 2. Findings, ranked

**🔴 F1 — Pending-grant redemption is only safe if Supabase "Confirm email" is ON in production, and the evidence says it is OFF in staging.**
_Update 2026-09-04: Brad confirmed the setting is ON in production. F1 is now a staging-configuration and go/no-go item, not a production blocker._
`applyPendingForUser` ([foundingGrantService.ts](../microservices/core/src/application/founding/foundingGrantService.ts)) correctly re-reads the Auth record via the admin API ([supabaseAdminClient.ts](../microservices/core/src/application/account/supabaseAdminClient.ts) `getAuthUserIdentity`) and requires `email_confirmed_at` plus an email match. But Supabase's docs state that disabling Confirm email "implicitly confirms the user's email in the database" — the timestamp is set without anyone proving mailbox control. In the staging project, all 9 email-provider users have `email_confirmed_at` within 3 seconds of `created_at` (a human cannot click a link that fast), and the checked-in `supabase/config.toml` has `enable_confirmations = false`. I could not run the equivalent query on production (permission denied), so treat prod as unverified. If prod is also OFF, anyone who knows a buyer's email can sign up with it first and take the grant, and the check in the code is decorative. The mobile adapter already handles the confirmation-required outcome (`email_confirmation_required` in `supabase.adapter.ts`), so turning the setting on is a config change, not a code change.
_Fix (mandatory):_ verify Confirm email is ON in prod (Dashboard → Authentication → Sign In / Providers → Email) before any pending grant is recorded; turn it on in staging so the smoke test is honest. Keep the code check as-is. _Later:_ an admin "attach pending grant to this account" action so Brad can bind by hand when a buyer's app email differs.

**🟠 F2 — A grant to someone with a live App Store subscription is silently undone by the next RevenueCat sync.**
`writeSubscriptionRow` cancels every live row for the user (so the `rc_` mirror goes `cancelled`) and inserts the founding row. `syncRevenueCatCustomer` ([revenueCatSync.ts](../microservices/core/src/application/revenuecat/revenueCatSync.ts)) runs on any webhook or `POST /subscriptions/sync`, calls `cancelLiveSubscriptions(appUserId)` and re-upserts the `rc_` row as active. The founding row is cancelled with no audit entry and the buyer has paid £30–£99 for nothing. BRIEF D3 intends "later IAP purchases supersede", but a pre-existing subscription makes this immediate. The New Grant form shows "currently premium" but allows submission.
_Fix (mandatory, small):_ refuse the grant (409, new `active_store_subscription` error) when a live `rc_*` row exists, with an explicit override flag like `allowRoleChange`. Operationally: don't sell founding places to current subscribers; tell them to turn off auto-renew and be granted after expiry.

**🟠 F3 — Account deletion erases the payment record and frees the seat.**
`founding_grants.user_id … REFERENCES profiles(id) ON DELETE CASCADE` ([migration](../supabase/migrations/20260904120000_founding_offer_referrals.sql), schema.ts). A buyer who deletes their account removes the only first-party record of a real payment. UK record-keeping expects sales records kept for six years, and a refund dispute after deletion has nothing to point at. The migration has not reached staging or prod yet (founding tables absent in staging as of today), so this is cheap to change now.
_Fix (mandatory):_ `ON DELETE SET NULL`, keep `email`, and keep the row counted as a used seat (the money was taken). Document the retention in the privacy policy (both copies — web and in-app).

**🟡 F4 — Pending grants never expire, and the six months start at redemption.**
A grant redeemed two years later still yields six months, and a recycled mailbox could redeem it. _Fix:_ state a redemption deadline (e.g. 90 days) in the invite email and T&Cs now; add `redeem_by` + an admin "expire pending" action later.

**🟡 F5 — No way to correct a grant's email; Apple "Hide My Email" and aliases will not match.**
The invite says "reply and we'll move it across" but the only path is revoke + re-create (auditable, acceptable — write it into the runbook). Gmail dots/plus aliases and Apple private-relay addresses will never match the grant email; there is at least one Apple-provider user in staging. _Fix:_ runbook step "sign up with the exact email you gave us, or tell us the address you used"; later the manual attach action from F1.

**🟡 F6 — Admin identity strength equals Brad's mailbox.**
Magic link, implicit flow, token in the URL fragment, session in `sessionStorage`, no MFA, no `aal` check in `requireAdmin`, and `set-admin --revoke` does not invalidate existing sessions (claim lingers until the access token expires; refresh tokens keep working). `jwtVerify` pins neither issuer nor audience (pre-existing). Acceptable for one admin at launch. _Later:_ enrol TOTP on the admin account and require `aal === "aal2"` in `requireAdmin`; short access-token lifetime.

**🟡 F7 — Evidence fields are optional.**
`paymentReference` and `notes` are optional; nothing stops a grant with no reference. Reference uniqueness cannot be global (bank references repeat), but a Stripe payment id should never be recorded twice. _Fix:_ make `paymentReference` required for `bank_transfer` and `stripe_link` at the service layer; later a partial unique index on `(payment_method, lower(payment_reference))` for `stripe_link`.

**🟡 F8 — PII in the audit log and pending emails of non-users.**
`admin_audit_log.after` holds buyer emails and references indefinitely; pending grants hold emails of people with no account; neither is in the retention sweep. This is legitimate (contract / legal obligation) but must be described in the privacy policy, and the audit log should be excluded from any future "delete everything" sweep on purpose, with that reasoning written down.

**🟢 F9 — Public payment configuration should be removed, not left unset.** See § 3.

**🟢 F10 — Minor:** `resendInvite` and `listForUser` load up to 1000 grants to find one; harmless at 220. CORS for the admin panel's cross-origin fetches was not verified (would only break the panel, not security).

Things checked and found sound: admin guard is server-side and strict-boolean; audit rows are written inside the mutation transaction; seat cap uses a per-pool advisory lock; duplicate detection covers user id and lower(email); pending apply is conditional-update idempotent under concurrent first reads; revoke cancels and expires the subscription row; `applyPendingForUser` never throws into the subscription read; `create_user:false` on the admin login; no health data reachable from `/admin/*`; user lookup is exact-match only.

## 3. Public payments: reject, and remove the configuration

Reasons beyond "the URL is shareable": (1) a public link has no coupling to the seat cap — Stripe's per-link limit cannot enforce 200 across three links, so it creates a fulfil-or-refund liability once seats are gone; (2) the checkout email is whatever the buyer types, which multiplies the F5 matching problem; (3) Adaptive Pricing is always on for Payment Links, so foreign buyers pay in their currency and `amount_minor` no longer equals the price; (4) Stripe's own fulfilment model is `checkout.session.completed` webhooks, which D2 explicitly excludes, so every public payment is a manual reconciliation task anyway; (5) dead-but-wired env vars are a footgun — someone sets `VITE_FOUNDING_STRIPE_PREMIUM_URL` in GitHub Environments and the site starts selling. Bank details on a public page are a phishing-lookalike and a mule-account risk with no upside when the buyer is already talking to Brad.

Privately sent Payment Links (WhatsApp/DM, QR on Brad's phone) remain fine and are better than bank transfer: cleared-funds signal is instant and refunds are one click. Keep `stripe_link` in `FOUNDING_PAYMENT_METHODS`.

Remove entirely:

- `packages/web/src/pages/Founding.tsx`: `FoundingPaymentLinks`, `paymentLinks()`, `PaymentLink`, `bankDetails`, the three `<PaymentLink>` usages, the `founding-bank` section, and the "Pay, then sign up…" redemption copy. Replace with an invitation section (see § 5).
- `packages/web/src/vite-env.d.ts`: `VITE_FOUNDING_BANK_DETAILS`, `VITE_FOUNDING_STRIPE_PREMIUM_URL`, `VITE_FOUNDING_STRIPE_PREMIUM_PLUS_URL`, `VITE_FOUNDING_STRIPE_COACH_URL`.
- `infra/web.ts`: the same four `environment` entries.
- `.github/workflows/deploy-staging.yml` and `production-deploy.yml`: the same four `vars.` lines.
- `packages/web/src/marketing/marketing.css`: `.founding-bank` and payment-button styles if unused.
- `packages/web/src/pages/__tests__/Founding.test.tsx`: env-driven payment-link/bank cases.
- Briefs (`AGENT_BRIEF.md` § A.1 and § C.4, `FRONTEND_BRIEF.md` § W3, `BRIEF.md` § 1): drop the bank-details/Payment-Link ops notes so the next agent does not re-add them.

Keep `VITE_FOUNDING_SEATS_USED`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (all genuinely public).

## 4. Admin creates the Auth user (A) vs admin records a pending grant (B)

B is safer and is what the PR does. Under A, Brad's panel becomes an account-creation surface: an invite/magic link goes to whatever was typed at a stand (a typo creates a live, entitled account owned by a stranger), Brad sits in the password-set and recovery path, in-app consent (CONSENT_VERSION) is bypassed or has to be re-plumbed, Apple/Google sign-in later produces a second identity for the same person, and every mistake needs a service-role delete. Under B the grant is inert until the person who controls that mailbox proves it through the normal sign-up path, Supabase stays the only identity authority, consent is collected in-app as today, and a wrong email costs a revoke + re-grant instead of an orphaned account. **Confirmation: admins record pending grants only.** The one gap in B is F1 — B's safety is exactly the confirmation step.

## 5. `/founding` page

Keep it, as an invitation page: the offer, what it funds, the counter, "how to get a place" (in person at the listed events, or email the monitored address), the redemption explanation ("we record your payment, you sign up in the app with the same email and confirm it, access switches on"), the cancellation sentence, terms link. No payment CTA. If the URL is shared by a member, the worst outcome is inbound email; the page cannot grant anything and the counter is static. Keep it out of the mobile app (Apple 3.1.3(b)) as already noted.

## 6. Remaining answers

- **Seats, duplicates, refunds, revocation, reconciliation (Q9):** pending grants count as used seats (correct: money taken); revoke frees the seat and drops the amount from revenue; refund = revoke with the refund reference in the reason — honest, but partial refunds are not representable (fine for now). Reconciliation is manual: Stripe dashboard + bank statement vs the grants export, weekly.
- **Backwards compatibility (Q10):** yes. The store build reads `GET /subscriptions/me` (`sst-api.adapter.ts`), the founding row is an ordinary `user_subscriptions` row (`active`, `cancelled_at` set, `expires_at` +6 months), old builds render "cancelled — active until <date>"; the OTA branch improves that copy. Cost per read is one indexed lookup; the admin REST call happens only when a pending grant exists.
- **GDPR / PCI / accounting / cancellation (Q11):** no card data touches this code (PCI stays with Stripe/SumUp). GDPR: new personal-data categories (F8) → privacy policy update, both copies. Accounting: F3, plus keep Stripe/bank evidence outside the app. Consumer cancellation: 14 days applies to distance and off-premises sales; because access starts on sign-up, the T&Cs should state that redeeming is a request for immediate supply — confirm the wording with a solicitor.
- **Admin protections (Q6):** two-step confirm exists in `NewGrantForm`; revoke requires a reason. Add: mandatory reference (F7), the live-subscription refusal (F2). Later: MFA/aal2 (F6). Not worth it for one admin: dual approval, IP/device restrictions, rate limiting beyond API Gateway.

## 7. Smallest secure operational flow (~220 places)

1. Take payment out of band: SumUp/card in person, bank transfer, or a Payment Link sent privately. Wait for "succeeded" in Stripe or the transfer appearing in the account.
2. Ask the buyer to spell the email they will use in the app; read it back. Warn about Apple "Hide My Email" and aliases.
3. In `/admin` → New grant: email, tier, amount actually paid, method, **reference (Stripe payment id / bank ref)**, event name in notes, referral code if a partner sent them. Confirm.
4. Buyer receives the invite, installs, signs up with that email, confirms the email, opens the app; access is live on first load. Existing-account buyers are live immediately.
5. Weekly: export grants; tick each against Stripe/bank; resend invites for pending > 14 days; revoke with "refund <ref>" for refunds; update `VITE_FOUNDING_SEATS_USED`.
6. Wrong email: revoke ("wrong email, re-granted as <id>") and re-grant; the seat count stays correct.

## 8. Mandatory before launch vs later

Mandatory: F1 (verify/enable Confirm email in prod and staging), F2 (refuse live-subscription grants), F3 (`SET NULL`, keep the record), F9 (remove public payment config), privacy-policy line for F8, redemption-deadline sentence for F4, mandatory reference for F7.
Later: MFA/aal2 and session invalidation (F6), manual attach-pending action (F1/F5), `redeem_by` column (F4), Stripe-reference uniqueness (F7), live seat counter endpoint.

## 9. Go / no-go

Staging: migration applied on merge and the three tables present · Confirm email ON · `set-admin` run for Brad's staging email, sign out/in, `app_metadata.admin` visible in the token · redirect allow-list contains `/admin/callback` · `VITE_SUPABASE_ANON_KEY` set · admin panel fetches succeed cross-origin · SMOKE*TEST backend + web sections · negative test: sign up with a pending email but do **not** confirm → no grant applied; confirm → applied once even under two concurrent first reads · grant to a coach account with a consumer tier → 409 · grant to an account with a live `rc*` row → 409 after F2 · revoke → tier reverts on next read · account deletion → grant row survives after F3.

Production: F1 verified by eye in the Dashboard **and** by a query showing recent email users confirmed minutes, not seconds, after creation · migrations dry-run reviewed, all additive · `set-admin` on prod for exactly one address · redirect URL added · the four public payment variables absent from the GitHub production environment (or removed from the workflows) · privacy policy and T&Cs updated · RevenueCat production webhook still reconciling · Brad's own account granted first (active path), then one fresh mailbox (pending path) end to end on a store build · only then the first paying customer.
