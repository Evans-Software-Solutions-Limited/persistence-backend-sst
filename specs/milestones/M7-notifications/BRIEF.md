# M7 — Notifications — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent spec:** [`../../09-notifications-social/`](../../09-notifications-social/) (notifications portion — social deferred beyond M7).

**Scope sketch:**

- Backend: add full notifications surface (`GET /notifications`, `PATCH /notifications/:id`, `PATCH /notifications/all`, `GET+POST /notifications/preferences`, `POST /devices/register`).
- Frontend: `NotificationsContainer` + presenter with tap-to-deep-link; `NotificationPreferencesContainer` + presenter with toggle switches; device-token registration on sign-in.

## When this milestone kicks off

Follow the same workflow M0 established ([`../M0-integration-baseline/HANDOVER.md`](../M0-integration-baseline/HANDOVER.md) is the template). In summary:

1. **Write the four brief files first** (`BRIEF.md`, `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`) — replacing this stub. Each brief cites the parent spec(s) as authority.
2. **Audit the parent spec(s) for gaps.** If this milestone's scope adds architecture not yet in `design.md`, or behaviours not yet in `requirements.md`, the first commits on each branch are spec updates — not implementation. See [`../../_agent.md`](../../_agent.md) § Spec-first discipline.
3. **Two branches, two PRs, parallel execution.** One backend branch, one frontend branch, both off fresh `main`. Each PR's commit history starts with spec-update commits, then implementation commits that cite the spec sections they implement.
4. **E2E smoke test against `bun run dev`** before merge. `SMOKE_TEST.md` steps map 1:1 to acceptance criteria in `requirements.md`.

Do not start code on this milestone without briefs authored.
