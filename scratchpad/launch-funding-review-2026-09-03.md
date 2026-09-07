# Persistence — launch funding review (3 Sept 2026)

Two questions were asked: which of crowdfunding vs. a £30 / 6-month founding-member offer will actually get cash into the business quickly, and what needs to be true in the codebase (referrals, entitlements) to run it. This document answers both, then gives a build list in priority order.

The short version: run the £30 offer yourself, on your own website, via a Stripe Payment Link — not through the App Store and not through a crowdfunding platform. It is the same offer a crowdfunding page would sell as a "reward", but the money lands in days instead of two months, the fees are ~2% instead of ~8–10%, and it needs almost no new code. Crowdfunding can be a second act once you have a tangible thing to fund and some proof people are buying. The entitlement problem you hit is real and is the one piece of engineering that must be fixed first, because it is the fulfilment mechanism for either route.

Not a lawyer or financial adviser — the points on VAT, consumer law and pre-selling below are things to confirm with your accountant.

---

## 1. The £30 for 6 months offer — the numbers

Premium is £16.99/month (resolved 4 Aug). Six months at list is £101.94, or about £62 pro-rata on the annual. £30 is a 70% discount on monthly, ~52% on annual-equivalent. That is a real "founding member" price without being so cheap it devalues Premium — it's a fair number.

What 200 sales are actually worth depends entirely on the rail:

| Rail                                   | Gross per sale | Deductions                                                                    | Net per sale | 200 sales                         | Cash arrives                                                                                    |
| -------------------------------------- | -------------- | ----------------------------------------------------------------------------- | ------------ | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Apple IAP (6-month intro / offer code) | £30.00         | VAT stripped first (£25.00 ex-VAT), then Apple 15% (Small Business Programme) | ~£21.25      | ~£4,250                           | Apple pays ~45 days after the end of its fiscal month. September sales → **early/mid November** |
| Google Play                            | £30.00         | same shape as Apple, 15%                                                      | ~£21.25      | ~£4,250                           | Monthly, ~15th of following month                                                               |
| Web — Stripe Payment Link              | £30.00         | Stripe UK 1.5% + 20p (if not VAT-registered, no VAT to strip)                 | ~£29.35      | **~£5,870**                       | Stripe pays out on a rolling **2–7 day** schedule                                               |
| Kickstarter reward                     | £30.00         | 5% platform + ~3% + 20p processing                                            | ~£27.40      | ~£5,480 (only if the goal is hit) | ~14 days after campaign end; 30-day campaign → **mid/late October**                             |
| Crowdfunder.co.uk reward               | £30.00         | ~5% platform (varies, some projects 0%) + ~2.4% + 20p processing              | ~£27.60      | ~£5,520                           | After campaign end, similar lag                                                                 |

The web rail is the only one that solves your actual problem, which is cash _this month_. Apple's payout timing alone rules it out for the founding offer — you would be funding October's events on November's money.

Two things to get right on the web rail:

**Apple's rules.** Guideline 3.1.3(b) (multiplatform services) lets a subscriber who bought on the web use that access in the iOS app, provided the same tier is also buyable in-app (it is). What you must not do is _steer_ users from inside the app to the web offer — no link, button or copy in the app pointing at it. Market it everywhere else: website, QR codes on the banners, Instagram, the founders' fairs. In-app, the user simply signs in with the email they paid with and Premium is there. The UK does not yet have the anti-steering carve-out the US got, so treat this as a hard line.

**VAT and consumer law.** If Capital Pay / the trading entity isn't VAT-registered (below the £90k threshold), £30 is £30. If it is, £30 is VAT-inclusive and you keep £25 before Stripe. Digital services sold to UK consumers carry a 14-day cancellation right under the Consumer Contracts Regulations unless the buyer expressly agrees to immediate access and acknowledges losing the right — add that checkbox/line to the checkout. State plainly that the offer is 6 months of Premium, non-renewing, and what happens at the end (it lapses to Free unless they subscribe in-app).

**Cap and scarcity.** Stripe Payment Links have a native "limit the number of payments" setting — set it to 200 and it deactivates itself. That is your referral/cap logic, for free. Put a "X of 200 claimed" counter on the landing page; it can be a number you update by hand daily to start.

---

## 2. Crowdfunding — honest assessment

The Xero guide covers three models. Equity (Crowdcube, Seedrs) is wrong for this: FCA-regulated, weeks of prep, a legal bill, and you'd be giving away a slice of the company for a few thousand pounds of marketing. Peer-to-peer lending is debt on a pre-revenue app — exactly the kind of squeeze you're trying to get out of. That leaves rewards-based, which is where Kickstarter, Indiegogo and Crowdfunder.co.uk sit.

