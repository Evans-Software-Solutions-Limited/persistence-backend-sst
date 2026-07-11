# GTM Expansion — Master Planning Brief

**Written:** 2026-07-10 (Fable planning session) · **Owner:** Brad
**Inputs:** colleague's "Go-To-Market Deep Dive" doc (B2B corporate angle + paid
acquisition loop — Brad has the full text in chat), Brad's AI-workout feature
ideas, `marketing/LAUNCH_PLAYBOOK.md` (2026-07-02, trainers-first, mid-Aug
launch), codebase grounding (3 Explore sweeps, 2026-07-10).

**This brief is the map, not the specs.** Per Kiro discipline, every net-new
feature below lands as a `specs/NN-*/` requirements+design+tasks triplet BEFORE
code; each milestone then gets its `specs/milestones/M<N>-*/` brief set
(BRIEF / BACKEND_BRIEF / FRONTEND_BRIEF / SMOKE_TEST). A future agent picking
up any workstream starts here, reads the referenced grounding, authors the
triplet, checkpoints Brad on the flagged decisions, then builds.

---

## 0. Decisions locked by Brad (2026-07-10)

1. **Sequencing: consumer AI + growth loop FIRST**, pre-launch where feasible.
   B2B org layer is fully specced now but builds post-launch, triggered by the
   first real pilot conversation.
2. **Paywall: premium + free taster, PLUS a new higher consumer tier** for the
   heavy-AI capability ("leveraging a premium app should earn more"; B2B seat
   subscriptions priced separately from consumer tiers). Exact tier
   name/pricing = Brad checkpoint (§3 has the proposal).
3. **B2B MVP = full pilot kit, manual billing**: org entity + seats via invite
   code + org-aware entitlements + aggregate-only web admin dashboard + default
   programmes. Billing = invoice outside the app (Apple 3.1.3(b) org-purchased
   seats); NO billing code in v1. SSO/SCIM/HRIS/white-label deferred.
4. **Equipment capture v1 = photo-scan + picklist** (scan is a Snap-AI-pattern
   clone; picklist is fallback + editor). Persistent per-gym equipment
   database = deferred v2 moat.

---

## 1. What the codebase already provides (verified 2026-07-10)

Do NOT rebuild these. File pointers verified against main @ `4bda7d1`.

