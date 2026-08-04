# Crowdfunder.co.uk — assessment for Persistence

**Written:** 2026-08-04 · **Owner:** Brad · **Vehicle:** Evans Software Solutions Ltd
**Question asked:** can Crowdfunder fund day-to-day running costs right now?
**Answer:** No — and two of the three reasons are risks, not just poor fit. There is a
version of this that works, but it is a launch-marketing exercise in ~6 weeks' time,
not a cash-flow fix this month.

> Numbers below were checked against crowdfunder.co.uk and startuploans.co.uk on
> 2026-08-04. Where they contradict `FUNDING_AVENUES.md` (written 2026-07-25 without
> web access), this file wins. Not financial or legal advice.

---

## 1. What Crowdfunder actually is — verified

| | |
| --- | --- |
| Model | **Rewards and donation only.** Not equity, not loan. Equity crowdfunding is Crowdcube/Seedrs, a different regulatory world. |
| Target discipline | **Keep-what-you-raise.** No all-or-nothing threshold. ⚠ This corrects `FUNDING_AVENUES.md`, which said all-or-nothing — true of Kickstarter, not of Crowdfunder. |
| Platform fee, for-profit business | **5%** |
| Platform fee, charity / not-for-profit / community / sports club | **0%** |
| Transaction fee | **2.4% + 20p** per pledge (UK/EEA cards); 3.25% + 25p non-EEA |
| VAT | **20% added on top of the fee total** |
| **All-in cost to ESS** | **≈ 8.9% + 24p per pledge** (5% + 2.4%, +20% VAT on both) |
| Match funding | 0–5% additional fee on matched funds |

### The match funding is closed to you, and that's the part that mattered

Match funding is the only mechanism where a crowdfunding campaign returns more than
the crowd puts in — and it is the only reason a platform fee is ever worth paying.
Crowdfunder's page is explicit that **for-profit businesses are not eligible**.
Eligible: charities, not-for-profits and CICs, community projects, sports clubs.

Currently open, for reference:

- **Aviva Communities Fund** — up to £25,000 extra per project (climate action or
  financial resilience)
- **Sport England Movement Fund** — up to £15,000 extra per project (improving
  physical activity opportunities in your community)
- **BA Better World Community Fund** — fully allocated

The Sport England fund is painfully close to Persistence's subject matter. It is out
of reach because ESS is a for-profit Ltd, and restructuring to a CIC to chase £15k
would mean giving up the thing you built the company to do. Noted so it's a closed
question rather than an open one.

**Net:** without match funding, Crowdfunder is a payment-collection page that charges
you ~8.9% to collect money from people you would have to find yourself.

---

## 2. Three reasons not now

### 2.1 You cannot make the promise the format requires

Rewards crowdfunding is structurally a **public, dated promise**: here is what you get,
here is when. As of today:

- Build 1.0 (39) was **rejected under Guideline 4 (Design)** — app-drawn Sign in with
  Apple logo artwork. Fix is on PR #340, needs merge → new build → resubmission.
- That is the **third** rejection (2.1 PassKit, 4.0 Apple logo, 4 Design).
- The approval date is **not yours to set.** It's Apple's.

So the delivery date would be a guess, made publicly, under your own name, on a
product with a three-rejection history. `WAITLIST_AND_FOUNDING_OFFER.md` § 1 already
reasoned to the same conclusion for a paid pre-sale and chose a free waitlist instead —
that reasoning has got *stronger* since 25 July, not weaker.

There is also a consumer-law tail: pledges for access to an unreleased digital service
are advance payments. Under the Consumer Contracts Regulations 2013 backers get a
14-day cancellation right, and a slipped delivery date makes the rest refundable on
demand. Money you have already spent on hosting is money you may have to give back.

### 2.2 The Capital Pay letter is still unsigned

This is the one that would actually hurt. As at 3 August the consent letter is at
**v5**, with Kurtis Dinnall-Bateman, unsigned.

A Crowdfunder page is the most visible and most permanent form of outside commercial
activity available to you — Google-indexed, in your name, naming ESS, making revenue
and delivery claims, timestamped. **Clause 4.2(a)** requires prior written approval.
Publishing that page before Kurtis signs:

- hands Capital Pay a documented, dated breach
- destroys your position in a negotiation you are two rounds of feedback into
- and it does so in public, where it cannot be walked back

`FUNDING_AVENUES.md` § "Two structural risks" already called this exactly: *"read your
contract's outside-business clauses before you take money from anyone or put your name
to public fundraising."* Nothing has changed except that the letter is closer to done —
which makes waiting cheaper, not more expensive.

### 2.3 Aug 1 was the start of the window, not the end of it

Worth stating plainly, because it changes the whole picture: **Shipaton is still live.**

`SHIPATON_2026_PLAN.md` requires the first public store release to fall **between 1 Aug
and 30 Sep 2026**, submission by 30 Sep. The 1 Aug date was the *earliest permitted*
release, not a deadline you missed. Being unreleased on 4 August costs you nothing in
eligibility terms.

What it costs is **runway inside the judging window** — the Grand Prize is judged on
post-release traction, so every day unreleased is a day of evidence you can't collect.
At $50k, Shipaton remains worth more than every other avenue on the list combined, and
the clock on it is the real deadline. Time spent building a Crowdfunder campaign is time
taken from the highest-value thing available to you.

---

## 3. What actually addresses the cash problem

