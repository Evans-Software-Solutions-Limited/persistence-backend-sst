# Persistence V2 — Milestone Roadmap

> **Scope sign-off: 2026-05-28.** After the May 2026 design-package port + the cleanup pass, this roadmap is the final scoping artifact for future agents. Every shipped milestone has its folder deleted (git history is canonical). Every open workstream lives in a rewritten `specs/0N-*/` triplet — no milestone-level briefs remain. Agents work from `tasks.md` inside each spec.
>
> If a piece of work doesn't have a spec section to cite, that's a spec-update commit first. See [`../_agent.md`](../_agent.md) § Spec-first discipline.

---

## How to use this roadmap

1. **Section 1 — Shipped.** What's live in `main`. Reference only.
2. **Section 2 — Active workstream.** The design-system port. Ten ready spec triplets, executed against `tasks.md` per spec. Phase ordering preserved.
3. **Section 3 — Spec slot status.** Per-slot state for the 15 numbered slots + `_shared/`.
4. **Section 4 — Scope boundaries.** What's deliberately not on this roadmap.
5. **Section 5 — Queued post-merge follow-ups.** Near-term work captured + agreed, parked behind the current merge. Each needs a spec-update commit (per the discipline below) when picked up.

There is no "open milestones" section any more — everything alive is in Section 2.

---

## Spec-first discipline

Before any implementation commit, the parent feature spec(s) must cover the work. If they don't, the first commits are **spec updates** — extending `design.md`, appending ACs to `requirements.md`, marking scope in `tasks.md`. Then implementation commits cite the sections they implement.

When a primitive / endpoint / behaviour is discovered missing mid-implementation, the resolution is always: pause work → spec amendment (revised-date append) → resume against the updated spec. Never silently expand scope.

See [`../_agent.md`](../_agent.md) for full rules. See [`../README.md`](../README.md) for the feature-spec index.

---

## Section 1 — Shipped

Folders deleted; git is canonical.

