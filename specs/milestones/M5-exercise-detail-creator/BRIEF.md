# M5 — Exercise detail + creator — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent spec:** [`../../03-exercise-library/`](../../03-exercise-library/) (Phases 5–6).

**Scope sketch:**

- Backend: extend `GET /exercises/:id` with `user_history` (last 10 sets + PRs for that user+exercise). Optionally: `POST /exercises/classify` for AI classification (deferrable).
- Frontend: `ExerciseDetailContainer` + presenter (media, instructions, PR carousel, recent sets); `ExerciseCreatorContainer` + presenter using API-driven reference lists (M0 prerequisite).
- Review gate: tap card → detail with PRs. Create exercise with AI classification off → appears in Mine.
