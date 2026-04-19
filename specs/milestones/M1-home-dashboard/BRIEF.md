# M1 — Home / dashboard (incl. HealthKit) — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent specs:** [`../../06-progress-goals/`](../../06-progress-goals/) (dashboard section), [`../../07-health-integration/`](../../07-health-integration/).

**Scope sketch:**

- Backend: audit `GET /dashboard` response shape against legacy `app/(tabs)/home.tsx` expectations (greeting copy, recent workouts, next goals, activity trend, subscription tier, PR-of-the-week). Expand handler if missing fields.
- Frontend: `HomeContainer` + `HomePresenter` ported from legacy; real `ExpoHealthKitAdapter` (iOS) + Android stub + simulator-mock fallback, all implementing `HealthPort`; 5-min TTL offline cache for dashboard payload; tile grid, section headers, recent activity list; safe-area + staggered entry animations.
- Review gate: Sign in → Home renders real greeting + recent workouts + mocked step count + subscription badge. Pull-to-refresh works.

## When this milestone kicks off

Follow the same workflow M0 established ([`../M0-integration-baseline/HANDOVER.md`](../M0-integration-baseline/HANDOVER.md) is the template). In summary:

1. **Write the four brief files first** (`BRIEF.md`, `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`) — replacing this stub. Each brief cites the parent spec(s) as authority.
2. **Audit the parent spec(s) for gaps.** If this milestone's scope adds architecture not yet in `design.md`, or behaviours not yet in `requirements.md`, the first commits on each branch are spec updates — not implementation. See [`../../_agent.md`](../../_agent.md) § Spec-first discipline.
3. **Two branches, two PRs, parallel execution.** One backend branch, one frontend branch, both off fresh `main`. Each PR's commit history starts with spec-update commits, then implementation commits that cite the spec sections they implement.
4. **E2E smoke test against `bun run dev`** before merge. `SMOKE_TEST.md` steps map 1:1 to acceptance criteria in `requirements.md`.

Do not start code on this milestone without briefs authored.
