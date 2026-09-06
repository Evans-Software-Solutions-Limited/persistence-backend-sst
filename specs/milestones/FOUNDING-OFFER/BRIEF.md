# Milestone FOUNDING-OFFER — founding-member offer, internal admin, referral attribution

Status: **APPROVED for implementation (Brad, 2026-09-03)** — thin slice of
`specs/32-partner-code-and-commission-platform/BRIEF.md` (Slices B + C, plus a
founding-grant tool). Commission ledger, partner portal and store-offer
integration (Slices D–F) remain out of scope.

Branch: `feat/founding-offer-admin` (worktree `.claude/worktrees/founding-offer`).

## 1. Why

Brad is raising launch-marketing cash by pre-selling a capped founding-member
offer through direct conversations and founders' fairs. Payment is taken out of
band by card in person, bank transfer, or a Stripe Payment Link sent privately;
the website is informational and carries no payment controls. Payments are
verified and recorded by hand. He also needs to know which vendor / event /
partner each subscriber came from so that later vendor deals can be settled.
Today nothing in the codebase can do either: there is no admin surface (the web `/org-admin` page
is a static demo), no referral-code table, and no way to grant an entitlement
outside RevenueCat.

## 2. Decisions baked in

### 2026-09-04 grant-model amendment (supersedes conflicting text below)

The admin feature is an **access-grant tool**, not a checkout or proof-of-purchase
system. Brad chooses the recipient email, tier, and access duration. A grant may
be one of two kinds:

- `founding` — consumes one place from the database-backed consumer or coach
  campaign capacity;
- `complimentary` — free access for Brad, friends, family, testers, or another
  discretionary recipient and does not consume campaign capacity.

An existing live or pending admin grant can be extended by a chosen number of
months. The extension adds to remaining access rather than discarding it. A
revoked grant or deleted account cannot be extended. A live App Store / Play
subscription cannot be displaced by an admin grant; access may be granted once
the store subscription expires.

A crowdfunding contribution is optional, recorded only when useful, and is
legally and technically separate from access. Its amount, method, reference,
and date are evidence/notes only: contributing does not buy, guarantee, size,
or extend a grant, and granting access does not imply a contribution. The
platform never takes this money.

Referral codes remain attribution identifiers. An admin grant may record the
referral that led to it, but does not lock that referral as a paid conversion.
Any future code-linked price reduction must be implemented as a native App
Store / Google Play offer mapping; entering a referral code must never create
an entitlement directly.

Founding pool capacities and current usage are database-backed and exposed as
aggregate public availability. They are not build-time environment variables.
The public page must describe discretionary allocation and keep optional
crowdfunding contributions separate; it must not present fixed prices or a
purchase/cancellation flow.

The original launch assumptions are retained below as history. This amendment
controls wherever they conflict.

### 2026-09-05 amendment — paid web founding offer (supersedes the 2026-09-04 wording on prices and purchase flow)

The founding offer is sold on the website for a fixed period ending 30 September
2026: Premium £30 / 6 months or £60 / 12 months; Premium+ £50 / 6 months or
£100 / 12 months. Payment is taken by Stripe Checkout in one-off payment mode;
fulfilment is a `founding` grant created by the `checkout.session.completed`
webhook through `FoundingGrantService.grant`, so redemption, email confirmation,
seat caps, the live-store-subscription refusal and revocation behave exactly as
reviewed on 2026-09-04. The public page therefore **does** present fixed prices
and a purchase flow. Administrative grants (`founding` for cash taken in person,
`complimentary` for discretionary access) continue unchanged as the second
route. Contributions recorded on web-checkout grants are the Stripe amount and
payment reference. Referral codes remain attribution only. In-app introductory
offers at the same prices are configured in App Store Connect and Google Play as
a separate path; nothing inside the mobile app references the website offer.
Specification: `specs/milestones/MARKETING-PLANS/ADDENDUM-2026-09-05-paid-founding-offer.md`.

