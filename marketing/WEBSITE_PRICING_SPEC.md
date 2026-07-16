# Website Pricing & Features — Source of Truth

**Written:** 2026-07-16 · **Owner:** Brad · **Purpose:** the single reference for
pricing, tiers and feature copy on the marketing site.

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
| Premium+ | £19.99 | £199.99 | LAUNCH |

### What each plan includes (per Brad's gating, 2026-07-16)

**Free**
- Workout tracking, capped at 3 workouts
- No ongoing AI features
- **Free taster: 3 AI workout generations** (scan → generate, one-time pool) — the
  conversion hook into Premium+. See the taster copy in §7.

**Premium — £12.99/mo**
- Unlimited workouts
- Advanced analytics + data export
- **Existing AI only:** AI gym buddy, AI nutrition / Snap AI, AI summaries
- Does **not** include the adaptive workout suite

**Premium+ — £19.99/mo** — the athlete tier
- Everything in Premium, plus the **entire adaptive suite, exclusively:**
  - AI workout generation
  - Equipment scan / equipment-aware programming *(feature name TBC — see §5)*
  - Smart swap suggestions
  - Program import

> **Positioning note:** this is a deliberately hard gate. The whole
> "scan-your-gym → AI builds a workout that fits it" story lives in Premium+.
> This diverges from the earlier GTM-Expansion proposal, which had given Premium
> 10/day generation + scan; the site should follow this spec, not that table.

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
> 2. The client-limit cap is currently **unenforced in the app**
>    (`trainersAcceptInviteCodeHandler.ts` never checks it) — a known revenue
>    leak. Worth fixing before we advertise the brackets as hard limits.

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

**Status: TBC.** Working candidates and assessment (needs a live App Store +
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

---

## 6. Open decisions

1. **Free taster — DECIDED (2026-07-16):** Free keeps a one-time pool of **3 AI
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
