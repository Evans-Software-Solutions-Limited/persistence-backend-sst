# M4 — Progress — BRIEF

Port the legacy Progress tab to V2: PR carousel, stat tiles, trend chart, measurement list + editor, goal CRUD. Mobile-only — all backend handlers already exist.

**Parent spec:** [`../../06-progress-goals/`](../../06-progress-goals/) (covers Phases 5–7 + parts of Phase 1–3 left over from M1).

**Builds on:** [`#73`](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/73) (M10.5 Wave 2) — the merged progress agent shipped a holding-pattern `ProgressContainer` + `ProgressPresenter` that renders the feature gate when denied and a `<ComingSoon />` placeholder when allowed. M4 fills in the placeholder with real PR carousel / stat tiles / trend chart / measurement list, and adds the measurement editor + goal screens.

## What ships

| Surface | Description | Source of truth |
|---|---|---|
| Progress tab content | PR carousel, stat tiles (weekly/monthly volume, sessions, streak), trend chart, recent activity | Legacy `persistence-mobile/components/progress/` |
| Measurement list screen | Body measurements with chart + history list | Legacy `persistence-mobile/components/progress/Measurements/` |
| Measurement editor screen | Form: weight, body fat, chest/waist/hips/arm/thigh, notes; date picker | Legacy `persistence-mobile/components/progress/MeasurementEditor/` |
| Goals list screen | Goals grouped by status (active/completed), progress bars | Legacy `persistence-mobile/components/goals/` |
| Goal editor screen | Form: name, type, target value, target date | Legacy `persistence-mobile/components/goals/GoalEditor/` |
| Personal records list screen | Records grouped by exercise, record type badges | Legacy `persistence-mobile/components/progress/Records/` |
| Trend chart component | SVG line chart with time-range selector (1M / 3M / 6M / 1Y / All) | Legacy `persistence-mobile/components/progress/ProgressChart/` |

## Out of scope

- **Backend handlers** — `progressStatsHandler`, `progressRecordsHandler`, `progressHistoryHandler`, `recordsListHandler`, `measurementsCreateHandler`, `measurementsListHandler`, goals CRUD are all shipped and wired into `api.ts`. Verify response shapes; expand only if a real gap is found.
- **Dashboard surface** — owned by M1, already shipped (PR #35–#38). Don't touch `HomeContainer` / `HomePresenter`.
- **HealthKit integration** — owned by M1, shipped. Don't touch.
- **Subscription gate** — already wired by M10.5 Wave 2 (PR #73). The gate is at the container boundary; M4 fills the allowed-render content, not the gate itself.
- **Achievements** — legacy never built them. Confirmed by Brad in M3 close-out. Skip.

## Dependencies

- **Wave 2 progress scaffolding (PR #73)** — `ProgressContainer` + `ProgressPresenter` files exist. M4 extends them.
- **M3 session data** — PR detection (`detectPersonalRecords`) and session storage already populate the data this milestone reads. No M3 changes.
- **M0 reference lists** — exercise muscle group + equipment lookups already cached. The records-by-exercise screen reads from this cache.

## Execution model

Mobile-only. Single FRONTEND_BRIEF.md, no BACKEND_BRIEF.md needed. One agent in an isolated worktree, background. Orchestrator merges into a fresh `feat/m4-progress` branch off the just-merged Wave 2 work.

If response-shape gaps are found in backend handlers, the agent's first commit is a backend amendment (with handler tests), then mobile work follows. The agent decides this at TRACE time after reading the parent spec response contracts.

## Files

- [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md) — mobile implementation brief
- [`SMOKE_TEST.md`](./SMOKE_TEST.md) — e2e test plan

## Brad — iOS gap review

You'll be running the iOS sim while M4 is in flight. Things to expect on the Progress tab today (post-PR #73 merge):

- Free tier: `FeatureGatePrompt` upgrade card. No content underneath.
- Premium tier: empty `<ComingSoon />` shell. The gate doesn't deny, but there's nothing to render yet.

After M4 lands on premium tier: PR carousel, stat tiles, trend chart, measurement / goals entry points.
