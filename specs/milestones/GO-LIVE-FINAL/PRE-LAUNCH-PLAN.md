# GO-LIVE — Pre-launch plan & parallel workstreams

_Authored 2026-07-17, `main` HEAD `0304dea`. Synthesises three current-state investigations (website / GTM-B2B-AnyGym / coach-IA) into a launch line, a critical path, and parallel lanes with per-lane briefs. Read this first; each lane has its own brief file._

## 0. The launch-line decision (read first)

There are really **two** candidate "launches", and conflating them stalls everything:

- **A — MVP submission (recommended, now):** the athlete port + coach-mode-as-is → App Store. Gets you through Apple review, IAP sandbox, the first-rejection cycle, and into production. Everything else ships afterward as app updates.
- **B — GTM hero launch (per `GTM-EXPANSION/BRIEF.md`, trainers-first ~mid-Aug):** adds M19 Adaptive Workout AI ("AnyGym") + the M20 growth loop before the marketing push.

**Recommendation: do A now, layer B as fast-follow.** Submitting early de-risks the parts only Apple can gate (IAP, privacy, review). M19/M20 land as updates; B2B (M21) is explicitly _spec-now / build-on-pilot_ per your locked decision (2026-07-10). This plan is built around A.

## 1. Tier 0 — Pre-launch critical path (blocks the submission)

1. **Track C** — IAP products in App Store Connect + RevenueCat → prod EAS build → **IAP sandbox sign-off**. (Runbook already delivered in chat; gated on 12.13-on-prod, which is done.)
2. **Fresh staging EAS build** → device-verify the two merged native fixes (#256 drawer a11y, #259 drawer scroll) + run **Seed Database → Production → `workouts`** (staging already seeded).
3. **Website** — landing page + a **Support URL** (App-Store-_required_, currently missing). Waitlist/founding-discount **excluded**. → **`BRIEF-4-website.md`**
4. **Pre-launch tidy (small)** — hide Goals for launch (decision C) + gate the Train "Training" segment on having a coach. → **`BRIEF-5-coach-tooling.md` Phase A**
5. **A11y device walkthrough** (VoiceOver/TalkBack) — the remaining manual gate from `BRIEF-1`.

## 2. Tier 1 — Coach tooling (fast-follow; pre-launch only if coach mode must be "complete" at launch)

- Programs tab as the unified entry (Programmes | Workouts | Exercises) + a coach-mode entry to **create exercises** + surface "from my coach" exercises to clients. → **`BRIEF-5-coach-tooling.md` Phase B**
- **Heavily de-risked by the investigation:** client-visibility of coach exercises **already works server-side**; the coach workout-library container already exists and is reusable; exercise create/command/handler are already ownership-generic. This is mostly mobile IA + wiring, not a backend build.

## 3. Tier 2 — GTM heroes (post-submission marketing push)

- **M19 Adaptive Workout AI / "AnyGym"** — premium_plus tier + equipment scan (Snap-AI pattern) + AI workout generation. Author `specs/21-adaptive-workout-ai/`. (`GTM-EXPANSION/BRIEF.md` §3.)
- **M20 Growth loop** — event instrumentation (launch-critical for day-0 data), share card, referrals. Author `specs/22-growth-instrumentation/`. (`GTM BRIEF` §4.)
- These are the "real" marketing-launch features; the GTM brief already scopes them — the follow-up work is **authoring the spec triplets**, not re-planning.

## 4. Tier 3 — B2B org layer (build on first pilot signal)

- **M21 organisations** — org/seat model, invite-code seats (mirror the now-shipped `trainerSeats.ts` enforcement), org-aware entitlement resolution, founder web console, aggregate dashboard. Author `specs/23-organizations/`. (`GTM BRIEF` §5.)
- Per your locked decision: **spec now, build when a real pilot conversation lands.** Manual billing outside the app; SSO/white-label deferred.

## 5. Parallel lanes

| Lane                 | Work                                                     | Brief                      | Independent?                                          |
| -------------------- | -------------------------------------------------------- | -------------------------- | ----------------------------------------------------- |
| **1 · Web**          | Landing + Support URL, waitlist excluded                 | `BRIEF-4-website.md`       | ✅ start now                                          |
| **2 · Mobile coach** | Phase A (pre-launch tidy) → Phase B (coach authoring/IA) | `BRIEF-5-coach-tooling.md` | Phase A touches the same Train-hub surface as Goals-C |
| **3 · Product/spec** | Author GTM spec triplets 21/22/23                        | `GTM-EXPANSION/BRIEF.md`   | ✅ planning-tier, independent                         |
| **4 · Ops (you)**    | Track C dashboards + submission                          | chat runbook / `BRIEF-2`   | ✅ your actions                                       |

Lanes 1, 3, 4 run fully in parallel today. Lane 2 Phase A should land before/with the Goals-C hide (same screen).

## 6. Decisions needed (each unblocks a lane)

- **Website:** Support-URL approach (`/support` page vs `mailto`); **palette** (design brief indigo `#6366f1` on `#0d0f16` vs current `packages/web` orange `#ef5e41` token — one must win); contact email (`admin@` live vs `hello@` in brief); dedicated `/pricing` route yes/no (copy exists in `WEBSITE_PRICING_SPEC.md`).
- **GTM checkpoints** (from `GTM BRIEF` §9): `premium_plus` name/price/ceilings; analytics first-party-vs-PostHog; referral mechanics; B2B seat price. (Free taster already decided: 3 AI generations.)
- **"AnyGym" name** — needs App Store + UK IPO trademark + domain availability check before committing (marketing).
- **Spec-number clash:** the GTM brief calls program-import "spec-20", but `specs/20-sleep-quicklog/` already owns 20 — reassign program-import (e.g. `spec-24-content-import`).

## 7. Corrections captured (from the investigations)

- **AnyGym is a name, not a separate feature** — it's M19-P1/P2 (equipment scan + equipment-aware generation).
- **B2B is not "small"** — multi-tenant orgs + org-aware entitlements; it's a real slice, correctly staged post-launch.
- **Website: nothing to "remove"** — the landing isn't built; waitlist/discount live only in marketing docs. "No discount" = the build session must not add it.
- **Coach client-visibility already works** — `exerciseRepository.buildVisibilityCondition` grants read via active `pt_client_relationships`; no share table needed unless you want _selective_ per-client sharing.
- **`trainer_client_limit` is now enforced** (`trainerSeats.ts`) — the old "unenforced leak" note is stale; M21 seat logic should mirror it.
