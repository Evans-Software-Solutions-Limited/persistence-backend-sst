# Persistence — Founders' offer × Meta: marketing setup brief

Written 4 Sep 2026; realigned the same day to the FOUNDING-OFFER grant-model amendment on `codex/auth-cardio-logging` (founding access is granted, not sold; contributions are optional and separate). Format follows `MARKETING_SOURCE_OF_TRUTH_GENERIC.md` § 1.4 / § 11 (Decision → Buyer → Offer → Evidence → Economics → Experiment → Measurement → Stop/scale → Policy → Approvals). Evidence labels: `PRIMARY` `CORROBORATED` `DERIVED` `HYPOTHESIS` `VOLATILE` `SELF_REPORTED`.

Source of truth for build state is `STATE.md` + `specs/milestones/FOUNDING-OFFER/*` (PR #432 merged 4 Sep; the 2026-09-04 amendment in `BRIEF.md § 2` controls wherever the older D1–D9 text conflicts). Where this brief and those disagree on a build fact, they win and this brief gets corrected.

---

## 0. Decision (read this if nothing else)

**Run the founders' offer on two rails and point Meta only at the rail a stranger can complete — and at the only rail that carries a price.**

| Lane                                                 | Who it is for                                                    | Money                                                                                                                                                                                        | Rail                                                                                                                                                           | Attribution                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **A — Founding access** (built, #432 + amendment)    | Warm: people Brad meets at fairs, network, existing IG followers | **None required.** Access is granted at Brad's discretion for a period he sets. A crowdfunding contribution is optional, recorded as evidence only, and never buys, sizes or extends access. | Ask in person / by email → `/admin` grant (`founding` consumes a pool place; `complimentary` does not) → user signs up + confirms email → access on first load | Referral code recorded on the grant (attribution only; does not lock as a paid conversion) + `?ref=` + campaign slug on `/founding` |
| **B — Store founders' rate** (config only, no build) | Cold: Meta/Instagram ads audiences who have never heard of Brad  | Apple/Google pay Brad ~45 days after month end                                                                                                                                               | Apple **custom offer code** (pay-up-front, 6 months) redeemed via redemption URL — installs the app as part of redemption                                      | ASC per-code redemption report + `ct` campaign token + RevenueCat                                                                   |

Why not Lane A for Meta: Lane A has no price, no checkout and no promise — by design (amendment; review F9). Its conversion is "email Brad and be granted a place". That is a warm-relationship mechanism, not a cold-click funnel, and putting a price on it in an ad would contradict the page it lands on. `DERIVED` from `BRIEF.md § 2` amendment, `SECURITY_REVIEW-2026-09-04.md § 3`, SoT § 8.1 and § 8.5.

Why Lane B matters beyond cash: Shipaton is RevenueCat's competition, judged on post-release traction (`STATE.md` 2026-08-12). Founding grants bypass RevenueCat (D3) so they are invisible in the RC dashboard. Store subscriptions are the traction a judge can see. `DERIVED` — confirm the judging inputs on the Shipaton/Devpost rules page.

**The only priced claim anywhere in this plan is Lane B's App Store offer.** Referral codes never change price or grant entitlement (D6 + amendment). Do not write ad copy that promises anything for "entering a code".

**Phase 0 decisions (Brad, 4 Sep 2026 — baked in):**

| #   | Decision                      | Value                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Codes                         | Created and customised in `/admin → Referral codes`, never by an agent. Channel attribution comes **mainly from the campaign slug**; Brad assigns **specific codes to partners** for partner attribution on top. Briefs write `<CODE>`.                                                                                                                                                  |
| P2  | Store founders' rate (Lane B) | Four ASC pay-up-front offers on the existing monthly subscriptions, new subscribers only: **Premium £30 / 6 months, £60 / 12 months; Premium+ £50 / 6 months, £100 / 12 months** (nearest Apple price tiers — read the configured value back from ASC before it appears in copy). Play equivalents if trivial.                                                                           |
| P3  | Redemption caps and expiry    | Brad sets them. Referral-code caps/dates are already editable in `/admin` (`max_redemptions`, `starts_at`, `ends_at`). **ASC offer-code caps and expiry live in App Store Connect** — the admin panel records and displays them per plan (hand-entered) but cannot set them in this milestone; an App Store Connect API integration is a listed follow-up, not part of the 30 Sep slice. |
| P4  | VAT                           | ESS is **not VAT-registered**: Meta adds 20% to ad spend (£210 ex-VAT ≈ £252 charged); Apple handles VAT on Lane B, so net-per-sale is unaffected.                                                                                                                                                                                                                                       |
| P5  | Ad-account spending limit     | **£210** (from £20/month).                                                                                                                                                                                                                                                                                                                                                               |

Channel attribution does not depend on the code word — it comes from the campaign slug (`meta`, `ig`, `flyer`…) via Apple `ct`, Play `utm_*` and, once MARKETING-PLANS lands, `store_click.properties.campaign`.

---

## 1. Buyer and insight

**Segment (HYPOTHESIS — no voice-of-customer bank exists yet):** UK adults 18–40 who already train 2–4×/week and track workouts somewhere unsatisfying (Notes app, spreadsheet, a competitor logger), plus PT clients whose coach sends them a plan. Trigger: a new programme, a new gym, "I keep losing track of what I lifted last time". Awareness: problem-aware/solution-aware.

**Disqualifiers:** anyone with a live App Store subscription to Persistence (an admin grant cannot displace it — amendment; F2 409 in code); coaches (separate pool, not in this test).

**What we know first-party (PRIMARY, `analytics_events` prod, 23 Aug):** 33 `store_click`, 0 leads ever, launch-night click→register ≈ 50%. Six sessions came from the FB/IG in-app browser. The click→install→register step is not the leak; reach and the never-rendered paywall are (§ 9 risk 1).

**Message map (Lane B; Lane A copy is on `/founding` already and must not add a price):**

| Element                      | Value                                                                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buyer                        | People who lift and want their training history to actually mean something                                                                                                                                                         |
| Trigger                      | New programme / new gym / can't remember last week's weights                                                                                                                                                                       |
| Problem                      | Tracking is either a chore or a monthly app they don't get value from                                                                                                                                                              |
| Outcome                      | Every session logged in under a minute, PRs and streaks derived for you                                                                                                                                                            |
| Claim (bounded, Lane B only) | Founders' rate: six months of Premium for £30 (or a year for £60; Premium+ £50 / £100), renews at the standard price unless cancelled. Nearest Apple tier applies — read the exact figure back from ASC before it appears in copy. |
| Mechanism                    | Built by one founder who lifts; launching with founders instead of investors                                                                                                                                                       |
| Proof                        | Demonstration only. No testimonials exist — do not invent any (SoT § 1.5).                                                                                                                                                         |
| Objection                    | "Another fitness app" → show the workflow. "Why so cheap?" → it's a launch-period founders' rate with a real redemption cap.                                                                                                       |
| CTA                          | Lane B: "Redeem the founders' rate" → offer-code redemption URL via the landing page. Lane A: "Ask for a founding place" → `/founding`.                                                                                            |
| Disqualifier                 | Already subscribed in the store → not eligible                                                                                                                                                                                     |

Real urgency (SoT § 5.8): the ASC code's `max redemptions` and expiry; the DB-backed founding pool (`founding_pool_limits`, exposed as aggregate availability via `GET /founding/availability`); the fixed 30 Sep Shipaton date. Nothing else. No countdowns.

---

## 2. Offer cards

### Lane A — Founding access (as amended 2026-09-04; do not re-open)

- Access is **granted, not sold**. Brad chooses recipient email, tier (`premium`, `premium_plus`, coach line), duration in months (defaults 6; 1–120), and kind (`founding` consumes a pool place; `complimentary` does not).
- Pool caps are database-backed (`founding_pool_limits`: consumer 200, coach 20 seeded) and shown publicly only as aggregate availability. Never quote a cap from a note — read it from `/founding/availability`.
- A contribution (amount, method, reference, date) is **optional evidence**, legally and technically separate from access. Contributing does not buy, guarantee, size or extend a grant; granting does not imply a contribution. The platform never takes the money. Payment Links, if used, are sent privately.
- Grants can be extended by months; a live store subscription cannot be displaced by a grant.
- `/founding` copy already says exactly this ("Access is granted, not sold here" / "How to ask for a place" / "Crowdfunding is separate"). Lane A marketing = point people at that page and talk to them. **No price, no "£30", no "buy" anywhere in Lane A material.**

### Lane B — Store founders' rate (to configure; VOLATILE — verify every line in ASC/Play Console before writing copy)

- **Apple:** App Store Connect → Subscription offer codes → four offers (P2): Premium monthly → pay up front 6 months at the £30 tier and 1 year at the £60 tier; Premium+ monthly → 6 months at £50 and 1 year at £100; eligibility **new subscribers**. Custom codes: Brad's words, one or several (per avenue/partner). Set `max redemptions` and expiry **in ASC** (P3) and mirror them into the plan in `/admin/marketing` so the panel shows what is live. Codes take up to an hour to become redeemable. Redemption URL: `https://apps.apple.com/redeem?ctx=offercodes&id=<numeric app id>&code=<CODE>` — the App Store prompts the install if the app is missing (memory `persistence-offer-codes`).
- **Google:** Play Console → Monetise → Promo codes; check current limits. iOS first; Android only if trivial.
- Naming in public copy: "founders' rate" (Lane B, priced, renews) vs "founding place / founding access" (Lane A, granted). Never let one lane's number or mechanism be claimed for the other.
- **Before a single ad runs:** redeem one code end to end on a real device with a fresh Apple ID and fresh account → confirm a `user_subscriptions` row server-side (RC anonymous-id trap; `revenueCatWebhookHandler.ts` skips anonymous ids; whether `logIn`/TRANSFER repairs it is unverified). No row → Lane B is not launchable; fallback is an ASC introductory offer.

---

## 3. Evidence register

| Claim                                                                                                            | Label                | Source                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Founding access is granted not sold; contributions optional and separate; no prices/purchase flow on `/founding` | PRIMARY              | `BRIEF.md § 2` amendment + `Founding.tsx` on `codex/auth-cardio-logging`; migration `20260904214114_generalise_founding_grants.sql` |
| Pool caps DB-backed, public aggregate availability                                                               | PRIMARY              | `founding_pool_limits`; `GET /founding/availability` in `subscriptionsTiersHandler.ts` (same branch)                                |
| Referral codes are attribution only; grant does not lock the referral as paid                                    | PRIMARY              | D6 + amendment; `referralsHandler.ts`                                                                                               |
| `?ref=` captured on any `MarketingLayout` route and carried on `store_click`                                     | PRIMARY              | `MarketingLayout.tsx:34-41`, `storeClick.ts:41`                                                                                     |
| `store_click` has no campaign slug today                                                                         | PRIMARY              | `leadsRoutes.ts` `storeClickEvent` (fixed by MARKETING-PLANS WP2)                                                                   |
| `CAMPAIGNS` has no `meta` slug                                                                                   | PRIMARY              | `packages/web/src/marketing/config.ts`                                                                                              |
| Meta SDK + ATT built, not submitted; no `SKAdNetworkItems` found                                                 | PRIMARY (grep 4 Sep) | `STATE.md` 2026-09-02                                                                                                               |
| Founding grants bypass RC; store subs RC-visible                                                                 | PRIMARY              | D3                                                                                                                                  |
| Shipaton: submit by 30 Sep 23:45 PDT                                                                             | PRIMARY / VOLATILE   | `STATE.md` 2026-08-12                                                                                                               |
| Health & wellness dataset may restrict custom audiences, not cold interest targeting                             | PRIMARY / VOLATILE   | memory `persistence-meta-capi-setup`                                                                                                |
| Apple net ≈ 71% of a pay-up-front price after VAT and 15%                                                        | DERIVED              | funding review § 1                                                                                                                  |
| Fitness UK CPC/CTR/install benchmarks                                                                            | **UNKNOWN**          | none first-party — do not forecast from them                                                                                        |

---

## 4. Economics

Definitions per SoT § 10.1. ESS is **not VAT-registered** (P4): Meta charges VAT on top of spend; Apple is merchant of record on Lane B.

|                              | Lane A founding access                                                                        | Lane B store code                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Revenue                      | **None by design.** Contributions are voluntary, separate, and must not be forecast as sales. | ASC price × redemptions                                                                                                                         |
| Net to Brad                  | n/a (contributions land directly, off-platform)                                               | ≈ 71% after VAT and Apple's 15%: **£30 → ≈ £21.25; £60 → ≈ £42.50; £50 → ≈ £35.40; £100 → ≈ £70.80** (DERIVED; exact tiers may differ by pence) |
| Cash timing                  | as contributed                                                                                | ~early/mid Nov for Sept sales                                                                                                                   |
| Renewal                      | none (fixed months, extendable by admin)                                                      | auto at standard price unless cancelled                                                                                                         |
| Counts for Shipaton traction | no (bypasses RC) — but the cohort is real, report it separately                               | yes                                                                                                                                             |

**Allowable paid CAC (DERIVED):** with no retention data and no buffer, cap at **≈ ½ of Lane B net per subscriber — £10 on a 6-month Premium redemption**, higher on the year or Premium+ but plan on the £10 figure. Lane A has no CAC — it is not a paid-acquisition product.

**Test budget ceiling (Brad, 4 Sep):** **£10/day, 14–21 days → £140–£210 hard cap ex-VAT (≈ £252 charged, P4).** This can distinguish creative concepts on landing views and tell you _whether_ redemptions happen. It cannot measure CAC with confidence — say so in the conclusion.

"Good" at £200 spend = **≥ 5 attributable conversions** (ASC redemptions on the plan's code(s) + founding grants recorded with the plan's code(s), counted as _places_, not revenue). Below 2 at £200 → stop; the offer/message is unproven.

---

## 5. Funnel and tracking chain

```
Meta ad → https://persistence.evans-software-solutions.com/meta?ref=<CODE>            (Lane B cold)
  pixel PageView (consent-gated) · ref stored · campaign=meta on CTAs and on store_click (after WP2)
  → "Redeem the founders' rate" CTA → apps.apple.com/redeem?…&code=<CODE>
  → install + subscribe in one flow → RC → user_subscriptions (rc_*)
  → optional: user enters <CODE> on Subscription Selection (attribution only)

IG Stories link sticker / Highlight / bio / print QR → /founding?ref=<CODE>            (Lane A warm)
  → in person or email → Brad grants in /admin (kind, tier, months, referral code, optional contribution)
  → invite → sign up same email → confirm → access on first load
```

**Measurement chain (SoT § 12.7), owner = Brad:**

| Stage              | Event                                                                                            | Source                                  | Lag    |
| ------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------- | ------ |
| Impression / click | reach, link clicks, CPC                                                                          | Meta Ads Manager                        | live   |
| Landing            | `PageView` (browser pixel, consent only; nothing written to Postgres)                            | Meta                                    | live   |
| Store intent       | `store_click` with `properties.campaign` and `ref`                                               | `analytics_events` → `/admin/marketing` | live   |
| Install            | App Analytics by `ct`; Meta SDK installs only once the new build is live                         | ASC / Meta                              | 1–2 d  |
| Subscribe (B)      | ASC offer-code redemptions per code; RC new customers                                            | ASC / RC                                | daily  |
| Access (A)         | `founding_grants` with the plan's referral code(s): pending/applied, kind, optional contribution | `/admin`                                | manual |
| Retention          | RC renewals month 7                                                                              | RC                                      | 2027   |

Reconcile weekly in `/admin/marketing`: spend · link clicks · `store_click` by channel · ASC redemptions · RC new subs · grants by code. Platform ROAS is diagnostic only. `meta_forwarded_at` set ≠ delivered to Meta (consent-dropped rows are stamped too).

---

## 6. Experiment design

**Question:** does a founders'-rate store offer, presented by the founder, get cold UK gym-goers on Instagram to install and subscribe at a cost that could ever be below the allowable CAC?

**Hypothesis (HYPOTHESIS):** a founder-led "launching with founders instead of investors" concept will out-click a product-demo concept for cold traffic because the _reason_ for the offer is more interesting than the features.

**Week 1 — concepts:** 3 ads, one ad set, £10/day, **Traffic objective optimised for landing page views**, Advantage+ placements, 9:16 and 4:5 from one shoot. Never App promotion until the SDK build is live and installs show in Events Manager; do not optimise for `AppStoreClick` (≈ 50 conversions/ad set/week needed to exit learning — this budget cannot). Concepts: founder story (why the offer exists) · demonstration (logging speed) · situation (bad-tracking moment). Content is Brad's — see the creative brief.

**Week 2:** three opening variants of the winner. **Week 3:** only if the rule says iterate/scale; destination test (landing page vs direct redemption URL — measurement vs hops).

**Controls:** one audience (UK 18–40, gym/strength/PT interests; no lookalikes or custom audiences — § 8), one destination per week, one offer.

**Decision rule (declared now):** stop a cell at £40 with materially worse CTR, or £60 with zero `store_click` on `meta`; stop the campaign at £200 with < 2 attributable conversions → conclusion per SoT § 14.4, back to offer/message not targeting; iterate at 2–4; scale £10→£20/day only at ≥ 5 with ASC ↔ RC ↔ `analytics_events` reconciling within ±1 and a declared marginal-CAC ceiling.

---

## 7. Pre-flight checklist — nothing launches until every box is ticked

**Meta plumbing (assets built 14 Aug; verify by eye):**

- [ ] Page **Persistence App: Coach & Train** (1234164279785670) inside portfolio 1110614147901157; business verification complete
- [ ] Ad account `Persistence` **120250433334990636** (GBP) — never the personal account 227745267920233
- [ ] **Account spending limit £20/month → raise to £210** (ex-VAT/fees); it is the only hard cap
- [ ] Tax info: add VRN if ESS is VAT-registered, else budget +20%
- [ ] Instagram professional account linked to the Page (needs Brad's IG login)
- [ ] Events Manager shows live `PageView` from prod with consent (real browser; **no** `TEST8583` on prod)
- [ ] One `AppStoreClick` received → create the Custom Conversion (for later; not this test's objective)
- [ ] Business details complete on the portfolio

**Build (MARKETING-PLANS milestone — separate brief):** `meta` slug · `campaign` on `store_click` · store-offer CTA on `/meta` only · `/admin/marketing` plans, channels, metrics, attribution. Must be based on `main` **after** `codex/auth-cardio-logging` merges (it changes `founding_grants` and the FOUNDING-OFFER briefs).

**Store offer (Lane B):**

- [ ] ASC offer + Brad's custom code(s); max redemptions + expiry set
- [ ] End-to-end redemption on a fresh Apple ID → `user_subscriptions` row present. Fails → stop; introductory-offer fallback
- [ ] RevenueCat public SDK key populated in the shipped build (unverified per memory; missing key = "Coming soon" on every paid CTA)
- [ ] `VITE_STORE_OFFER_IOS_URL` set on `staging`, smoke passed, then `Production`

**Referral codes / plan:**

- [ ] Brad's code(s) created in `/admin → Referral codes` (kind `founding`, or `campaign` per avenue — his call)
- [ ] Plan created in `/admin/marketing` with brief pasted, channels `meta`, `ig`, `flyer`, `banner`, `uon`, codes linked
- [ ] Production go/no-go from `SECURITY_REVIEW-2026-09-04.md § 9` + amendment smoke test: Brad's own grant, then a fresh-mailbox pending grant end to end on a store build

**Creative QA (SoT § 6.10):** buyer recognisable in 2 s · claim matches ASC exactly · renewal sentence present · scarcity = ASC max redemptions · no health/outcome claims · no testimonials or invented numbers · no price or "buy" language in any Lane A asset.

---

## 8. Policy review

- **Meta:** fitness is not a Special Ad Category. Dataset is self-declared Health & wellness provider → expect restrictions on custom audiences/retargeting, not cold interest targeting. Verify before any retargeting/lookalike (VOLATILE). No before/after bodies, no weight-loss or health-outcome claims.
- **Apple:** offer codes and redemption URLs are the sanctioned mechanism. Nothing about founding access, contributions or the website route appears **inside** the app (3.1.3(b)). Lane B copy must not imply the founding pool cap applies to the store code.
- **UK consumer law:** Lane A is not a sale — keep it that way in every word (no price, no "buy", contributions described as separate and voluntary; Terms/solicitor review is Brad's open item). Lane B is Apple's contract; state auto-renewal plainly.
- **PECR/GDPR:** pixel consent-gated (spec-30 R3.5); privacy policy carries founding retention line (WP6, both copies). No customer-list uploads to Meta in this test.

---

## 9. Risks that make a perfect campaign report zero

1. **Paywall reachability** — unreachable on every signup path on 23 Aug; onboarding + ProfileDrawer entry now exist but the store build is unverified. Lane B's redemption URL bypasses the picker, which is a large part of why it is the cold lane.
2. **Silent `store_click` failure** — beacons swallow errors; verify by counting `analytics_events` rows.
3. **Consent drop** — unconsented clicks never reach Meta; reconcile against Postgres.
4. **Install optimisation before SDK + SKAdNetwork** — landing views/link clicks only until then.
5. **Anonymous-id trap on offer codes** — nothing public until one redemption has produced a row.
6. **Lane bleed** — a price or "buy" word leaking into Lane A material contradicts `/founding` and the amendment; a founding-pool number leaking into Lane B misstates the store cap.

---

## 10. Shipaton tie-in (30 Sep 23:45 PDT)

Bank weekly: RC new customers / active subs / redemptions; ASC redemptions per code and installs by `ct`; `/admin/marketing` channel table (spend, clicks, `store_click`, grants by code); founding cohort size (`founding` grants, non-revoked) stated plainly as granted access outside the store; Meta spend and CPC per concept; IG deltas. Narrative: one founder, a capped founding cohort, a controlled paid test with a declared stop rule, a store-native founders' rate, everything instrumented end to end.

---

## 11. Approvals and handback (Brad)

- ~~Merge `codex/auth-cardio-logging`~~ — merged 4 Sep
- Create code(s) in `/admin` (P1) — partner codes as partners come on
- Configure the four ASC offers + custom codes with caps/expiry (P2, P3); read values back into copy
- ~~VAT status~~ — not registered (P4)
- Raise the ad-account spending limit to £210 (P5)
- Keep print and the 25 Sep UoN freshers fair as September's primary channels (memory `persistence-meta-ads-strategy`); this test is justified by Shipaton timing and creative learning, not expected CAC

## 12. Suggested calendar

| Dates     | Work                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| 5–7 Sep   | MARKETING-PLANS agent starts (amendment merged); § 7 Meta plumbing; four ASC offers + code(s); redemption test           |
| 8–9 Sep   | MARKETING-PLANS merged + deployed; env var set; plan created in `/admin/marketing`; first `AppStoreClick`; creatives cut |
| 10–16 Sep | Week 1 concepts, £10/day                                                                                                 |
| 17–23 Sep | Week 2 openings on the winner                                                                                            |
| 24–28 Sep | Week 3 only if the rule says so                                                                                          |
| 29–30 Sep | Devpost submission; experiment conclusion filed                                                                          |
