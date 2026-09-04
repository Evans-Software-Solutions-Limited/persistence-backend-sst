# Founders' offer — execution plan (Sep 2026)

Owner: Brad. Agents: one coding agent on `feat/marketing-plans` (brief: `BRIEF.md` in this folder). Source of truth for build facts: `STATE.md`; for the grant model: `specs/milestones/FOUNDING-OFFER/BRIEF.md § 2` (2026-09-04 amendment — access is granted, not sold; contributions optional and separate). Ads content: Brad only (`CREATIVE_BRIEF.md`). Hard dates: Meta test window 10–28 Sep; Shipaton submission 30 Sep 23:45 PDT.

Rule: nothing public until the step's gate is green. Gates in bold.

## Phase 0 — land the prerequisites (5 Sep, Brad)

- [ ] Merge `codex/auth-cardio-logging` (grant-model amendment + spec 33). MARKETING-PLANS depends on its schema.
- [ ] Merge this briefs PR (`docs/marketing-plans-briefs`).
- [ ] Decide code word(s): shared or one per avenue — your call. Create them in `/admin → Referral codes`.
- [ ] Decide the Lane B ASC offer: pay-up-front, 6 months, price tier, new subscribers, max redemptions, expiry.
- [ ] VAT status of ESS (Meta adds 20% otherwise; add VRN if registered).
- [ ] Ad account spending limit £20 → **£210**.

## Phase 1 — build (5–9 Sep)

| Who | Work | Gate |
|---|---|---|
| Coding agent | MARKETING-PLANS WP1–WP7 on `feat/marketing-plans`, based on `main` post-amendment | repo gates green; local inspector clean; PR open |
| Brad | Review + merge; apply migration on staging; deploy | `SMOKE_TEST.md` (a)–(h) on staging |
| Brad | ASC: create offer + custom code(s); wait ≤ 1 h | redeemable |
| Brad | **Redeem once on a fresh Apple ID + fresh account; confirm `user_subscriptions` row server-side** | present → Lane B live-able. Absent → stop; introductory-offer fallback, re-plan |
| Brad | `VITE_STORE_OFFER_IOS_URL` on `staging` → smoke (a) → `Production`; prod migration; deploy | `/meta` on prod shows the CTA; one `analytics_events` row with `campaign='meta'` |
| Brad | `/admin/marketing` → New plan "Founders' offer — Sep 2026": lanes both, cap £210, dates 10–28 Sep, paste `MARKETING_BRIEF.md`; channels `meta`, `ig`, `flyer`, `banner`, `uon`; link code(s) | plan visible with channels and codes |

## Phase 2 — Meta plumbing (5–9 Sep, Brad in console)

- [ ] Page `Persistence App: Coach & Train` in portfolio 1110614147901157; verification complete
- [ ] Ad account `Persistence` 120250433334990636; limit £210; tax info answered
- [ ] Instagram professional account linked to the Page
- [ ] Events Manager: live `PageView` from prod with consent (real browser; no test code on prod)
- [ ] One `AppStoreClick` received → Custom Conversion created (for later)
- [ ] **Gate:** all ticked + Phase 1 gates

## Phase 3 — creative (6–9 Sep, Brad)

Three concepts per `CREATIVE_BRIEF.md`; nothing agent-generated. **Gate:** QA checklist passed per asset; `/meta` says the same offer in the same words; no price or "buy" language anywhere in Lane A material.

## Phase 4 — run (10–28 Sep)

- Week 1 (10–16): 1 campaign, Traffic objective, landing page views, Advantage+ placements, UK 18–40, 3 ads, £10/day. Daily: spend vs cap. Wed + Sun: enter spend/impressions/clicks/landing views into `/admin/marketing`; read `store_click` per channel there.
- Week 2 (17–23): pause the two weaker concepts; 3 opening variants of the winner. Enter ASC redemptions weekly.
- Week 3 (24–28): only if the rule says iterate or scale.
- Decision rule (fixed): stop a cell at £40 with materially worse CTR, or £60 with zero `store_click` on `meta`; stop the campaign at £200 with < 2 attributable conversions (ASC redemptions on linked codes + `founding` grants recorded with linked codes, counted as places); iterate at 2–4; scale £10→£20/day only at ≥ 5 with reconciled tracking.
- Lane A runs in parallel: IG Stories link sticker + Highlight → `/founding?ref=<CODE>`; fairs and print → `/founding`; grants recorded in `/admin` with the code attached; contributions, if any, recorded as evidence only.

## Phase 5 — Shipaton (29–30 Sep)

Assemble from `/admin/marketing` + RC + ASC: plan brief, channel table, spend, store clicks, redemptions, founding cohort (granted access, outside the store — say so), experiment conclusion. Submit.

## Weekly 20-minute cadence (Fri)

Spend vs cap → `store_click` by channel → ASC redemptions → RC new subs → grants by code → one decision (continue / change / stop) written into the plan's notes.
