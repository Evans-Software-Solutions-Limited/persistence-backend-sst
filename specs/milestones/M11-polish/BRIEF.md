# M11 — Polish — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent spec:** [`../../12-production-readiness/`](../../12-production-readiness/).

**Scope sketch:**

- `/frontend-design` pass across the whole app for cohesion.
- Performance: FlatList→FlashList, `expo-image` rollout with blur placeholders, animation jank audit.
- Empty/error/loading state consistency sweep.
- Accessibility (touch targets, screen-reader labels, contrast AA).
- Navigation redesign decision: by now the app has Home + Progress + Workouts + Exercises + Nutrition + Profile + optional Clients for trainers = 6 or 7 tabs. Likely drop one into Profile menu or use a drawer for power features.
- EAS build config, Sentry, release checklist.