Rewards crowdfunding is really a pre-sale with a deadline and a story wrapper. Your reward tier _would be_ "6 months of Premium for £30". So the question is whether the platform earns its 8–10% and its 6–8 week delay. What it gives you is a deadline, social proof ("142 backers"), a page format people already trust, and in Crowdfunder's case access to match-funding pots and business-support programmes. What it costs you is fees, time (a good campaign video and page is a week of work minimum), the all-or-nothing risk on Kickstarter, and the cash lag. First-time campaigns from unknown creators overwhelmingly raise from the creator's own network in the first 48 hours — the platform doesn't bring you an audience, you bring one to it.

You can take everything crowdfunding gives you and leave what it costs: build your own campaign page on the website with a goal, a counter, a deadline (your birthday is a natural one) and a transparent "this is exactly what the money buys" list — banners, the QR subscription, the named events. That transparency is what makes rewards crowdfunding work, and it works just as well on your own domain.

Where a platform _does_ make sense: later, for something tangible and bigger (a physical product, a specific event sponsorship), once you have a few hundred users who can be the first-48-hours wave. Crowdfunder.co.uk would be the pick over Kickstarter for a UK business — flexible funding, UK match-funding partners, and it's comfortable with small local business campaigns.

---

## 3. The 30th birthday angle

Your instinct that it risks making it about you rather than the product is right, but the fix is dosage, not omission. All your launch content already leads with the personal story and puts the product second — the birthday is consistent with that brand, not a departure. Use it as the hook and the deadline, not the body:

"I turn 30 this month. I'm opening 200 founding-member places at £30 for 6 months of Premium. Every pound goes on getting Persistence in front of people — here's the list."

Then the copy is about what they get and what it funds. What to leave out entirely is any language about struggling, maxed cards or the squeeze. "Founding members fund the launch" is a position of strength; "help me" is not, and it also invites the wrong kind of buyer. Friends and family who want to help you for your birthday will read between the lines anyway.

"30 for 30" (30th birthday, £30, first 30 days) is a tidy campaign name if you want one.

---

## 4. What actually needs building

### 4a. Referral codes — don't build them for this

Nothing exists in the codebase for referral or promo codes: no table, no route, no mobile screen. The only code-redemption flow is the coach invite code (`trainer_invite_codes`, `AcceptInvitePresenter`), which is a different thing. Building a proper referral system — code generation, attribution, admin management, fraud limits — is a two-to-three-week spec and it is not on the critical path for a 200-seat offer. Stripe's payment cap is the cap. If you want a member-get-member scheme after launch, spec it then with real usage data.

### 4b. Entitlement fulfilment — this is the blocker, and it's small

**Why your own grant didn't work — the likely causes, in order:**

