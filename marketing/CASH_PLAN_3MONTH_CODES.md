# Cash plan — 3-month codes, and what the numbers actually say

**Written:** 2026-08-04 · **Owner:** Brad · **Vehicle:** Evans Software Solutions Ltd
**Asked for:** a plan to offer discounted 3-month subscription codes as a cash transformation
**Found:** the plan works, but not with the mechanism you'd expect — and the burn is
much smaller than the conversation implies.

> ⚠ **Two things in the existing marketing docs are now wrong and both change this
> arithmetic.** Read § 0 before anything else.

---

## 0. Two corrections that move every number

### 0.1 Apple is taking 30%, not 15%

`STATE.md` (superseded note, 2026-08-04):

> **Apple takes 15%, not 25% — SUPERSEDED 2026-08-04: model at 30%.**
> Small Business Program applied for and **NOT approved**. Every net figure in this
> sub-section is ~21% too high.

But `FUNDING_AVENUES.md` § 2 still reads "✅ APPLIED … watch for approval", and
`WEBSITE_PRICING_SPEC.md` § 1 repriced Premium £12.99 → £14.99 *specifically* "because
the Apple Small Business 15% rate was NOT [approved]". So the pricing spec knows and
the funding doc doesn't. **`FUNDING_AVENUES.md` § 2 needs correcting** — it currently
lists a permanent £80/mo margin win that isn't there.

Worth chasing why it was declined. Common causes: the developer account had prior-year
proceeds over $1M attributed to it, an unresolved tax/banking form in App Store
Connect, or the application landing in a window where eligibility is assessed on the
prior calendar year. It's re-appliable, and 15 percentage points is worth an afternoon.

### 0.2 Six of eight AI unit costs are still estimates

`STATE.md` again, and it is blunt about the consequence:

> Only the re-map ($0.0057) and the scan ($0.0272) were measured against real Bedrock
> calls. … **Until then no tier's number is quotable.**

`recipe_extract` on Opus is **$0.0355/call — 55% of Premium's entire worst case and 44×
the cheapest endpoint.** Checkpoint **C5** (the vision-model bake-off, `specs/29`) could
take it to ~$0.007. That's a 5× move in the dominant cost line.

**Why this gates a discount:** a prepaid 3-month block locks a price for 3 months
against a cost base you haven't measured. C5 is a *measurement*, not a build. Run it
before you sell anything discounted, or you may be selling £1 for 80p and finding out
in November.

---

## 1. The burn — what you're actually trying to cover

From `STATE.md`: *"Infrastructure is negligible: ~$185/mo fixed (Supabase/AWS/Expo/
Sentry) plus ~$0.02/user marginal."*

| Line | £/mo |
| --- | --- |
| Fixed infra ($185, Supabase/AWS/Expo/Sentry) | £145 |
| Apple Developer Program (£79/yr) | £7 |
| Companies House confirmation statement (£34/yr) | £3 |
| Domains / misc | £4 |
| **Base burn** | **£159** |
| + accountant, if ~£75/mo | **£234** |

**≈ £1,900–2,800 per year.** *(FX at 0.785; ~$0.02/user marginal is negligible
pre-launch. Trademark self-filing at £170/class is one-off, not burn.)*

This is the single most important number in this document, because it reframes
everything. You are not short of £25,000. **You are short of roughly £200 a month.**

That changes which instruments make sense. A Start Up Loan at 7.5% for £25k against a
£2.4k/yr burn is 10 years of runway you'd be paying interest on from month one. A
Crowdfunder campaign at ~8.9% fees to raise £2k is a lot of public exposure for ten
months of hosting.

### What break-even looks like, at Apple's real 30%

Net per sale = gross × (1 − 30% Apple) − 1% RevenueCat ≈ **69% of gross**.

| To cover £234/mo you need | Count |
| --- | --- |
| Individual Trainer @ £14.99/mo (IAP) | **~23 coaches** |
| Small Business Trainer @ £75/mo (IAP) | **~5 gyms** |
| Medium/Enterprise @ £300/mo (IAP) | **1.1 accounts** |

**One Medium/Enterprise coach account covers the entire business.** That is the whole
strategy in one line, and it argues for effort going into the top of the coach ladder
rather than into discount mechanics at the bottom.

---

## 2. The three rails that can produce cash, priced

