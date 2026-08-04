# Non-dilutive funding avenues — Persistence

**Written:** 2026-07-25 · **Owner:** Brad · **Constraint:** no equity given away
**Vehicle:** Evans Software Solutions Ltd

> ⚠ **Verify before acting.** This was written without web access, so every
> scheme name, rate, threshold and deadline below is from general knowledge and
> needs confirming against the current official source. Treat the *ranking and
> reasoning* as the deliverable; treat the *numbers* as prompts to go and check.
> I am not a financial or legal adviser.

---

## The ranking, and why

Ordered by expected value per hour of your time, not by headline size.

### 1. RevenueCat Shipaton — already in flight, protect it

$50k Grand Prize plus category awards (HAMM for monetisation, Design,
#BuildInPublic). Registered on Devpost 2026-07-20. Full plan in
`SHIPATON_2026_PLAN.md`.

Why it tops the list: the work it rewards — launch, traction, build-in-public
content — is work you were doing anyway. It is the only avenue here where the
funding effort and the business effort are the *same* effort.

**Actions**

- [x] Release set to **Manual** in App Store Connect (confirmed 2026-07-25)
- [ ] Re-read the full official rules once published — they were pending as of
      the plan's writing. Check demo-video length, RC project-id fields, region
      and solo-entrant eligibility
- [ ] Do not release publicly before 1 Aug. This is the whole ballgame
- [ ] Start the #BuildInPublic cadence 1 Aug (prize category *and* growth channel)
- [ ] Weekly RevenueCat metric capture from 1 Aug — the Grand Prize is judged on
      post-release traction, so the evidence has to be collected as it happens

### 2. Apple Small Business Program — ✅ APPLIED (Brad, 2026-07-25)

Commission drops 30% → 15% under $1M/yr. **Applied — confirmed by Brad
2026-07-25.** Watch for the approval confirmation in App Store Connect, and note
the reduced rate applies from the start of the month after approval, so check the
effective date rather than assuming it's live at launch.

This is a permanent 15-percentage-point margin improvement on every pound of IAP
revenue you will ever earn at this scale. On the playbook's own worked example
(~£544 MRR from 20 trainers) it is worth roughly £80/mo from day one and scales
linearly. No dilution, no repayment, no application narrative — just a form.
Approval isn't instant, which is why it matters that it's still open six days
before your release window.

**Remaining action:** none beyond confirming approval landed.

### 3. B2B pilot revenue — the largest single cheque available pre-revenue

`WEBSITE_PRICING_SPEC.md` § 3 already specs this: organisation buys seats,
invite-code join, aggregate-anonymised admin dashboard only, **manual invoice —
no IAP, no card entry in v1**. Target audiences: corporate/employer wellness,
physios and clinics, universities and sports teams.

Two things make this the strongest genuine funding avenue after the two above:

- **No payment rail needed.** Manual invoicing sidesteps the entire parked
  Web Billing question. You can close a pilot with a PDF invoice and a bank
  transfer.
- **The anonymised-only dashboard is a real differentiator**, not a limitation.
  It is what makes you sellable to a UK employer with a works council or a
  clinic under GDPR. Lead with it.

Seat price is £4–6/mo **TBC** (§ 3). A 200-seat corporate pilot at £5 is
£1,000/mo — more than the entire trainer flywheel's month-1 target, from one
relationship.

**Actions**

- [ ] Lock the seat price, or decide it's quoted per deal — note the channel
      pricing problem in `EB_CHANNEL_ANGLES.md` § 5 before fixing a number
- [ ] Confirm the aggregate dashboard's minimum cohort suppression threshold —
      it's the first question a works council asks
- [ ] Outreach drafts are in `OUTREACH_BATCH_01.md` § C

**Reaching these employers via intermediaries:** benefits brokers, flex platforms
and wellbeing marketplaces are the distribution route into this segment — see
`EB_CHANNEL_ANGLES.md` for the channel map, the readiness gap (DPIA, Cyber
Essentials, Art. 9 basis) and realistic timing. Earliest plausible revenue there
is Q1 2027, so it supports item 3 rather than replacing it.

### 4. Start Up Loans (British Business Bank)

Up to £25k per founder, unsecured, government-backed, fixed rate around 6%, 1–5
year term, plus 12 months' free mentoring. **Verify current terms.**

Best-value capital available to a pre-revenue solo founder, and it doesn't touch
your cap table. Two caveats worth being clear-eyed about: it is a **personal**
liability regardless of the Ltd, and the application wants a business plan and
cash-flow forecast — a real week of work, not an afternoon.

**Action:** decide whether you actually need £25k. If the remaining spend to
launch is EAS build minutes, a domain and an email tool, you may not — and taking
on personal debt you don't need is the wrong trade.

### 5. R&D tax relief

Genuinely applicable rather than a stretch. Candidate qualifying work, all
already specced:

- `specs/15-exercise-ai-classification` — AI exercise classification
- `specs/21-adaptive-workout-ai` — adaptive generation, equipment-aware (Loadout)
- `specs/26-mealprint-meal-planning` — constraint-satisfaction meal planning
- Offline-first SQLite sync architecture (`CLAUDE.md` § Migration intent)

Claimed through Evans Software Solutions Ltd after the accounting period ends, so
this is a retrospective cash recovery on money already spent, not launch funding.
UK R&D relief rules changed materially across recent years — get an accountant
who does software claims specifically. Document the *technical uncertainty* as
you go; that's what claims turn on, and your specs are unusually good evidence
already.

### 6. Founding coach revenue

25 × £14.99 ≈ £375/mo gross once the free period ends, ~£319 after Apple at 15%.
Modest as funding. The point isn't the cash — it's that each coach brings 10–40
client installs at £0 CAC (`LAUNCH_PLAYBOOK.md` § 4). Count it as distribution
that happens to pay for itself.

### 7. Grants — start now, expect nothing soon

Innovate UK Smart Grants (competitive, needs genuine novelty and a several-week
application), your regional Growth Hub for smaller awards, King's Trust
Enterprise if age-eligible. Run in parallel; never build a plan that depends on
one landing.

### 8. Revenue-based finance — post-launch only

Uncapped, Outfund and similar typically want £10k+/mo recurring revenue. Repay a
percentage of revenue, no equity, no personal guarantee in some structures.
Realistically a 2027 conversation. Worth knowing exists so you don't reach for
equity at the first cash squeeze.

---

## Explicitly not recommended

| Avenue | Why not |
| --- | --- |
| **Reward crowdfunding** (Kickstarter/Indiegogo) | Built for physical products; app campaigns need a pre-existing audience the platform won't give you. All-or-nothing, ~5% + processing, and unfulfilled rewards are a refundable liability. Your effort converts better as coach outreach. |
| **Equity crowdfunding** (Crowdcube/Seedrs) | Gives away exactly what you said you don't want to give away, and drags in FCA financial-promotion rules. |
| **Paid ads before the gate** | `LAUNCH_PLAYBOOK.md` § 7 sets the gate at ~£500 MRR and ≥30% trial→paid. Paid traffic amplifies a broken funnel as happily as a working one. |
| **Anything requiring an early public release** | Costs you Shipaton. Nothing on this page is worth that. |

---

## Sequenced plan

| When | Do |
| --- | --- |
| **This week (to 31 Jul)** | Apple Small Business Program application. Re-read Shipaton rules. Waitlist page live. Coach outreach batch 1 sent. Offer-code redemption built. Release stays Manual. |
| **1 Aug** | Public release. Devpost project created. #BuildInPublic starts. Founding codes issued. |
| **Aug–Sep** | Traction push inside the judging window. Weekly RC metrics. First B2B pilot conversations. Submit by 30 Sep. |
| **Oct** | Shipaton results (21 Oct). Assess whether Start Up Loans is needed on real numbers rather than guesses. |
| **Nov–Dec** | First founding renewals. R&D relief conversation with an accountant at period end. |
| **2027** | Revenue-based finance if growth justifies it. Android/web rail decision unparks the Web Billing question. |

---

## Two structural risks worth naming

**Employment.** You are employed at a payments company and building a subscription
app with in-app payments. Read your contract's IP-assignment and
outside-business clauses before you take money from anyone or put your name to
public fundraising. Also: run none of this from the work email — every outreach
address should be `admin@evans-software-solutions.com` or similar.

**Concentration.** Items 1 and 2 are worth more than 3–8 combined and both hinge
on decisions in App Store Connect in the next six days. That's a good position to
be in, but it means the downside of one careless click is larger than the upside
of any grant application you could start today.
