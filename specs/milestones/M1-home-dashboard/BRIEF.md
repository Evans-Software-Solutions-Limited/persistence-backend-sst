# M1 — Home / dashboard (incl. HealthKit) — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent specs:** [`../../06-progress-goals/`](../../06-progress-goals/) (dashboard section), [`../../07-health-integration/`](../../07-health-integration/).

**Scope sketch:**

- Backend: audit `GET /dashboard` response shape against legacy `app/(tabs)/home.tsx` expectations (greeting copy, recent workouts, next goals, activity trend, subscription tier, PR-of-the-week). Expand handler if missing fields.
- Frontend: `HomeContainer` + `HomePresenter` ported from legacy; real `ExpoHealthKitAdapter` (iOS) + Android stub + simulator-mock fallback, all implementing `HealthPort`; 5-min TTL offline cache for dashboard payload; tile grid, section headers, recent activity list; safe-area + staggered entry animations.
- Review gate: Sign in → Home renders real greeting + recent workouts + mocked step count + subscription badge. Pull-to-refresh works.
