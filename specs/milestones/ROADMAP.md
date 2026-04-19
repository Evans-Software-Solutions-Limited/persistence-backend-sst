# Persistence V2 — Milestone Roadmap

High-level milestone list for the Persistence V2 build. Each milestone ships on a shared branch via two parallel PRs (backend + frontend), both gated on an e2e smoke test against `bun run dev` before merge.

See [`../README.md`](../README.md) for the feature-spec index and [`../_agent.md`](../_agent.md) for the execution model.

## Status key

- `not started` — no brief authored yet
- `briefs authored` — `BRIEF.md`, `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md` exist; agents not yet kicked off
- `in flight` — at least one PR open or landed
- `shipped` — both PRs merged, smoke test passed

## Milestones

### M0 — Integration baseline

**Purpose:** close Exercise Library wire-format drift, add missing `POST/PATCH/DELETE /exercises` backend handlers, shift mobile filter UI onto API-sourced reference lists (muscle groups, equipment, categories). Unblocks everything downstream.

- **Status:** not started
- **Parent spec:** [03-exercise-library](../03-exercise-library/) (closes Phases 5–8 gaps + drift)
- **Brief:** [`M0-integration-baseline/BRIEF.md`](./M0-integration-baseline/BRIEF.md)

### M1 — Home / dashboard (incl. HealthKit)

**Purpose:** port legacy home dashboard and ship real `ExpoHealthKitAdapter` (iOS) + Android stub + simulator-mock fallback.

- **Status:** not started
- **Parent specs:** [06-progress-goals](../06-progress-goals/) (dashboard section), [07-health-integration](../07-health-integration/)
- **Brief:** [`M1-home-dashboard/BRIEF.md`](./M1-home-dashboard/BRIEF.md)

### M2 — Workouts (list + create + edit)

**Purpose:** port workouts list, creator, editor; supersets; nested exercise handling; sync queue wiring.

- **Status:** not started
- **Parent spec:** [04-workout-management](../04-workout-management/)
- **Brief:** [`M2-workouts/BRIEF.md`](./M2-workouts/BRIEF.md)

### M3 — Active session (offline-critical)

**Purpose:** offline-first set logger + rest timer + session recovery. Every set persists to SQLite first.

- **Status:** not started
- **Parent spec:** [05-active-session](../05-active-session/)
- **Brief:** [`M3-active-session/BRIEF.md`](./M3-active-session/BRIEF.md)

### M4 — Progress

**Purpose:** PR carousel, stat tiles, trend chart, measurement list + editor.

- **Status:** not started
- **Parent spec:** [06-progress-goals](../06-progress-goals/)
- **Brief:** [`M4-progress/BRIEF.md`](./M4-progress/BRIEF.md)

### M5 — Exercise detail + creator

**Purpose:** close Phases 5–6 of the Exercise Library spec. Detail screen with per-user history; creator using API-driven reference lists (requires M0).

- **Status:** not started
- **Parent spec:** [03-exercise-library](../03-exercise-library/) (Phases 5–6)
- **Brief:** [`M5-exercise-detail-creator/BRIEF.md`](./M5-exercise-detail-creator/BRIEF.md)

### M6 — Profile + Edit profile

**Purpose:** expand `ProfileContainer` to legacy parity; add `EditProfileContainer`; avatar picker.

- **Status:** not started
- **Parent spec:** [08-profile-settings](../08-profile-settings/)
- **Brief:** [`M6-profile/BRIEF.md`](./M6-profile/BRIEF.md)

### M7 — Notifications

**Purpose:** full notifications surface on both sides — list, preferences, device-token registration, deep linking.

- **Status:** not started
- **Parent spec:** [09-notifications-social](../09-notifications-social/) (notifications portion — social deferred beyond M7)
- **Brief:** [`M7-notifications/BRIEF.md`](./M7-notifications/BRIEF.md)

### M8 — Trainer features (role-gated)

**Purpose:** PT/physio client management, invites, workout assignments. 6th `Clients` tab conditional on role.

- **Status:** not started
- **Parent spec:** [10-trainer-features](../10-trainer-features/)
- **Brief:** [`M8-trainer-features/BRIEF.md`](./M8-trainer-features/BRIEF.md)

### M9 — Nutrition tracking (NEW feature)

**Purpose:** net-new full-stack feature (meals, macros, calories, water, daily targets). Not in legacy app — needs its own requirements + design pass before this milestone's briefs are authored.

- **Status:** not started (requirements + design pending)
- **Parent spec:** [13-nutrition-tracking](../13-nutrition-tracking/) (stub; requirements pass scheduled pre-M9)
- **Brief:** [`M9-nutrition/BRIEF.md`](./M9-nutrition/BRIEF.md)

### M10 — Subscriptions & payments (Stripe)

**Purpose:** Stripe webhook receiver, plan catalog, checkout, portal, entitlement; frontend tier selection + feature gates.

- **Status:** not started
- **Parent spec:** [11-payments-subscriptions](../11-payments-subscriptions/)
- **Brief:** [`M10-subscriptions/BRIEF.md`](./M10-subscriptions/BRIEF.md)

### M11 — Polish

**Purpose:** `/frontend-design` pass across the whole app for cohesion; perf audit; accessibility; nav redesign decision; EAS build config; Sentry; release checklist.

- **Status:** not started
- **Parent spec:** [12-production-readiness](../12-production-readiness/)
- **Brief:** [`M11-polish/BRIEF.md`](./M11-polish/BRIEF.md)