| #   | Decision                                                  | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Founding offer                                            | **£30 → 6 months `premium`**, **£50 → 6 months `premium_plus`**, **200 seats total** across both consumer tiers. Separate **20-seat coach line: 6 months `start_up_coach_plus` for £99**.                                                                                                                                                                                                                                                                                                   |
| D2  | Payment recording                                         | Manual and out of band. Admin verifies cleared funds, then records email, tier, amount, method (`bank_transfer` / `stripe_link` / `card_in_person` / `other`), and reference. Payment Links may be sent privately only; there are no public bank details or payment buttons and no Stripe webhook.                                                                                                                                                                                          |
| D3  | Entitlement fulfilment                                    | Direct `user_subscriptions` row, **bypassing RevenueCat**. `external_subscription_id = 'founding_<grant uuid>'`, `payment_status='active'`, `expires_at = now()+6 months`, `cancelled_at = now()` (renders "active until <date>", no renewal promised). Existing live rows are cancelled first (`user_subscriptions_active_unique`). Later IAP purchases supersede it via the RC sync's `cancelLiveSubscriptions`; RC revocations only touch `rc_*` rows so the founding row survives them. |
| D4  | Admin authorisation                                       | Supabase JWT `app_metadata.admin === true` (set via service role, one-off script). **Not** `profiles.role` — the `update_subscription_limits` trigger rewrites `role` from the tier and would demote an admin who takes a founding grant.                                                                                                                                                                                                                                                   |
| D5  | Attribution model (spec-32 §7)                            | One attribution per user (`referral_redemptions.user_id` unique). First valid claim wins; the user may **replace** it until `locked_at` is set. Locked at first paid conversion (founding grant, or RC sync `activated`). Existing subscribers may still claim (attribution only, never entitlement). Free users stay attributed indefinitely. No attribution window.                                                                                                                       |
| D6  | A referral code never changes price or grants entitlement | Attribution only. Store offers stay in ASC/Play (spec-32 §12).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D7  | Commission                                                | Out of scope. Admin reporting shows counts per code (claims, founding grants, paid conversions) so vendor settlement can be done by hand.                                                                                                                                                                                                                                                                                                                                                   |
| D8  | Mobile UX                                                 | Optional "Have a referral code?" entry on the onboarding journey **and** on Subscription Selection; never blocks Continue/Skip; neutral error copy. Ships in the next mobile release — the web/admin/backend go live first.                                                                                                                                                                                                                                                                 |
| D9  | Link attribution                                          | `?ref=<CODE>` on any marketing route (incl. `/qr/:slug`) is recorded as a `store_click` property and shown on the landing page ("Code <X> will be applied when you sign up — enter it in the app"). Store navigation cannot carry the code (no SDK, spec-30 limitation), so the app entry point is the authoritative claim.                                                                                                                                                                 |

## 3. Personas & surfaces

- **Brad (admin)** — web `/admin` (Supabase magic-link sign-in; server enforces D4): dashboard, founding grants, referral codes, user lookup, audit log.
- **Founding buyer** — pays off-app, signs in to the app with the same email, sees Premium/Premium+ active until date. No new mobile UI required for redemption.
- **Referred user** — enters a vendor's code in the app (D8) or arrives via `?ref=` link (D9).

## 4. Delivery

Three PRs onto the milestone branch, in this order:

1. **Backend** — `BACKEND_BRIEF.md`: migration + Drizzle schema, `requireAdmin`, `/admin/*` routes, `/referrals/*` routes, RC-sync lock hook, tests. Deploys to staging on merge; prod on release.
2. **Web** — `FRONTEND_BRIEF.md § Web`: Supabase auth for `/admin`, admin pages, `?ref=` capture on marketing routes, founding-offer landing section.
3. **Mobile** — `FRONTEND_BRIEF.md § Mobile`: referral code entry (onboarding + Subscription Selection), applied-state display.

Gate: `SMOKE_TEST.md` on staging before the prod release. Prod release also
ships every migration merged since v1.8.0 (all additive) — see the deploy
checklist in `SMOKE_TEST.md § Release`.

## 5. Out of scope (explicit)

Commission ledger and payouts; partner self-service portal; Apple/Google offer
code mapping; Stripe webhooks; per-device/household fraud controls beyond
one-attribution-per-user and rate limiting; any change to RevenueCat sync
semantics other than the best-effort lock hook.
