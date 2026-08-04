# Website Pricing & Features — Source of Truth

> ## ⚠ UNDER RESTRUCTURE (2026-08-04) — read `STATE.md` § "TIER + PRICING
> ## RESTRUCTURE" before quoting anything here
>
> Brad reopened the tier model to settle how the adaptive suite (Loadout, Mealprint,
> the coming programme import and AI workout generation) is priced across athlete
> and coach personas. **Nothing is purchasable yet — no ASC products are live — so
> every number here can still change with zero grandfathering.** That window closes
> at launch.
>
> Decided: coaches get Mealprint; the suite stays Premium+-only on the consumer
> track; AI ceilings become a TOTAL per-user cost budget (a backend fail-safe, never
> an advertised quota); programme import lands on athlete Premium+ as well as the
> coach tiers; `individual_trainer` displays as "Start Up Coach" (⚠ display_name
> only — the tier_name is a RevenueCat entitlement id).
>
> Proposed but NOT signed off: the coach ladder below is being rebuilt to close the
> 2 → 30 client gap, and the £14.99 entry tier is being SPLIT into a cheap
> pure-coach tier and a suite-bearing one. Until Brad signs off, § 1 and § 2 below
> describe the OLD model.

**Written:** 2026-07-16 · **Owner:** Brad · **Purpose:** the single reference for
pricing, tiers and feature copy on the marketing site.