The reframe: this is not a funding problem, it's a **launch** problem. Every avenue that
pays real money — Shipaton, B2B pilots, founding coaches, a Start Up Loan on real
numbers — is gated on the app being live. Three rejections is the emergency; the hosting
bill is the symptom.

### This week — no one's permission required

1. **Merge PR #340, cut a release, resubmit.** The release also ships PR #337, the
   SQLSTATE 23514 session-rating hotfix that is merged but unreleased — an Apple
   reviewer tripped a production Sentry error on 2026-07-30 while prod was unpatched.
   Resubmitting on top of a known-broken production is asking for rejection four.
2. **Quantify the burn.** "Struggling with day-to-day costs" needs a number before it
   needs funding. The AWS/SST estate is where it lives: staging is a separate AWS
   account, `infra/monitoring.ts` is 27KB of alarms and dashboards (CloudWatch bills
   per metric and per alarm), plus `jobs.ts`, and there's a 7.6GB `food.parquet` — check
   whether that's also sitting in S3.
3. **AWS Activate credits.** Self-funded startups can claim credits (typically
   $1k–$5k). Free, no consent needed, applies to the exact bill that's hurting.
   Worth checking the current tiers on the AWS Activate page.
4. **Confirm the Apple Small Business Program approval landed** — applied 25 July. 30% →
   15% commission is a permanent margin change and it's the highest-return form already
   filled in.

Cutting £150/mo off an AWS bill is worth more than raising £1,500 once, because it
compounds and costs nothing but an afternoon.

### Then, in sequence

| When | What |
| --- | --- |
| **Now → 30 Sep** | Release. Shipaton traction push. Submit by 30 Sep. |
| **Aug onward** | B2B pilot conversations — `FUNDING_AVENUES.md` § 3. Manual invoice, no payment rail needed, 200 seats × £5 = £1,000/mo from one relationship. Still the largest realistic pre-revenue cheque. |
| **Launch** | Founding coach revenue via App Store offer codes (⚠ redemption still unbuilt — `presentCodeRedemptionSheet` returns nothing in `packages/mobile`). |
| **Oct** | Start Up Loan decision on real numbers. **Verified terms: up to £25k, 7.5% fixed** (⚠ `FUNDING_AVENUES.md` guessed ~6% — it's 7.5%), 1–5 year term, no arrangement or early-repayment fee, trading under 60 months (ESS incorporated 1 Jan 2026, comfortably inside), 12 months' free mentoring. It is a **personal** liability regardless of the Ltd. |

---

## 4. When Crowdfunder *does* become worth doing

Not never — just not as a cash-flow rescue. It becomes a reasonable idea when all four
of these are true:

1. The app is **approved and live** on the App Store, so the delivery promise is "you
   get access now", not "you get access when Apple says so".
2. The **consent letter is signed** by Kurtis.
3. Shipaton is **submitted** (30 Sep) so the campaign isn't competing for your hours.
4. You have a **list to point at it** — the free waitlist, coaches, build-in-public
   followers. Crowdfunder supplies a payment page, not an audience. The founder's own
   network reliably provides the first chunk of any rewards campaign, and if you don't
   have one, the campaign is a public record of a small raise.

Run that way it's a **launch event that happens to raise money**: target £3–5k, rewards
are founding memberships and lifetime tiers, keep-what-you-raise means missing target
costs you nothing but fees and pride. The value is the launch-day attention and the
press angle, with the cash as a bonus.

One caveat even then: for founding memberships specifically, **App Store offer codes
are the cheaper rail** — already specced in `WAITLIST_AND_FOUNDING_OFFER.md` § 2,
quantity-capped, card-on-file so month-4 conversion actually happens, and no 8.9%
platform haircut on top of Apple's 15%. Use Crowdfunder for the *story* and reach; use
offer codes for the *money*.

---

## 5. The uncomfortable summary

For a pre-revenue side project with an unreleased app and an unsigned employment
consent letter, the cheapest capital available is a trimmed AWS bill plus your salary.
A campaign that raises £800 from your own network at a 9% haircut is worse than putting
£800 in yourself, and personal debt at 7.5% against a product you are not yet
contractually permitted to launch is a liability with nothing to service it.

**The critical path is one signature and one App Review approval.** Neither costs money.
Both unblock everything else on this page.

---

## Corrections to `FUNDING_AVENUES.md` (2026-07-25)

That file flagged its own numbers as unverified. Now verified:

- ❌ "Reward crowdfunding … All-or-nothing" → **Crowdfunder UK is keep-what-you-raise.**
  (Kickstarter is all-or-nothing; the two got conflated.)
- ❌ "~5% + processing" → **5% + 2.4% + 20p, plus 20% VAT on the fees ≈ 8.9% + 24p.**
- ➕ New: **match funding excludes for-profit businesses** — worth adding, because it's
  the reason the platform fee can't be justified.
- ❌ Start Up Loans "fixed rate around 6%" → **7.5% fixed.**
- ✅ Start Up Loans "up to £25k, 1–5 year term, 12 months' free mentoring, personal
  liability" — all confirmed. Trading-period limit is **under 60 months**.
- ✅ The overall recommendation against reward crowdfunding — confirmed, on stronger
  grounds than the original reasoning.

**Sources:** [Crowdfunder fees](https://www.crowdfunder.co.uk/fees) ·
[Crowdfunder funds & match funding](https://www.crowdfunder.co.uk/funds) ·
[Crowdfunder for business](https://www.crowdfunder.co.uk/start-business) ·
[Start Up Loans](https://www.startuploans.co.uk/)
