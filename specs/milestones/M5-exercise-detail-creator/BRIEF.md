# M5 — Exercise detail + creator — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent spec:** [`../../03-exercise-library/`](../../03-exercise-library/) (Phases 5–6).

**Scope sketch:**

- Backend: extend `GET /exercises/:id` with `user_history` (last 10 sets + PRs for that user+exercise). Optionally: `POST /exercises/classify` for AI classification (deferrable).
- Frontend: `ExerciseDetailContainer` + presenter (media, instructions, PR carousel, recent sets); `ExerciseCreatorContainer` + presenter using API-driven reference lists (M0 prerequisite).
- Review gate: tap card → detail with PRs. Create exercise with AI classification off → appears in Mine.

## When this milestone kicks off

Follow the same workflow M0 established ([`../M0-integration-baseline/HANDOVER.md`](../M0-integration-baseline/HANDOVER.md) is the template). In summary:

1. **Write the four brief files first** (`BRIEF.md`, `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`) — replacing this stub. Each brief cites the parent spec(s) as authority.
2. **Audit the parent spec(s) for gaps.** If this milestone's scope adds architecture not yet in `design.md`, or behaviours not yet in `requirements.md`, the first commits on each branch are spec updates — not implementation. See [`../../_agent.md`](../../_agent.md) § Spec-first discipline.
3. **Two branches, two PRs, parallel execution.** One backend branch, one frontend branch, both off fresh `main`. Each PR's commit history starts with spec-update commits, then implementation commits that cite the spec sections they implement.
4. **E2E smoke test against `bun run dev`** before merge. `SMOKE_TEST.md` steps map 1:1 to acceptance criteria in `requirements.md`.

Do not start code on this milestone without briefs authored.