1. **The RevenueCat customer you granted to isn't your production Supabase user.** The backend keys everything on `app_user_id === profiles.id`. `syncRevenueCatCustomer` silently skips anonymous ids (`$RCAnonymousID:…`) and any id with no matching profile row in _that_ environment's database. One RC project fans out to both staging and production, so a grant against your staging profile id, or against an install that never called `Purchases.logIn`, produces a webhook that production logs as "skipped" and does nothing. First check: in the RC dashboard, does the customer id you granted to exactly equal your production `profiles.id`?
2. **The sync never ran for production.** The DB row is only written by (a) the RC webhook hitting the production `/revenuecat/webhook`, or (b) the app calling `POST /subscriptions/sync`, which only fires after a purchase or a restore. If the production webhook URL/secret isn't configured in RC, nothing happens until you tap Restore Purchases. Check `revenuecat_webhook_events` in prod for any row with your id.
3. **The sync only reads `GET /customers/{id}/subscriptions`** (`revenueCatClient.ts:145`). This was chosen deliberately because `/active_entitlements` doesn't carry `lookup_key`. Whether a dashboard promotional grant appears in the v2 `/subscriptions` list needs confirming against the live API (call it for your customer id and look for `store: "promotional"`). If it doesn't, no promotional grant will _ever_ reach `user_subscriptions`, for you or for 200 founding members, and the fetch needs extending to also read `/active_entitlements` and resolve entitlement object ids to `lookup_key` via `GET /projects/{id}/entitlements` (cache it — it's static).
4. **The tier row must exist in prod.** A `premium_plus` grant before `20260725194527_premium_plus_tier.sql` is on production FK-fails the upsert and RC retries forever (documented in STATE.md). `premium` is safe.
5. **The demotion trap.** `update_subscription_limits_trigger` (migration 004, lines 95–121) sets `profiles.role = 'user'` for any non-trainer tier. Granting `premium` to your `personal_trainer` account knocks it out of coach mode. Use a second account for consumer testing, or grant a coach tier.

**Recommended fulfilment design for the offer** (works for Stripe web sales _and_ for crowdfunding backers if you ever run one):

Bypass RevenueCat for the founding offer and write the `user_subscriptions` row directly. The code path already supports this: `subscriptionRepository.findForUser` and `assertEntitlement` read the most recent row joined to `subscription_tiers` by name with no `is_active` filter, and the RevenueCat revocation branch only cancels rows whose `external_subscription_id` starts with `rc_` — so a promo row survives RC's "no subscription → revert to free" syncs. If a founding member later buys via IAP, RC's activation branch supersedes the promo row, which is the correct outcome.

Row shape: `tier_name = 'premium'`, `payment_status = 'active'`, `starts_at = now()`, `expires_at = now() + 6 months`, `billing_cycle = 'monthly'` (cosmetic), `cancelled_at = now()` (so the app shows "active until <date>" rather than promising renewal), `external_subscription_id = 'intro_<stripe_payment_intent_id>'`, `metadata = { source: 'founding_offer', stripe_payment_intent, email }`. Idempotent on `external_subscription_id`. The `user_subscriptions_active_unique` partial index allows only one live row per user, so the script must first cancel any existing live row for that user (the same `cancelLiveSubscriptions` step the RC sync takes) — relevant for anyone mid-trial or, in your case, a coach account with a long-dated row.

Build order:

| #   | Work                                                                                                                                                                                                                 | Size               | Notes                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Stripe Payment Link: £30, one-off, cap 200, collect email, custom field "email you use in the Persistence app", consumer-rights acknowledgement in the custom text                                                   | 30 min, no code    | Use the same Stripe account as the parked rail or a fresh one — doesn't matter, the backend won't listen to it                                            |
| 2   | `scripts/grant-founding-offer.ts`: reads Stripe checkout sessions (or a CSV export), matches email → `profiles.id`, inserts the row above, prints unmatched emails for manual follow-up                              | ~2–3 h incl. tests | Run it daily by hand. 200 seats over a month is not worth a webhook. Mobile already picks the row up on next `GET /subscriptions/me` / foreground refresh |
| 3   | Landing page section on the website: offer, counter, what the money funds, birthday hook, FAQ (how to redeem: "sign in with the email you paid with")                                                                | ~half a day        | Counter can be a hand-edited number initially                                                                                                             |
| 4   | Diagnose your own grant with checks 1–3 above; fix `fetchCustomerSubscriptions` if promotional grants don't appear in `/subscriptions`                                                                               | 1–4 h              | Needed regardless — you'll want promo grants for reviewers, coaches and press                                                                             |
| 5   | Redemption edge cases: payer email ≠ app email (script prints them; you fix by hand), payer hasn't installed yet (row can be pre-created once they sign up — re-run the script), refunds (delete the row, cap check) | included in #2     |                                                                                                                                                           |

Nothing here touches the parked Stripe rail or the RC webhook, and nothing needs a mobile release — which matters, because the current mobile branch is still pre-submission.

### 4c. One housekeeping finding

The Supabase MCP connector in this session lists `persistence-staging` and the **old, dead** `persistence` project (`dfeyebgdktfteqlacmru`) — not the real production project `opcvjypsoivaxerahbal`. STATE.md says the old project 401s; it doesn't, it answers queries and still holds your old Stripe-era data. Any agent told to "check prod" through this connector is looking at the wrong database. Worth either pausing/deleting the old project or re-scoping the connector.

---

## 5. Suggested sequence for the next two weeks

Week 1: Payment Link live, landing section live, first announcement to your own network (this is where a founding offer sells — the first 48 hours, same as a Kickstarter). Grant script written and run against the first payers so redemption is proven end-to-end before the fairs. Week 2: QR codes on the banners point at the offer page, not the store; founders' fairs push the same URL; daily grant run.

If 200 sells out, that's ~£5.9k in the account within days of each sale, which covers the banners, the QR subscription and event fees you listed. If it stalls at 60–80, you still have £1.8–2.4k in hand and a clear signal about the audience before spending on a crowdfunding video.
