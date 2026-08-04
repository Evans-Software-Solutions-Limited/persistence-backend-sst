# GO-LIVE PLAN — first paid release

**Written 2026-08-04.** The single ordered path from here to a paid app in the App
Store. Everything else (`STATE.md`, `specs/29-*`, `specs/26-*`, `specs/21-*`) is
detail hanging off this.

⚠ **Read `STATE.md` § "▶ START HERE" first** — it names the two standing hazards
(don't execute `specs/stripe-rail-removal/`; never rename a `tier_name`).

---

## The shape of it

Four things must be true before a paid release:

|       | Must be true                                             | Where it lives             |
| ----- | -------------------------------------------------------- | -------------------------- |
| **1** | The paywall does not promise anything unbuilt            | spec-26, spec-21, the site |
| **2** | Every tier is profitable at its ceiling, at Apple's 30 % | spec-29 Phase 1            |
| **3** | The tiers a user can buy exist in ASC + RevenueCat       | spec-29 Phase 2            |
| **4** | Nothing in the app breaks a Review guideline             | § Compliance below         |

Organisations/B2B (spec-29 Phase 3) is **NOT** in the first release. It is the
margin play and it is blocked on an App Review answer. Ship consumer + solo-coach
on IAP first.

---

## STAGE 1 — Close the "promises what it cannot deliver" gap

Nothing here is optional: the £29.99 card already advertises Loadout and Mealprint.

1. **Merge Mealprint mobile** — `claude/mealprint-mobile-ui-9347a0`. Gate: Inspector
   Brad clean. ⚠ The PR body must say the ENTITLED half has never executed.
2. **Grant the staging entitlement** so the entitled half can be device-tested.
   ⚠ Read the trigger warning in `STATE.md` first — it demotes a coach or admin to
   `role = 'user'`. Use a second test account.
3. **Device-test the entitled half** — suggest sheet's six stages, `no_candidates`,
   and the draft stage's pinned confirm inside gorhom. The last is the only thing
   no test can prove.
4. **Loadout Phase 4** (adapt a client's programme). Its own spec.
5. **Strip unbuilt claims from the site** — "AI Workout Suggestions" has no
   implementation. `marketing/WEBSITE_PRICING_SPEC.md` is already flagged.
6. **The OFF re-seed** (Brad, operational). Until it runs every allergen chip
   correctly returns `no_candidates`, which is the first thing a real user sees.

## STAGE 2 — Make the numbers safe (parallel with Stage 1)

Independent of Mealprint and Loadout. Do it now; it retro-protects everything
already shipped.

7. **spec-29 Phase 0** — the no-code unblocks. Chiefly: measure the six estimated AI
   unit costs. 7 of 9 are guesses and every tier price rests on them.
8. **spec-29 Phase 1** — the pooled AI cost budget. This is what makes a 30 %-Apple
   world survivable, and it ships with no store dependency.
9. **Reshape the bursty ceilings** — recipe extract 12/day → 60/month.

## STAGE 3 — The catalog and the store

10. **spec-29 Phase 2** — new tiers, the reprice, the nine touchpoints, ASC +
    RevenueCat products created but UNSUBMITTED.
11. **Reset the data** (Brad, authorised): prod + staging `user_subscriptions`,
    plus RevenueCat customers. Only test accounts exist. Do this BEFORE the products
    go live, so no half-state survives into the paid era.

## STAGE 4 — Flip

12. `is_active = true` on `premium_plus` and the new coach tiers.
13. Submit the ASC products attached to the launch build.
14. Site copy live with the confirmed prices.

## STAGE 5 — After launch, not before

15. **spec-29 Phase 3** — the organisation rail. Gated on the App Review answer
    (spec-29 task 0.1). This is where the margin is, and where coach ⊕ B2B merge.
16. Programme import, AI workout generation, Mealprint phases 2–3.

---

## Compliance — the part that has bitten twice

Two rejections already: **2.1** (PassKit / Stripe in the mobile app) and **4.0**
(app-drawn Apple logo). So:

- **First release is IAP-only.** No external purchase path, no link-out, no price
  CTA for anything sold off-app. That removes the whole 3.1.3 question from the
  release and defers it to Stage 5.
- **Guideline 3.1.3(c) reading, for Stage 5 only:** _"Consumer, single-user or
  family sales must use in-app purchase."_ A solo coach is a single-user sale, so
  only genuine organisations (Studio and above) can be sold on the web. ⚠ This is a
  reading of guideline text, not advice — get a written App Review answer before
  building Stage 5.
- **Apple's commission is modelled at 30 %.** The Small Business Program application
  is NOT approved (Brad, 2026-08-04). Every tier must work without it; the 15 % rate
  is upside.

---

## What "done" looks like per stage

| Stage | Done when                                                                          |
| ----- | ---------------------------------------------------------------------------------- |
| 1     | The paywall's every bullet maps to code a user can reach                           |
| 2     | `bun run scripts/ai-cost-model.ts` shows no tier above ~50 % of net at its ceiling |
| 3     | A test account can buy every purchasable tier in sandbox                           |
| 4     | A real card is charged and the entitlement resolves                                |
| 5     | An organisation can buy seats without the app mentioning it                        |

## Ordering rules

- **1 and 2 run in parallel.** 2 has no dependency on 1.
- **3 needs 2's measured numbers** — its prices are priced off them.
- **4 needs 1 complete.** Flipping `is_active` on a tier whose features are half
  built is the exact failure this plan exists to prevent.
- **5 needs nothing from 1–4 except the App Review answer**, which should be
  requested during Stage 1 so it is not the critical path later.
