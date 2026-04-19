# M3 — Active session (offline-critical) — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent spec:** [`../../05-active-session/`](../../05-active-session/).

**Scope sketch:**

- Backend: verify session lifecycle is complete (`POST /sessions`, `POST /sessions/:id/exercises`, `POST /sessions/:id/exercises/:id/sets`, `PATCH /sessions/:id`); decide client-vs-server PR detection and document it.
- Frontend: `ActiveSessionContainer` + presenter — exercise list, set logger, rest timer, progress bar; session-start flow from Workouts list; rest timer local + Expo notifications; offline-first critical — every set persists to SQLite first, sync on reconnect; `SessionSummary` post-workout recap.
- Review gate: start a workout, log 3 sets × 3 exercises with rest timer, complete, see summary + session in history. Background the app mid-session and confirm state recovers.

## When this milestone kicks off

Follow the same workflow M0 established ([`../M0-integration-baseline/HANDOVER.md`](../M0-integration-baseline/HANDOVER.md) is the template). In summary:

1. **Write the four brief files first** (`BRIEF.md`, `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`) — replacing this stub. Each brief cites the parent spec(s) as authority.
2. **Audit the parent spec(s) for gaps.** If this milestone's scope adds architecture not yet in `design.md`, or behaviours not yet in `requirements.md`, the first commits on each branch are spec updates — not implementation. See [`../../_agent.md`](../../_agent.md) § Spec-first discipline.
3. **Two branches, two PRs, parallel execution.** One backend branch, one frontend branch, both off fresh `main`. Each PR's commit history starts with spec-update commits, then implementation commits that cite the spec sections they implement.
4. **E2E smoke test against `bun run dev`** before merge. `SMOKE_TEST.md` steps map 1:1 to acceptance criteria in `requirements.md`.

Do not start code on this milestone without briefs authored.