| Milestone                         | What shipped                                                                | Merged PRs     | Shipped                 |
| --------------------------------- | --------------------------------------------------------------------------- | -------------- | ----------------------- |
| **M0 Integration baseline**       | Exercise library wire-format + backend writes + filter sourcing             | #29–#33        | 2026-04-22              |
| **M1 Home + iOS HealthKit**       | Home dashboard + ExpoHealthKitAdapter (iOS) + Android stub                  | (pre-#67)      | ~2026-04                |
| **M2 Workouts CRUD**              | Workouts list/creator/editor + supersets + sync queue                       | (pre-#67)      | ~2026-04                |
| **M3 Active session**             | Set logger + rest timer + recovery + summary + exact-rep PR detection       | (pre-#67)      | ~2026-04                |
| **M6 Profile + Edit**             | Profile tab + edit + avatar upload                                          | #67, #68       | 2026-05-17 / 2026-05-19 |
| **M10 Stripe subscriptions**      | Stripe screens + backend reads (catalog + entitlement + POST extensions)    | #69, #70, #71  | 2026-05-22 / 2026-05-24 |
| **M10.5 Entitlement Wave 1**      | `assertEntitlement` + feature-gate primitives + offline UX                  | #72            | 2026-05-24              |
| **M10.5 Entitlement Wave 2**      | Per-screen gate integration (workouts / progress / trainer placeholders)    | #73            | 2026-05-27              |
| **M10.6 Sync-queue entitlement**  | Mobile sync catches 402 + `blocked_entitlement` + auto-retry on tier change | #73 (combined) | 2026-05-27              |
| **M7 Notifications backend**      | 6 endpoints + JSONB preferences + atomic merge + COALESCE read semantics    | #81            | 2026-05-27              |
| **M12 Compliance / legal / help** | Privacy, terms, help, contact, privacy-settings ported 1:1                  | #80            | 2026-05-27              |

11 milestone-tracked deliveries shipped. Plus spec authoring PRs (#74–#79) and the design-port spec rewrites on 2026-05-27/28.

### Shipped (continued — status refresh 2026-07-05)

| Delivery                                 | What shipped                                                                                                                                                                  | Merged PRs                   | Shipped    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------- |
| **04-workout-management (design-port)**  | Train hub: Workouts list, Exercises list, CreateExerciseSheet, ExerciseDetail + Editor                                                                                        | #95–#97, #99                 | 2026-06    |
| **05-active-session (design-port)**      | Active session rebuild, minimise overlay, Summary, Rating (phases 05.1–05.7)                                                                                                  | #110                         | 2026-06-08 |
| **06-progress-goals (M4 + design-port)** | Backend streaks/habits/volume/Home/You + mobile Home re-skin, You, WeighInSheet, offline cache                                                                                | #116–#118, #122              | 2026-06    |
| **09-notifications-social (mobile)**     | Notifications feature (list/preferences/badge) + push delivery via Expo Push API                                                                                              | #104, #142, #143             | 2026-06    |
| **17-payments-reliability**              | Stripe hardening phases A–D + client idempotency keys                                                                                                                         | #100, #101                   | 2026-06    |
| **07-health-integration (connect)**      | Apple Health connect screen, steps→Home rings, HealthKit weight/body-fat push (cross-device)                                                                                  | #121, #145                   | 2026-06/07 |
| **11-payments (RevenueCat rail)**        | Manage-subscription drawer + RevenueCat webhook backend; native Apple Sign In                                                                                                 | #126, #133                   | 2026-06    |
| **10-trainer-features (partial)**        | Coach You + invites, Clients roster, client accept flow, coach body-fat/weight + Client Detail interim trend                                                                  | #123, #125, #136, #146       | 2026-06/07 |
| **12-production-readiness (compliance)** | OFF foods + exercise seed, NSPhotoLibrary string, in-app account deletion (Apple 5.1.1(v)), push delivery                                                                     | #139–#142                    | 2026-06-28 |
| **13-nutrition M9 Tier A (Fuel)**        | Backend (entries/targets/water/barcode/recipes/meals/streak/OFF seed) + mobile Fuel + Targets TDEE + follow-ups                                                               | #124, #135, #138, #144, #147 | 2026-06/07 |
| **18-habit-setup (backend chunk 1)**     | Habit config schema + backend                                                                                                                                                 | #129                         | 2026-06    |
| **19-programs (unified model, backend)** | Spec + schema/scheduling/repositories + endpoints/adherence/dashboard/library integration                                                                                     | #148, #149, #152             | 2026-07    |
| **13-nutrition M9.5 Tier B (Snap AI)**   | Bedrock AI photo + free-text estimation: spec, backend (`ai_access`, both endpoints, usage log), mobile Snap sheet + free-text, daily cost ceilings, trainer-tier `ai_access` | #151, #153–#156              | 2026-07-05 |

---

## Section 2 — Active workstream: design-system port

Authoritative reference: [`../../docs/design-port-audit.md`](../../docs/design-port-audit.md).

Goal: port the May 2026 prototype + design package into V2. Ten specs rewritten from scratch on 2026-05-27/28 to absorb the design package. **No milestone-level briefs are authored** — the rewritten spec triplets are the execution contract. Each spec's `tasks.md` is phased into PRs.

### Phase ordering

```
01-design-system        (tokens + 22 primitives + codemod + adoption sweep)
        ↓
14-navigation           (Option 3 nav + useUserMode + ProfileDrawer mount + Train hub + ComingSoon Fuel)
        ↓
08-profile-settings     (ProfileDrawer body + mode-switch card + sub-page shell refreshes)
        ↓
04-workout-management   ┐
05-active-session       ├── fan-out in parallel (each independent under the new IA)
06-progress-goals       │   incl. Home (per audit option A)
                        ┘
        ↓
09-notifications-social (mobile frontend — backend already shipped per #81)
        ↓
10-trainer-features     (Coach mode + on-behalf + audit + programs + notes)
        ↓
13-nutrition-tracking   (Fuel M9 Tier A + M9.5 Tier B AI-gated)
        ↓
12-production-readiness (LegacyTheme deletion + a11y + perf + Sentry + EAS + Apple IAP + App Store)
```

Plus one small append to `03-exercise-library` (per Section 3 below) — `GET /exercises/:id` user-history extension, scheduled to land in the M4 backend window so it can read from `personal_records` table once that ships.

### Phase status (refreshed 2026-07-05; original sign-off 2026-05-28)

| Spec                      | Status                                                                                                                                                                                                                                             | Owns                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `01-design-system`        | **shipped** (#83)                                                                                                                                                                                                                                  | 22 primitives, tokens, fonts, codemod, adoption sweep                  |
| `14-navigation`           | **shipped** (#93)                                                                                                                                                                                                                                  | Option 3 nav, `useUserMode`, drawer mount, Train hub                   |
| `08-profile-settings`     | **shipped** (#94, +#132 fix)                                                                                                                                                                                                                       | ProfileDrawer body, mode-switch, sub-page refreshes                    |
| `04-workout-management`   | **shipped** (#95–#97, #99; 04.4/04.5/04.7 residual cleanup)                                                                                                                                                                                        | Workouts list/detail/create/edit, CreateExercise sheet, ExerciseDetail |
| `05-active-session`       | **shipped** (#110)                                                                                                                                                                                                                                 | Active session rebuild + minimise overlay + Summary + Rating           |
| `06-progress-goals`       | **shipped** (#116–#118, #122; habits-setup mobile screen still missing — see 18)                                                                                                                                                                   | Home + You/Progress + M4 backend (streaks/habits/PRs)                  |
| `09-notifications-social` | **shipped** (#81 backend, #104 mobile, #142 push delivery; social features remain post-launch)                                                                                                                                                     | List + preferences + bell badge + push registration                    |
| `10-trainer-features`     | **partial** — Coach You/invites/roster/accept (#123/#125/#136), body-fat + Client Detail interim (#146). Open: Coach Home (needs design call), full Client Detail 10.9.3, on-behalf + audit, notes, EditNutritionTargets sheet, programs mobile    | Coach mode, on-behalf, audit log, notes, attribution badges            |
| `13-nutrition-tracking`   | **shipped** M9 Tier A (#124/#135/#138/#144/#147) + M9.5 Tier B Snap AI (#151/#153–#156). Open: STORY-013 recipe-photo extract (deferred), Fuel day-picker (needs spec), trainer-granted client `ai_access` (needs spec)                            | Fuel + AI estimation                                                   |
| `12-production-readiness` | **partial** — compliance blockers done (#139–#142: seeds, permission string, account deletion, push). Open: **Apple IAP mobile purchase flow (react-native-purchases) = the App Store blocker**, perf/a11y/Sentry/EAS pipeline, LegacyTheme retire | Terminal polish + App Store readiness                                  |

Specs added after the 2026-05-28 sign-off: `17-payments-reliability` (**shipped** #100/#101), `18-habit-setup` (**backend chunk 1** #129; mobile setup screen not started), `19-programs` unified Programs/Workouts model (**backend shipped** #148/#149/#152; mobile coach F1 + athlete Home F2 not started), `15/16-exercise AI + media` (specced in #97's window, not implemented).

Each spec's `tasks.md` lists its phases + per-PR scope. Implementation picks a phase + opens PRs against the spec.

---

## Section 3 — Spec slot status

| Slot                        | State                     | Notes                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-guardrails`             | untouched                 | Process / quality gates; not feature-bearing.                                                                                                                                                                                                                 |
| `01-design-system`          | rewritten 2026-05-27      | Foundation.                                                                                                                                                                                                                                                   |
| `02-auth-flow`              | untouched                 | Auth screens not in design-port scope; refresh deferred to a post-launch design pass.                                                                                                                                                                         |
| `03-exercise-library`       | revised-append 2026-05-28 | Existing spec preserved; one "Revised 2026-05-28" append at the end of `design.md` covers the `GET /exercises/:id` user-history extension absorbed from the former M5 milestone. Implementation lands in the M4 backend window once `personal_records` ships. |
| `04-workout-management`     | rewritten 2026-05-27      | Train hub content. Absorbed M5 frontend scope (Exercise create sheet, detail, edit).                                                                                                                                                                          |
| `05-active-session`         | rewritten 2026-05-27      | Active session rebuild + minimise overlay.                                                                                                                                                                                                                    |
| `06-progress-goals`         | rewritten 2026-05-27      | Includes Home (audit option A).                                                                                                                                                                                                                               |
| `07-health-integration`     | untouched                 | HealthKit adapter shipped per M1; design-port doesn't change the adapter.                                                                                                                                                                                     |
| `08-profile-settings`       | rewritten 2026-05-27      | ProfileDrawer + sub-page refreshes.                                                                                                                                                                                                                           |
| `09-notifications-social`   | rewritten 2026-05-28      | Mobile frontend; backend shipped per #81.                                                                                                                                                                                                                     |
| `10-trainer-features`       | rewritten 2026-05-27      | Coach mode + cross-cuts implementation.                                                                                                                                                                                                                       |
| `11-payments-subscriptions` | untouched                 | M10/M10.5/M10.6 shipped against this spec; iOS IAP work picks it up in `12-production-readiness`.                                                                                                                                                             |
| `12-production-readiness`   | rewritten 2026-05-28      | Terminal polish + App Store readiness. Absorbed all M11 scope.                                                                                                                                                                                                |
| `13-nutrition-tracking`     | rewritten 2026-05-27      | Fuel M9 + M9.5.                                                                                                                                                                                                                                               |
| `14-navigation`             | new 2026-05-27            | Option 3 nav + state primitives.                                                                                                                                                                                                                              |
| `_shared/cross-cuts.md`     | locked 2026-05-25         | Untouched. Referenced by 06 + 10 + 13.                                                                                                                                                                                                                        |

**Summary:** 10 rewritten/new + 1 revised-append + 5 untouched (`00`, `02`, `03 untouched body`, `07`, `11`) + 1 locked (`_shared`). All in scope is documented; no orphaned milestones.

---

## Section 4 — Scope boundaries (deliberately not on this roadmap)

- **Design-port milestone briefs** — not authored. The rewritten spec triplets are the execution contract; each `tasks.md` is the phased work plan. Future agents pick a phase per spec, open PRs, cite spec sections in commits.
- **Light theme** — out of scope for v1. Multiple specs explicitly defer this. v2 consideration.
- **Localisation** — English-only for v1.
- **AI-classify exercise feature (former M5 mention)** — **not** post-launch new; the classification path is already supported by the legacy backend. V2 work is a small port wiring the existing capability into the `04-workout-management` Create Exercise sheet, gated per cross-cuts § 4. Scoped in `03-exercise-library/design.md § Revised 2026-05-28 > POST /exercises/classify`. Can land as an independent follow-up PR once `04` ships.
- **Social features (friends, feed, comments)** — `09-notifications-social` keeps the slot name but social is post-launch.
- **Onboarding redesign** — `02-auth-flow` untouched in this port. Polish-pass only in `12-production-readiness`.
- **Marketing site** — `apps/web/` marketing site separate from this roadmap. Privacy policy export is owned in `12-production-readiness` STORY-009.
- **A/B testing infrastructure** — post-launch.

---

## Section 5 — Queued post-merge follow-ups

Agreed work that is **parked behind the current M9 (Fuel) merge**. These are intended to ship, not scope-boundaries. When a follow-up is picked up, the first commits update the cited spec triplet(s) per the spec-first discipline, then implementation follows.

### 5.1 — Manual sleep logging (Home quick-log "Sleep" tile) + HealthKit

The Home quick-log strip's **"Mood" tile is renamed to "Sleep"**, letting the user log how much sleep they had. Decided approach (mirrors the WeighIn weight pattern): the manual entry writes a **durable backend `sleep_data` record AND mirrors to Apple HealthKit best-effort**; reads prefer HealthKit when available, so the Home "sleep" micro-pill stays truthful.

Cross-domain — spec homes + work:

- **Backend (`microservices/core` + migration):** add `'manual'` to the `health_provider` enum (`packages/db` schema + a Supabase migration), and a `POST /health/sleep` (+ `GET`) handler writing `sleep_data` (`sleep_date`, `duration_minutes`, `data_source='manual'`, unique on `(user_id, sleep_date, data_source)`). Owner: backend; **outside the M9 mobile brief's lane.**
- **`07-health-integration`:** add `writeSleep(start, end)` / `getSleepLastNight()` to the health port + the expo-healthkit adapter + InMemory double + Android stub. HealthKit sleep is a category sample (start/end) — device-only, not CI-verifiable (same caveat as existing HealthKit reads).
- **`06-progress-goals`:** the Home quick-log Mood→Sleep rename + a `<SleepLogSheet>` (hours/duration entry, BottomSheet like WeighIn). Mobile data layer: `api.port` `logSleep`/`getSleepToday`, a `sleep_log` sync-queue entity + cache + hook.

Mobile UI/data layer is in-lane; the backend endpoint + migration and the health-port additions are the cross-boundary parts. Sequence as its own slice (own branch). Recommended split when actioned: backend endpoint + migration first (or in parallel), then the mobile + health-port vertical against that contract.

### 5.2 — Coach: view + record client body weight

Coaches should be able to **see a client's body-weight history** and **record a logged weight on the client's behalf**.

- **`10-trainer-features`:** reuse the existing on-behalf write + attribution + audit pattern (`set_by` / `logged_by_user_id` per `_shared/cross-cuts.md` §1) so a coach-recorded weight is attributed + audited, and surface the client's weight trend in Client Detail.
- **`06-progress-goals`:** the `body_measurements` log + weigh-in flow already exist for the athlete; this extends read + on-behalf write to the trainer surface.

**SHIPPED 2026-07-02** via #145 (HealthKit weight/body-fat push) + #146 (coach body-fat logging, `GET /clients/:clientId/body-trend`, Client Detail interim trend + Log weight CTA).

### 5.3 — AI import of programs/workouts (screenshots / photos / links / PDF)

**Brad-committed 2026-07-05.** Coaches and premium athletes can import an external
program or workout — screenshot, photo, shared link, or PDF — and the app parses it
into real, loggable rows in the unified Programs/Workouts model (spec 19). Big product
USP alongside the AI client summary.

Deliberately **its own workstream** — NOT part of the coach-completion brief. When
picked up: Phase-0 accuracy eval first (sample screenshots/links → parse quality, per
the M9.5 playbook), then an own spec triplet (suggest `specs/20-content-import/`).
Reuses shipped foundations: the Bedrock forced-tool-use adapter seam (M9.5), the
SSRF-hardened link fetch (`/recipes/import`), the `ai_access` gate + daily AI ceilings,
and the always-editable-draft-before-create principle. Hard problem to eval early:
fuzzy exercise-name → exercise-library resolution.

---

_End of `specs/milestones/ROADMAP.md` · 2026-05-28 (scope sign-off) · Revised 2026-06-26 (Section 5) · Revised 2026-07-05 (status refresh: Section 1 continued table, phase-status table, 5.2 shipped) · Revised 2026-07-05 (§ 5.3 queued — AI program/workout import)_
