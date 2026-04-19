# M3 — Active session (offline-critical) — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent spec:** [`../../05-active-session/`](../../05-active-session/).

**Scope sketch:**

- Backend: verify session lifecycle is complete (`POST /sessions`, `POST /sessions/:id/exercises`, `POST /sessions/:id/exercises/:id/sets`, `PATCH /sessions/:id`); decide client-vs-server PR detection and document it.
- Frontend: `ActiveSessionContainer` + presenter — exercise list, set logger, rest timer, progress bar; session-start flow from Workouts list; rest timer local + Expo notifications; offline-first critical — every set persists to SQLite first, sync on reconnect; `SessionSummary` post-workout recap.
- Review gate: start a workout, log 3 sets × 3 exercises with rest timer, complete, see summary + session in history. Background the app mid-session and confirm state recovers.
