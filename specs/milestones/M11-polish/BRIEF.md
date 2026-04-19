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

## When this milestone kicks off

Follow the same workflow M0 established ([`../M0-integration-baseline/HANDOVER.md`](../M0-integration-baseline/HANDOVER.md) is the template). In summary:

1. **Write the four brief files first** (`BRIEF.md`, `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`) — replacing this stub. Each brief cites the parent spec(s) as authority.
2. **Audit the parent spec(s) for gaps.** If this milestone's scope adds architecture not yet in `design.md`, or behaviours not yet in `requirements.md`, the first commits on each branch are spec updates — not implementation. See [`../../_agent.md`](../../_agent.md) § Spec-first discipline.
3. **Two branches, two PRs, parallel execution.** One backend branch, one frontend branch, both off fresh `main`. Each PR's commit history starts with spec-update commits, then implementation commits that cite the spec sections they implement.
4. **E2E smoke test against `bun run dev`** before merge. `SMOKE_TEST.md` steps map 1:1 to acceptance criteria in `requirements.md`.

Do not start code on this milestone without briefs authored.