| Rail | Cash | Runway | Lands in | New build? |
| --- | --- | --- | --- | --- |
| **A** · 25 × 3-mo offer code, pay-up-front @ £24.99 (IAP) | £431 net | **1.8 mo** | Apple: ~30–45 days after month close | ⚠ Yes — redemption sheet unbuilt |
| **B** · 25 × Individual Trainer **annual** @ £149.99, no discount (IAP) | £2,587 net | **11.1 mo** | Same Apple lag | ✅ None — tier is LIVE |
| **C** · 1 × Medium/Enterprise 3-mo block, 20% off, **manual invoice** | £720 gross | **3.1 mo** | Invoice terms, 7–14 days | Promo entitlement, already specced |
| **C+** · 200-seat B2B pilot @ £5/seat × 3 mo, **manual invoice** | £3,000 gross | **12.8 mo** | Invoice terms | Same |

### Rail A — the thing you asked for, and why I'd not lead with it

App Store **offer codes** do support a pay-up-front type, so "3 months for £24.99
instead of £44.97" is technically buildable, quantity-capped, and IAP-native — no
payment rail, no Guideline 3.1.1 risk on an app already rejected three times.

Three reasons it's the weakest rail:

1. **It raises 1.8 months of runway.** £431 net after Apple's 30%.
2. **It costs you the thing that actually works.** `WAITLIST_AND_FOUNDING_OFFER.md` § 2
   is emphatic that card-on-file is *"the single biggest conversion lever you have"* —
   redemption attaches the Apple Account payment method and Apple bills automatically
   at month 4 with no action from either side. Pay-up-front has **no auto-renew at a
   known price**. You'd be trading a £14.99/mo annuity from 25 coaches for £431 once.
   At even 50% retention that's a worse deal by month 6 and much worse by month 12.
3. **The money is slow anyway.** Apple pays ~30–45 days after the month closes. An
   August redemption is late-September cash. It doesn't solve *this* month.

Plus the build gap: `presentCodeRedemptionSheet` returns nothing across
`packages/mobile` — redemption isn't implemented on either variant. Codes can be
redeemed by URL outside the app as a stopgap, which is the cheap path if you go here.

**Keep the 25 founding codes as 3 months free with card on file.** That's the
conversion engine. Don't cannibalise it for two months of AWS.

### Rail B — the discount you already have, that costs you nothing

Individual Trainer annual is **£149.99** and it is **LIVE**. Selling annual instead of
monthly is a cash transformation with no discount code, no new build, and no margin
concession: **£103 net immediately per coach** versus £10.34/month.

**Two annual coaches clear a month of burn on the day they sign.** Twenty-five clear
eleven months.

Note the open item in `STATE.md`: annual is only 16.7% off monthly (the "2 months free"
formula) where MyFitnessPal runs 58% off. If you want a discount lever for cash, **make
the annual discount deeper** rather than inventing a 3-month SKU. A steeper annual is
the same cash-forward trade, on a product that already exists, with retention attached.

### Rail C — the actual fast cash, and it's already specced

`WEBSITE_PRICING_SPEC.md` § 3: organisation buys seats, invite-code join,
aggregate-anonymised admin dashboard, **manual invoice — no IAP, no card entry in v1.**
Grant via **RevenueCat promotional entitlements** — no card, server-side, no IAP
(already the specced fallback in `WAITLIST_AND_FOUNDING_OFFER.md` § 2).

Why this is the rail for a cash problem:

- **You keep 100%, not 69%.** A 20%-discounted invoice nets you more than an
  undiscounted IAP sale. Discount *and* come out ahead.