> **BUILD STATUS (2026-07-17):** SHIPPED to `packages/web` — `/pricing` renders
> these tiers (Free/Premium live, Premium+ "Coming soon"), plus `/` landing and
> `/support` (PR #261, merged to `main`). Per Brad's hard exclusion, the
> **founding-waitlist / early-bird-discount is NOT on the site** (reviewed
> separately). App-Store purchase CTAs render as non-linking "Coming to the App
> Store" until launch (`packages/web/src/marketing/config.ts` › `appStore`).

Figures marked **LIVE** are seeded in the DB catalog today
(`packages/db/src/schema.ts` → `subscription_tiers`, set by migration
`20260526120000_simplify_tier_model.sql`). Figures marked **LAUNCH** are
confirmed by Brad for the w/c 17 Aug 2026 launch but not yet built. Anything
marked **TBC** is an open decision (see §6).

**Currency:** GBP (£) — the DB default (`subscription_tiers.currency = 'GBP'`).
**Billing cadence:** every paid tier offers monthly and annual; annual ≈ 2 months
free (10× monthly).

---

## 1. Consumer plans

| Plan | Monthly | Annual | Status |
| --- | --- | --- | --- |
| Free | £0 | — | LIVE |
| Premium | £12.99 | £129.99 | LIVE |
| Premium+ | £29.99 | £299.99 | LAUNCH |

### What each plan includes — aligned to the shipped site (updated 2026-07-17)

> Matches the copy shipped on `/pricing` (PR #265). The earlier "3 free AI
> workout generations" taster was **dropped** — Free now offers **3 Custom
> Workouts** (a real cap, not an AI pool). Smart-swap moved to Premium; Premium+
> leads on "AI Workout Suggestions". **This supersedes §6.1 and the taster copy
> in §7 below.**

**Free**

- Full workout & set logging
- Nutrition tracking & barcode scanner
- Streaks, PRs & core progress
- **3 Custom Workouts** (cap)

**Premium — £12.99/mo**

- Everything in Free, plus
- Unlimited workouts & history
- Photo & free-text AI nutrition logging
- Smart swap suggestions

**Premium+ — £29.99/mo** — the athlete flagship (shown "Coming soon"; phase 2 ≈ Aug 2026)

> ⚠ **"AI Workout Suggestions" must come OFF this card until it exists.** There is
> no workout-generation path anywhere in the codebase: the `ai_workout` entitlement
> is a stub returning `{allowed: true}` and `subscription_tiers.ai_workout_limit`
> (0/6/30) is dead data, gated by nothing and rendered nowhere. The in-app paywall
> is already clean — `getFeaturesList` prints only real features — so this site card
> is the LAST surface still selling it, and the tier-description migration
> (`20260725194527`) could not reach it. Brad 2026-08-04: it is a future Premium+
> addition built on Loadout + Mealprint, and the justification for a later price
> rise. Lead on Loadout and Mealprint, which are real.

- Everything in Premium, plus the adaptive suite:
  - ~~**AI Workout Suggestions**~~ ⚠ UNBUILT — remove from the site
  - **Loadout equipment scan** — equipment-aware programming
  - **Mealprint meal planning** — food plans & fill-your-macros ideas
  - Program import

> **Positioning note:** the "scan-your-gym → AI builds a workout that fits it"
> story is a deliberately hard Premium+ gate. Diverges from the earlier
> GTM-Expansion proposal (which gave Premium 10/day generation + scan) — the
> site follows this spec, not that table.

> **REPRICED + AnyMeal added (Brad, 2026-07-24):** Premium+ moved £19.99 →
> **£29.99/mo · £299.99/yr** on the strength of the two-hero suite (spec-26
> Mealprint joins Loadout). Market basis: AI-programming apps alone sit at
> $29.99–34.99/mo (Ladder, Juggernaut AI); MyFitnessPal's meal-planning tier is
> $24.99/mo; Premium+ spans tracking + AI training + AI meal planning. Changed
> while Premium+ is non-purchasable (no ASC products, no catalog row) — zero
> grandfathering. **No free taster** (supersedes § 6.1 and the § 7 taster copy
> below a second time): the hard gate stands; time-boxed promotions run through
> RevenueCat promotional entitlements instead. Site updated same day
> (`Pricing.tsx`, `Support.tsx`).

---

## 2. Coach plans

Trainer tiers in the LIVE catalog (`is_trainer_tier = true`). All include the AI
buddy for client insights and trainer analytics.

| Plan | Monthly | Annual | Clients | Status |
| --- | --- | --- | --- | --- |
| Individual Trainer | £14.99 | £149.99 | up to 2 | LIVE |
| Small Business Trainer | £75 | £750 | up to 30 | LIVE |
| Medium / Enterprise Trainer | £300 | £3,000 | up to 500 | LIVE |

> **Two flags before these go on a page:**
> 1. The bracket is **2 / 30 / 500**, not the "10 / 30 / unlimited" sketch. If we
>    want different public numbers, the catalog descriptions need updating too.
> 2. ~~The client-limit cap is currently **unenforced in the app**
>    (`trainersAcceptInviteCodeHandler.ts` never checks it) — a known revenue
>    leak.~~ **STALE — corrected 2026-07-25.** The cap **is enforced**:
>    `microservices/core/src/application/trainers/seats/trainerSeats.ts` gates
>    seat allocation against `subscription_tiers.trainer_client_limit` and
>    dispatches a `trainer_client_limit_reached` notification with an upgrade
>    pointer; `entitlement/assertEntitlement.ts` computes the effective limit
>    including the cancelled/expired revert to the free tier. Confirmed by
>    `STATE.md` line 164 and by the tests in
>    `trainers/seats/__tests__/trainerSeats.test.ts`. The brackets are safe to
>    advertise as hard limits.

---

## 3. B2B / Teams

**Status:** specced, builds post-launch on the first real pilot conversation.

**Target audiences on the site (Brad, 2026-07-16):**
- Corporate / employer wellness
- Physios / clinics
- Universities / sports teams

*(PT studios & gyms were considered and dropped from the B2B pitch — coaches are
served by the Coach plans in §2.)*

**How it works:**
- Organisation buys seats; employees/members join via an invite code
- Each seat grants a real catalog tier (Premium **or** Premium+) per contract
- Admin dashboard is **aggregate and anonymised only** — no individual member
  health data, ever (GDPR / works-council safe); metrics suppressed below a
  minimum cohort size
- Default programme templates included ("works out of the box")
- **Billing is manual invoice** — no in-app purchase, no card entry in v1

**Seat pricing:** **£4–6 / seat / month is a starting point only (TBC)** — not
locked. Priced separately from consumer tiers.

---

## 4. Founding offer

**Status: TBC — possibly display on the homepage** (Brad wants to review the
detail first).

Current definition (from `marketing/LAUNCH_PLAYBOOK.md`), trainer-focused:
- First **25** founding coaches
- **3 months free** on Individual Trainer
- **Founding price locked for life** thereafter
- Credit in the app's "Founding Coaches" list + a direct line to the founder

Decision needed: show it on the homepage as-is, show it as a "founding wave —
limited spots" teaser, add a consumer-side founding/early-bird deal, or keep it
to direct outreach only.

---

## 5. Equipment-adaptive feature name

**Status: DECIDED 2026-07-24 — "Loadout" + "Mealprint" (see the FINAL DECISION
block at the end of this section). Original assessment kept for the record.** Working candidates and assessment (needs a live App Store +
UK IPO trademark + domain check to confirm — not yet run):

| Candidate | Read |
| --- | --- |
| Adapt | Strong word, weak to own — generic, widely used in fitness, hard to trademark |
| **AnyGym** | Recommended — on-message, distinctive as one word, consumer-friendly |
| Kit-Aware | Most unique/ownable + nicely British, but reads as a descriptor not a hero brand |

Recommendation: a coined hero name (lead candidate **AnyGym**) with
"equipment-aware programming" as the plain-English descriptor beneath it. Verify
availability before committing, and use the same name consistently across app,
site and marketing.

**Availability check run 2026-07-24 (web-level, not a formal IPO search) —
Brad confirmed both names, risk noted:**

- **AnyGym** 🟠 — **AnyGym Ltd exists**: a UK company (founded 2016,
  any-gym.com, LinkedIn presence) selling pay-as-you-go access to UK gyms.
  Same country, same industry sector, different product (access marketplace vs
  a software feature). No registered UK trade mark surfaced in web searches,
  but the search was inconclusive — this is the collision that matters.
- **AnyMeal** 🟡 — an **"AnyMeal — Food Diary" app exists on the App Store**
  (id 6473067335, nutrition category); plus an old open-source recipe tool of
  the same name. No trade-mark registration surfaced.
- **Mitigations:** both are used as *in-app feature names* under the
  Persistence house mark ("Persistence AnyGym"), not standalone app names —
  materially lower risk than a competing app title. Before spending real
  marketing money on either name, run the formal checks this section already
  calls for: UK IPO trade-mark search (classes 9/41/42/44), Companies House,
  and domain/social handles. If AnyGym Ltd proves to hold a registered mark,
  the fallback candidate remains "Kit-Aware" (above) and the AnyMeal sibling
  would rename in sympathy.

**FINAL DECISION (Brad, 2026-07-24, same day): both names RETIRED and
replaced — the features are now "Loadout" (equipment-adaptive training) and
"Mealprint" (meal planning).** Vetting basis: "Loadout" — no fitness app, gym
brand or UK company found; residual: a lapsed-looking 2013 US mark for a dead
video game and YETI's "LoadOut" bucket line (different goods). "Mealprint" —
no app or company found (nearest: Nutrino's "Foodprint", a different word).
Rejected en route: GymForge (existing tracker + an equipment-aware AI builder
app), Gymsmith (HypertroFit home-gym planner + 2021 US mark), all -Forge/-Fit
compounds (crowded). Both used as in-app feature names under the Persistence
house mark; ™ from day 1. Brad to run the free UK IPO word-mark searches
(classes 9/41/42/44) and optionally self-file (£170/class, or Right Start
£200) before marketing spend. Site, specs and tests renamed 2026-07-24 (tests
now assert the old names never resurface).

---

## 6. Open decisions

> ⚠ **6.1 and § 7 below are DEAD.** The free taster was dropped on 2026-07-17 and
> killed again on 2026-07-24 ("No free taster … the hard gate stands"), and spec-21
> AC-9.3 plus spec-26 locked decision 4 both record it as settled. **No taster code
> was ever written** — `AI_FREE_TASTER_LIMIT` and the `ai_taster` entitlement exist
> in no source file. The § 7 copy also still says "AnyGym", retired 2026-07-24.
> Kept for history only; do not build or publish either.

1. ~~**Free taster — DECIDED (2026-07-16):**~~ **DEAD — see the banner above.** Free keeps a one-time pool of **3 AI
   workout generations** (scan → generate), used as the conversion hook into
   Premium+. Copy in §7. Ceiling is env-tunable (`AI_FREE_TASTER_LIMIT`, default
   3) if the number needs to change.
2. **Smart-swap gating** — v1 smart swap is a cheap deterministic ranker (no AI
   cost). Gating it to Premium+ is a positioning choice, not a cost one — confirm
   it stays Premium+ only vs. a free/Premium value-add.
3. **Coach brackets** — keep the LIVE 2 / 30 / 500 numbers, or change them (and
   the catalog copy) for the site?
4. **Founding offer** — homepage treatment (§4).
5. **B2B seat price** — confirm the per-seat figure for the sales page (§3).
6. **Feature name** — final pick + availability check (§5).

---

## 7. Free-taster copy (for the site)

The taster is what makes the AnyGym hero moment reachable before anyone pays, so
it earns real estate — it's a conversion surface, not a footnote.

**On the Free plan card:**
> Includes 3 free AI workout generations — scan your gym and let AnyGym build
> your first sessions. Keep going with Premium+.

**On the Premium+ card (reinforces the upgrade):**
> Unlimited beyond the free taster — daily AI workout generation, equipment
> scan, smart swaps and program import.

**Hero / homepage CTA (near the AnyGym pitch):**
> Scan your gym. Get a workout that fits it. Try 3 free — no card needed.

**In-app upgrade prompt when the taster runs out (mirror on the site FAQ):**
> You've used your 3 free generations. Go Premium+ for daily AI workouts built
> around your equipment.

Placement: Free plan card + Premium+ card on the pricing page, and once in the
homepage hero beside the AnyGym feature. Keep the "no card needed" line — it's
the friction remover that drives day-0 trial starts.