| Capability                                   | Where                                                                                                                                                                       | State                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Empty/ad-hoc "Quick Start" session           | `packages/mobile/src/application/commands/session/start-session.command.ts` (workout optional)                                                                              | SHIPPED                                                              |
| Mid-session add/remove/substitute exercise   | `add-exercise.command.ts`, `remove-exercise.command.ts`, `substitute-exercise.command.ts`; `session_exercises.isSubstituted` + `originalExerciseId`                         | SHIPPED (manual; picker = same-muscle-group filter only, no ranking) |
| Equipment data model                         | `equipment_types` lookup, `exercises.equipmentRequired uuid[]`, `profiles.availableEquipment uuid[]`, equipment-overlap filtering in `exerciseRepository.ts`                | SHIPPED                                                              |
| AI adapter pattern                           | `nutrition/services/aiEstimation.ts` — injectable Bedrock client, IAM auth, forced tool use, base64 image, runtime clamp/reject; CI never hits AWS                          | SHIPPED (M9.5)                                                       |
| AI gating + ceilings                         | `assertEntitlement('ai_access')` → per-endpoint `AI_*_DAILY_LIMIT` env consts → `ai_usage_log.countForUserToday` → 429 `ai_daily_limit`; only real inferences logged        | SHIPPED (#156)                                                       |
| Draft-confirm UX (AI never writes directly)  | `AiDraftConfirmPresenter.tsx` + `useAiDraftItems.ts`                                                                                                                        | SHIPPED                                                              |
| SSRF-hardened external fetch                 | `recipes/services/url-fetch.ts` (DNS-rebinding socket pinning, per-hop re-checks, 2 MiB cap)                                                                                | SHIPPED                                                              |
| Unified Programs model (spec 19)             | `workout_programs` / `program_workouts` / `program_assignments` → materialised `workout_assignments` occurrences                                                            | SHIPPED (#148/#149/#152/#166 — ignore stale tasks.md checkboxes)     |
| Trainer invite codes (pattern for seat join) | `trainer_invite_codes` + `trainersAcceptInviteCodeHandler.ts` (TOCTOU-safe atomic accept)                                                                                   | SHIPPED                                                              |
| Subscription catalog                         | `subscription_tiers` (flags are real columns: `ai_access`, `workout_limit`, `trainer_client_limit`, `is_trainer_tier`…); RC entitlement map in `revenuecat/entitlements.ts` | SHIPPED                                                              |

**Known hard constraints:**

- **30s API Gateway integration ceiling** drives the AI adapter's 2×12s budget.
  A single-workout generation fits synchronously; a multi-week programme does
  NOT — needs an async-job model (repo already runs Cron Lambdas at 120–300s).
- **Base64-in-body doesn't scale past one image** (5 MB cap). Multi-image =
  spec 16's unbuilt presigned-S3 pattern.
- **PDF handling is fully greenfield** (no parser, no dep, only a rejection
  test). `url-fetch.ts` Content-Type allowlist excludes `application/pdf`.
- **No org/seat model exists.** `small_business`/`medium_enterprise` differ
  from `individual_trainer` only by `trainer_client_limit`; subs are per-user
  with a one-LIVE-sub-per-user partial unique index.
- **No analytics events, share card, or referral codes exist anywhere.**

**Pre-existing bug flagged in passing:** `trainer_client_limit` (2/30/500) is
UNENFORCED at the app layer — `trainersAcceptInviteCodeHandler.ts` never
consults the cap and the `trainer_clients` entitlement is a stub returning
allowed. Revenue leak; small standalone fix, not part of this scope.

---

## 2. Workstream map

```
            PRE-LAUNCH (target: mid-August)          POST-LAUNCH
┌──────────────────────────────────────────┐  ┌──────────────────────────┐
│ M19  Adaptive Workout AI                 │  │ M21  B2B org layer       │
│  ├ P1 equipment capture (scan+picklist)  │  │  (spec now, build on     │
│  ├ P2 AI workout generation              │  │   first pilot signal)    │
│  ├ P3 smart swap suggestions             │  └──────────────────────────┘
│  └ P0 tier restructure (premium_plus)    │  ┌──────────────────────────┐
├──────────────────────────────────────────┤  │ spec-20 Program import   │
│ M20  Growth loop instrumentation         │  │  (photos/PDF/links —     │
│  ├ P1 event tracking plan + emitter      │  │   queued ROADMAP §5.3,   │
│  ├ P2 share card                         │  │   Phase-0 eval first)    │
│  └ P3 referral codes                     │  └──────────────────────────┘
└──────────────────────────────────────────┘
```

Dependency edges: M19-P2 needs M19-P1's equipment-selection context and M19-P0's
gate wiring. M20-P2 (share card) is designed around M19's scan→generate moment,
so M19-P1/P2 land first. M21 reuses M19's generation as the B2B hero demo but is
otherwise independent. spec-20 import reuses M19-P2's exercise-resolution
learnings and shares the async-generation infrastructure if built by then.

**Reality check vs mid-August:** M19 + M20 both fully pre-launch is ambitious
alongside M13-PR2/M14/compliance. If capacity forces a cut, the launch-critical
minimum is **M19-P1+P2 (the hero moment) + M20-P1 (day-0 event data)**; swap
suggestions, share card, and referrals can trail the launch by days without
harming the loop (day-0 data cannot).

### 2b. Schedule of record (locked by Brad 2026-07-11 — hold these dates)

**M20-P1 (day-0 tracking) is PULLED FORWARD (Brad 2026-07-11): it starts
immediately as its own parallel lane** — it has no dependency on M19 and its
value decays with every pre-launch day lost.

| Week           | Code lane (Claude Code)                                                                                         | Ops lane (Cowork/Brad)                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Jul 13–19      | Finish M13-PR2 + M14; author spec-21 + spec-22 triplets; **start M20-P1 events**; caps-fix PR                   | Brad: Premium+ name/price decision (checkpoint #1); demo TestFlight account; named-account sheet started |
| Jul 20–26      | M19-P0 tier restructure + taster; M20-P1 lands (backend+mobile)                                                 | Cowork: ASC Premium+ products + RC entitlement/offering; review screenshots                              |
| Jul 27–Aug 2   | M19-P1 equipment scan; M19-P2 generation backend                                                                | Design pass D1–D3; Brad: pilot one-pager + DPA draft                                                     |
| Aug 3–9        | M19-P2 mobile (both entry points); M19-P3 swap; M20-P2 share card                                               | Cowork: App Store listing/ASO refresh, screenshots incl. scan→generate; D4                               |
| Aug 10–16      | Hardening + EAS build + device verify; **ASC submission by ~Aug 12** (review margin); M20-P3 referrals if green | Brad: founding-trainer briefing; launch assets banked; reshoot 90-sec demo video with real scan→generate |
| **w/c Aug 17** | **LAUNCH**                                                                                                      | Launch-day playbook (LAUNCH_PLAYBOOK §3 week 5–6)                                                        |
| Post-launch    | spec-20 import; launch follow-ups                                                                               | B2B outreach live (artifact §4); M21 build on pilot signal                                               |

**Deadline discipline:** every session working this plan updates STATE.md
against this table; slippage >3 days on any row = Slack ping to Brad with the
proposed re-cut (the pre-agreed cut order: M20-P3 → M20-P2 → M19-P3 first;
M19-P1/P2 + M20-P1 + submission date are protected).

---

## 3. M19 — Adaptive Workout AI (consumer hero, pre-launch)

New spec triplet: `specs/21-adaptive-workout-ai/`. Milestone briefs:
`specs/milestones/M19-adaptive-workout-ai/`.

### P0 — Tier restructure (`premium_plus`) + free taster

The paywall map this scope introduces:

| Tier                   | Price (proposal)                     | AI generation                                                                | Equipment scan | Swap suggestions    | Program import (spec-20)      | Snap AI (existing)             |
| ---------------------- | ------------------------------------ | ---------------------------------------------------------------------------- | -------------- | ------------------- | ----------------------------- | ------------------------------ |
| free                   | £0                                   | **taster: 3 lifetime** (scan+generate pooled)                                | in taster pool | deterministic, free | ✗                             | ✗                              |
| premium                | £12.99                               | 10/day                                                                       | 10/day         | ✓                   | ✗                             | 12 photo / 30 text (unchanged) |
| **premium_plus (NEW)** | **£19.99/mo, £199.99/yr (proposal)** | 30/day                                                                       | 30/day         | ✓                   | ✓                             | higher ceilings (e.g. 20/40)   |
| trainer tiers          | unchanged                            | premium_plus-equivalent AI (ai_access already true)                          | ✓              | ✓                   | ✓ (coach import is the point) | unchanged                      |
| B2B seat (M21)         | invoiced, per-seat                   | per-contract: the org's `seat_tier` (premium OR premium_plus) + org features | ✓              | ✓                   | follows `seat_tier`           | ✓                              |

- **⚠ CHECKPOINT (Brad):** tier name (`premium_plus` / display "Premium+" is
  the working proposal), price points, and exact ceiling numbers. Also note
  the 2026-07-05 commitment put program import at "premium athletes + coaches"
  — this table moves it to premium_plus + trainers; confirm the delta.
- Implementation: new `subscription_tiers` row (idempotent migration mirroring
  `20260526120000`), new RC entitlement `premium_plus` + mapping in
  `revenuecat/entitlements.ts` (precedence above premium), 2 new ASC products
  (monthly/annual) attached to the RC `default` offering — catalog stays SSOT,
  purchasability derived from the offering, no hardcoded filters (per Brad's
  2026-07-10 IAP ruling). Mobile: `SubscriptionSelectionPresenter` renders
  whatever the catalog returns — verify it degrades gracefully to 4 consumer
  choices, no code-side tier list.
- **Free taster:** new entitlement feature `ai_taster` in `assertEntitlement`:
  when `ai_access` denies with `reason: tier` for free tier, the two M19
  endpoints check a LIFETIME (not daily) pooled count of taster endpoints in
  `ai_usage_log` against `AI_FREE_TASTER_LIMIT` (default 3, env-overridable,
  fail-safe parse). Exceeded → 402 with `upgradeTo: premium`. Mobile
  `useFeatureGate` mirrors with a "N free generations left" chip — that copy
  is a conversion surface, not an afterthought (design task D3).
- **Ceilings:** per-endpoint consts follow the #156 pattern exactly
  (`AI_WORKOUT_GEN_DAILY_LIMIT`, `AI_EQUIPMENT_SCAN_DAILY_LIMIT`), but the
  limit RESOLUTION becomes tier-aware (premium vs premium_plus numbers). Keep
  it simple: read the tier in the handler (it already loads entitlement) and
  pick between two env consts — do NOT build a generic limits table in v1.
- **Ops runbook (chat-copy, NOT committed, per feedback_setup_briefs_as_chat_copy):**
  ASC product creation, RC entitlement + offering attach, review screenshots,
  price points. The agent executing P0 hands Brad this runbook in chat.

### P1 — Equipment capture (photo-scan + picklist)

- **Endpoint:** `POST /ai/equipment-scan` — near-clone of
  `nutritionAiEstimateHandler.ts` (same guard order: auth → entitlement/taster
  → ceiling → decode → size cap → magic-byte → model). Forced tool schema
  returns `{ detected: [{ equipmentTypeId | null, label, confidence }], notes }`.
  **Constrain the model to the library:** pass the seeded `equipment_types`
  catalog (id+name, it's small) in the prompt and force selection from it;
  unmatched gear comes back as `label`-only rows the user can ignore. This
  avoids fuzzy post-hoc matching entirely.
- **Mobile:** new scan sheet (camera/gallery → downscale ≤1080px JPEG ~0.7 →
  base64, exactly the `SnapAISheetContainer.tsx` transport) → draft-confirm
  list of detected equipment with toggles + "add manually" picklist (reuse the
  equipment axis already in `ExerciseFilterBar.tsx`'s advanced modal).
- **Where the selection lives:** a per-generation "session equipment context"
  (ephemeral, feeds P2), with an optional "save as my gym" writing
  `profiles.availableEquipment` (field already exists; check what reads it
  today before repurposing). Named multi-gym profiles = deferred with the
  equipment database (v2 moat — do not build).
- Model: vision-capable, env `AI_EQUIPMENT_SCAN_MODEL_ID` (photo-tier model
  like Snap photo's; scan is simpler than food estimation, evaluate Haiku
  first for cost).

### P2 — AI workout generation (prompt → draft workout)

The hero. "Chest and triceps, I only have an adjustable cable machine and
dumbbells" → loggable workout.

- **Endpoint:** `POST /ai/workout-generate`. Input: free-text prompt +
  equipment context (equipment_type ids from P1, or a preset like
  bodyweight-only) + optional structured hints (duration, muscle focus,
  difficulty). Output: a DRAFT workout (name, exercises with sets/reps/rest,
  superset groups) — never a persisted row; the user confirms into the
  existing `workouts` + `workout_exercises` create path, or straight into a
  Quick Start session ("Generate & Go").
- **KEY DESIGN MOVE — candidate-constrained generation, no fuzzy matching:**
  pre-filter the exercise library server-side by equipment overlap
  (`equipmentRequired && available`, logic already in `exerciseRepository`)
  - requested muscles, cap to ~150 candidates (id, name, primary muscles,
    difficulty), pass as prompt context, and force the tool schema to select
    `exerciseId` FROM that list. Generation therefore never invents exercises
    and never needs name→id resolution (which remains spec-20 import's hard
    problem — do not couple them).
- **Sizing:** one workout ≈ well under 2500 output tokens → synchronous is
  fine, but raise `MAX_TOKENS` and stretch the timeout budget (e.g. 20s, ONE
  attempt, no retry — a retry on a big generation doubles cost and busts the
  30s ceiling). Async-job infrastructure is NOT needed for M19; it becomes
  spec-20's problem (multi-week programme import). Note it in the design doc
  so the two specs don't diverge.
- **Two mobile entry points:** (a) Train tab — "Generate workout" alongside
  the builder, lands in the workout editor pre-filled (reuse
  `useWorkoutForm`); (b) Quick Start — generate directly into an active
  session (exercises via the existing add-exercise path). (b) is the
  turn-up-at-the-gym story and the demo moment; both are required.

### P3 — Smart swap suggestions (in-session)

- **v1 is DETERMINISTIC — no AI call, no ceiling, no gate beyond paid tiers'
  positioning choice:** rank the library for the swap picker by same primary
  muscle group + `equipmentRequired ⊆ session equipment context` (when set)
  - difficulty proximity + user history (has-logged-before as a tiebreak).
    Backend: a small `GET /exercises/substitutes?forExerciseId=&equipment=`
    or client-side ranking over the cached library — the spec decides; lean
    client-side first (the library and filters are already on device) to ship
    with zero backend.
- Upgrades the existing `SwapExercisePopover` (which today is a plain
  same-muscle-group filter; V2 deliberately dropped legacy's `similar_to`).
  The shipped `substitute-exercise.command.ts` persistence path is reused
  untouched.
- AI-ranked/AI-explained swaps = later polish, only if the deterministic
  ranker underwhelms on device.

### M19 exit criteria (smoke test seeds)

- Free user completes scan→generate→log once within the taster; 4th attempt
  hits the 402 upgrade surface.
- Premium user: generation respects equipment (generate with "dumbbells only"
  → no barbell exercises appear — assert via `equipmentRequired` of returned
  exercises).
- Ceilings return 429 `ai_daily_limit` past the tier's cap; usage rows only
  for real inferences.
- Generated draft is fully editable pre-save; nothing persists on
  abandon.
- Swap picker surfaces only equipment-compatible alternatives when a session
  has equipment context.
- `premium_plus` purchasable end-to-end in sandbox (catalog-driven; success
  screen shows the correct tier per the #189 race fix).

---

## 4. M20 — Growth loop instrumentation (pre-launch, P1 is launch-critical)

New spec triplet: `specs/22-growth-instrumentation/`. Milestone briefs:
`specs/milestones/M20-growth-loop/`.

### P1 — Event tracking plan + emitter (LAUNCH-CRITICAL: day-0 data — PULLED FORWARD, starts immediately in parallel with M19 per Brad 2026-07-11)

- Author the tracking plan with the product-tracking skill workflow
  (`product-tracking-model-product` → `design-tracking-plan`) — commit the
  `.telemetry/` outputs. Minimum event set (from the colleague's doc, adapted
  to iOS-only IAP — the web-pixel/CAPI half does NOT apply until a web
  checkout exists):
  `registration_completed`, `workout_generated` (the aha event; properties:
  source=prompt|scan|preset, tier, taster_remaining), `equipment_scanned`,
  `trial_started`, `subscription_purchased` (value+currency, from the RC
  webhook server-side — the ONE event that must be server-emitted),
  `d3_active` (derived, not client-fired), `share_card_created`,
  `referral_sent`, `referral_redeemed`, `session_completed`.
- **Vendor decision (⚠ CHECKPOINT Brad):** recommend starting with a
  first-party `analytics_events` ingestion endpoint + thin mobile emitter
  (offline-queued through the existing sync-queue pattern), THEN attaching a
  vendor/MMP when paid ads actually start. Rationale: Meta CAPI/MMP setup is
  wasted until spend exists (playbook says ads are month-3+), but day-0 events
  are unrecoverable. The emitter's interface should match the tracking plan so
  a vendor SDK swap is a thin adapter. Alternative if Brad prefers
  off-the-shelf now: PostHog (free tier, EU hosting, Expo SDK).
- Server-side purchase events hook the EXISTING RevenueCat webhook handler
  (`revenuecat/` — after the entitlement upsert, best-effort, never fails the
  webhook).

### P2 — Share card ("share my session")

- Client-side rendered branded card (react-native-view-shot over a dedicated
  presenter) + native share sheet. Two variants: (a) completed-session card
  (stats: volume, PRs, duration — reuse summary data), (b) the scan→generate
  card (gym photo + detected equipment chips + generated workout) — variant
  (b) is the loop's content engine per the colleague's doc.
- Fires `share_card_created`. No backend. Surfaced on the session summary
  screen + post-generation confirm screen.
- ⚠ The card must NOT include other users' data or identifiable gym location
  metadata (strip EXIF).

### P3 — Referral codes

- Mirror the `trainer_invite_codes` pattern: `referral_codes` (one active per
  user, partial unique) + `referral_redemptions` (unique per redeemer;
  self-redemption blocked; attribute at REGISTRATION, reward on first
  qualifying event to blunt fraud).
- Reward mechanics (⚠ CHECKPOINT Brad): recommend RC **promotional
  entitlements** (granted server-side via RC REST on qualifying redemption —
  e.g. referee gets 1 month premium, referrer gets 1 month after referee's
  first `session_completed`). No price/discount machinery needed on the
  Apple rail.
- Deep link: referral code in the App Store campaign link / clipboard-check on
  first open is unreliable — v1 is "enter code at signup" + share-sheet
  prefilled message. Deferred: Universal Links attribution.

### M20 exit criteria

- Every plan event visible in the store (first-party table or vendor) from a
  device build; purchase event arrives server-side on a sandbox IAP.
- Share card renders correctly for both variants on small/large phones,
  light/dark.
- Referral: A refers B → B redeems at signup → both entitlements land; B
  cannot self-redeem or double-redeem. Weekly "share-rate per 100 new users"
  is computable from events alone (the loop-coefficient metric).

---

## 5. M21 — B2B org layer (spec now, build on first pilot signal)

New spec triplet: `specs/23-organizations/`. Milestone briefs:
`specs/milestones/M21-b2b-orgs/`. **Build trigger: a real pilot conversation
(Brad says go), not the calendar.**

### Scope (locked: full pilot kit, manual billing)

1. **Org model:** `organizations` (name, seat_count, status, contract dates,
   `seat_tier`, notes) + `organization_members` (org_id, user_id, role
   `admin|member`, status, joined_at; partial-unique one ACTIVE membership per
   user). NO self-serve org signup in v1.

1b. **Founder ops console (added per Brad 2026-07-11 — this IS how seats are
managed in practice):** a platform-admin-only section in `packages/web`
(gated on `profiles.role = 'admin'`, i.e. Brad) covering the full org
lifecycle: create org (name, seat count, seat_tier, contract dates) →
generate/regenerate join codes → view members + seat utilisation → revoke
a seat / suspend an org at contract end → adjust seat count on expansion.
Same org endpoints the buyer dashboard reads, plus write routes gated
admin-only — small incremental surface, NOT a separate app. Onboarding a
business in practice = 5 minutes in this console + sending the buyer their
join code and dashboard invite; invoicing stays outside the product
(manual/Stripe invoicing — later decision, no code v1). Before M21 exists,
any early comp/demo seats are RC promotional entitlements (individual) —
do NOT hand-insert org rows.
**RevenueCat's role boundary (Brad asked 2026-07-11):** RC handles the IAP
rail + individual promotional entitlements (referrals, comps, founding
coaches). RC does NOT do org/seat management, seat invoicing, or member
administration — that is this console + the org tables. Do not try to
model orgs as RC entities. 2. **Seat join via invite code:** mirror `trainer_invite_codes` +
`trainersAcceptInviteCodeHandler.ts` (atomic accept, TOCTOU rowcount
guard): `organization_invite_codes` with per-code seat budget = org
seat_count minus active members; joining creates the membership. Employees
join with a code printed on the launch-comms pack — no SSO in v1. 3. **Org-aware entitlement resolution:** the load-bearing change.
`assertEntitlement` today resolves strictly `user_subscriptions.userId =
   userId`. Extend: if no live personal sub, check active org membership →
grant the tier referenced by **`organizations.seat_tier`** (FK/text into
`subscription_tiers` — premium OR premium_plus, set per contract) + the
org flag. Seats therefore grant REAL catalog tiers, so seat value is a
contract lever (sell premium seats now, upsell premium_plus seats later)
with zero code change — pricing lives in the invoice, capability lives in
the catalog. **Design constraints:** personal sub takes precedence
(someone can hold both); the one-LIVE-sub-per-user invariant is untouched
(org grants do NOT write `user_subscriptions` rows — resolution-time join
only); AI ceilings stay per-user at the granted tier's numbers (no pooled
org quota in v1). This function guards every paid feature — the spec needs
a dedicated authorization test matrix (member/non-member/expired-org/
revoked-seat × each gated feature × each seat_tier), and the build session
should treat it as a data-isolation dangerous area.

**Forward-compatibility — seats as a general grant mechanism (Brad,
2026-07-10):** design the resolution seam as _"live personal sub, else
highest active GRANT"_, where org membership is merely the first grant
source. The same seam then supports, without rework: (a) M20-P3 referral
rewards and founding-coach comps via **RevenueCat promotional
entitlements** (RC-side grants that already flow through the existing
webhook → `user_subscriptions` path — no new backend concept needed);
(b) future **consumer seat packs / voucher codes** (e.g. a PT studio or
employer buys N premium_plus seats outside the org-dashboard motion —
modelled as a lightweight org with `seat_tier` set and codes as the join
mechanism, i.e. M21's tables reused, not a new system). Rule to hold: any
new "give someone a tier without an IAP" idea maps to either an RC
promotional entitlement (individual, time-boxed) or an org+seat_tier row
(bulk, contract-managed) — never a third mechanism. This is the
B2B-seats-fund-the-cold-calling revenue lever; not an MVP blocker. 4. **Aggregate-only admin dashboard (packages/web):** org-admin login →
seats purchased vs activated, weekly active members, workouts completed,
engagement trend. **Aggregate and anonymised ONLY — no individual member
health data, ever** (GDPR/works-council per the colleague's doc). Enforce a
minimum cohort size server-side (suppress any metric over <5 active
members). New org-scoped read endpoints with `organization_members.role =
   'admin'` authorization; report from `sessions`/`analytics_events`
aggregates. The renewal artifact — treat dashboard quality as a sales
feature (design task D5). 5. **Default programme templates:** "works out of the box" content
("Layover 30"-style: hotel-gym, dumbbells-only, bodyweight) as seeded
PUBLIC `workout_programs` rows (model already supports `isPublic`) +
equipment-tagged workouts. Content authored with M19's own generator +
human curation. No code beyond seeding. 6. **Data-protection one-pager + DPA template:** documents, not code
(marketing/ or chat-copy — Brad's call at execution; the privacy-policy
Bedrock/AWS disclosure from #190 already covers the AI processing basis).

### Explicitly deferred (roadmap slide only — do not build)

Persistent hotel/gym equipment database + programme-continuity engine
(auto-porting periodised plans across equipment), SSO/SCIM, HRIS integrations,
white-labelling, pooled org AI quotas, in-app org billing.

### M21 exit criteria

Two-org isolation test (org A admin sees zero org B data; member data never
visible individually); revoked seat loses entitlement on next resolution;
seat-budget exhaustion blocks the (N+1)th join; dashboard suppresses
small-cohort metrics.

---

## 6. spec-20 Program import (existing queued workstream — pointers only)

Already Brad-committed (2026-07-05) and queued at `ROADMAP.md §5.3`; own spec
triplet `specs/20-content-import/` when picked up. This plan adds two
constraints discovered in grounding:

- **Multi-week generation/parse busts the 30s sync ceiling** → import needs an
  async-job execution model (Cron-Lambda-style timeouts exist in `infra/api.ts`;
  job table + poll/push). Design it there; M19 deliberately stays synchronous.
- **Multi-image (screenshot sets) and PDF need an upload path** — spec 16's
  presigned-S3 design is the intended pattern; PDF is fully greenfield
  (extend `url-fetch.ts` allowlist for PDF-by-link; Bedrock accepts document
  blocks but the adapter's content union needs extending).
- Paywall: lands in **premium_plus + trainer tiers** per §3's table
  (⚠ delta vs the 2026-07-05 "premium athletes" note — confirm at pickup).
- Start with the Phase-0 accuracy eval (per `project_program_import_ai`
  memory) before speccing the pipeline.

---

## 7. Marketing-readiness engineering checklist (what "ready for marketing" means)

The colleague's Part-2 loop needs these product facts to be true at launch:

- [ ] The aha moment (scan→generate) exists and is free-taster-reachable on
      day 0 (M19 P0–P2).
- [ ] Every funnel event is captured from day 0, purchases server-side
      (M20 P1). Without this, no CAC/LTV/retention math ever works.
- [ ] The share moment is one tap from both the generation and the
      session-summary screens (M20 P2).
- [ ] Referral attribution works without paid-ads infrastructure (M20 P3).
- [ ] Paywall day-0 placement: onboarding surfaces the taster → premium path
      (LAUNCH_PLAYBOOK §2: >80% of trials start day 0). Onboarding flow
      changes ride with M19-P0's gate copy (design task D3).
- **Deliberately NOT now:** Meta pixel/CAPI, MMP SDK, TikTok Events — wasted
  until ad spend starts (playbook: month 3+) and partially inapplicable while
  checkout is iOS-IAP-only. When spend starts, revisit the deferred Stripe/web
  rail (dormant handlers exist) for the fee + signal win; that's its own
  future decision with App Review implications.

---

## 8. Suggested execution order (each row = one focused session/agent run)

| #     | Work                                                                                                               | Prereq                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 1     | Author `specs/21-adaptive-workout-ai/` triplet; checkpoint Brad on tier name/price/ceilings                        | this brief                                    |
| 2     | M19-P0 tier restructure + taster (backend PR, then catalog ops runbook to Brad in chat)                            | 1                                             |
| 3     | M19-P1 equipment scan (backend PR + mobile PR)                                                                     | 1 (P0 merely for gates — can stub on premium) |
| 4     | M19-P2 generation (backend PR + mobile PR, both entry points)                                                      | 3                                             |
| 5     | M19-P3 swap ranking (mobile-first PR)                                                                              | 1                                             |
| 6     | Author `specs/22-growth-instrumentation/`; checkpoint vendor + referral reward — **do in week 1, alongside row 1** | this brief                                    |
| 7     | M20-P1 events (backend + mobile PR) — **parallel lane, does NOT wait for M19 rows**                                | 6                                             |
| 8     | M20-P2 share card (mobile PR)                                                                                      | 4 (needs the generate moment)                 |
| 9     | M20-P3 referrals (backend + mobile PR)                                                                             | 6                                             |
| 10    | Design generation pass — see `DESIGN-TASKS.md` (run BEFORE mobile PRs of 3/4/8; dashboard design before 13)        | 1, 6                                          |
| 11    | Author `specs/23-organizations/` triplet                                                                           | this brief                                    |
| 12–14 | M21 build (org model+entitlements → invite/seats → dashboard)                                                      | 11 + pilot signal                             |

Standard rules apply throughout: recon-first, build INLINE (per the #182
delegation lesson), Inspector Brad local sweep before every PR, migrations
idempotent + prod-apply flagged manual, 90% coverage, catalog = SSOT, AI
output always draft-confirmed, every org/user read authorization-tested.

---

## 9. Open checkpoints for Brad (consolidated)

1. `premium_plus` name / £19.99 price / ceiling numbers (§3 P0).
2. Program import tier placement delta (§3 table vs 2026-07-05 note).
3. Analytics: first-party-first (recommended) vs PostHog now (§4 P1).
4. Referral reward mechanics + amounts (§4 P3).
5. B2B seat price list for the sales one-pager (engineering-independent; the
   colleague's £4–6/seat/mo tiers are the starting point).
6. Launch-scope cut line if capacity forces it (§2 reality check).