- **Cash arrives on your terms**, 7–14 days, not Apple's 45.
- **No payment rail build.** RevenueCat Web Billing is PARKED ("do not execute
  pre-release") and the mobile Stripe branch is unreachable on iOS. Invoicing routes
  around both.
- **Not a consumer contract.** The Consumer Contracts Regulations 2013 14-day
  cancellation right doesn't apply to a B2B sale to a company — one of the reasons a
  prepaid *consumer* block is riskier than a prepaid *business* one.

The one real cost: **no card on file, so month-4 conversion depends on you.** Mitigate
with a written renewal date in the invoice terms and a diarised conversation, not
automation. That's acceptable at the handful-of-relationships scale this operates at.

---

## 3. Recommended plan

**Don't build a discounted 3-month consumer SKU.** Do this instead, in this order:

### Phase 0 — before you quote anyone a price (days, no code)

1. **Run checkpoint C5** — the `recipe_extract` vision-model bake-off. One measurement;
   potentially a 5× move in your dominant cost. Then C2 (measure the other estimated
   unit costs from `ai_usage_log` or the AWS bill).
2. **Re-apply to the Apple Small Business Program**, and find out why it was declined.
   15 points of margin is worth more than any discount scheme below.
3. **Check SES production access.** `WAITLIST_AND_FOUNDING_OFFER.md` § 8 flags this as
   unverified and it's a hard blocker — in sandbox, nobody can confirm a signup email
   and no invoice or onboarding sequence works. ~24h to approve.
4. **Correct `FUNDING_AVENUES.md` § 2** so the 15% assumption stops propagating.

### Phase 1 — the cash product (one small build, invoice rail)

Build the **3-month prepaid block as a B2B invoice product**, not an App Store code:

| Element | Spec |
| --- | --- |
| Tiers offered | Small Business Trainer (£225/3mo) and Medium/Enterprise (£900/3mo) |
| Discount | **20% for prepaying the quarter** → £180 / £720, all retained |
| Grant mechanism | RevenueCat **promotional entitlement**, 3-month expiry, server-side |
| Payment | PDF invoice, bank transfer, 14-day terms |
| Renewal | Written renewal date in terms + calendar reminder. No auto-renew |
| Contract | Named counterparty is a **company**, not a consumer |
| Refund clause | Pro-rata refund if the app isn't live by a stated date — this is what makes it honest to sell pre-approval |

### Phase 2 — the free lever

Push **annual** on every coach conversation. £103 net up front vs £10.34/mo. Consider
deepening the annual discount toward the market norm; that is your cash-forward
mechanism and it needs no new code.

### Phase 3 — keep the founding programme intact

25 founding coaches, **3 months free, card on file**, price held while continuously
subscribed (24-month minimum, per § 7 decision 1). Build
`presentCodeRedemptionSheet` — it's still the gap that blocks promising codes to
anyone.

---

## 4. What gates all of this

Three things, none of which cost money, all of which block cash:

1. **App Review approval.** Build 39 rejected under Guideline 4; PR #340 fixes it.
   Ship the #337 SQLSTATE hotfix in the same release — resubmitting on top of a
   production a reviewer already tripped an error on is inviting rejection four.
2. **Kurtis's signature.** Taking money is unambiguous commercial activity under
   **clause 4.2(a)**. An invoice is less *public* than a Crowdfunder page but more
   *concrete*: a named counterparty, a contract, a bank transfer into ESS. It gates
   every rail here, including Rail C. The letter is the cheapest thing on this page
   and it unlocks the most.
3. **C5 / unit costs.** `STATE.md`'s own words: until measured, *"no tier's number is
   quotable."* A prepaid discounted block is a quote with a 3-month lock on it.

---

## 5. The honest summary

The burn is **~£200/month**. The 3-month discounted code scheme you asked for raises
**1.8 months** of that, arrives in late September, needs an unbuilt redemption sheet,
and costs you the card-on-file conversion that makes the founding programme worth
running.

The same effort spent on **annual subscriptions** (no discount, no build, £103 net each)
or **one invoiced enterprise coach account** (£300/mo gross, covers the whole business
on its own) produces between 3× and 11× the cash, sooner.

The discount code isn't the wrong idea — the wrong part is aiming it at 25 individual
coaches through Apple. Aim it at gyms, clinics and teams through an invoice, and it
becomes the best rail you have.

---

## Open questions for you

1. Did the Small Business Program decline come with a reason in App Store Connect?
2. Is there an existing accountant cost, or is £75/mo a placeholder in the burn table?
3. Is the £185/mo infra figure current, or from before the Mealprint merge and the
   monitoring build-out in `infra/monitoring.ts`?
4. Do you have any warm gym / clinic / university contacts? Rail C needs one
   relationship, not a funnel — and one is worth more than all 25 codes.

**Sources:** `STATE.md` (burn figure, Apple 30% supersede, unit-cost warning, App Store
rejection) · `marketing/WAITLIST_AND_FOUNDING_OFFER.md` (offer-code mechanics, build
gap, SES sandbox) · `marketing/WEBSITE_PRICING_SPEC.md` (tier prices, B2B invoice spec)
· `marketing/FUNDING_AVENUES.md` (needs the § 2 correction) ·
`specs/29-subscription-restructure/` (C5, C2 checkpoints)
