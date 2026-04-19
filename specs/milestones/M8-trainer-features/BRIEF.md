# M8 — Trainer features (role-gated) — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent spec:** [`../../10-trainer-features/`](../../10-trainer-features/).

**Scope sketch:**

- Backend: add `GET /trainers/me/clients`, `GET /trainers/me/invitations/pending`, `POST /trainers/me/invite`, `DELETE /trainers/me/invitations/:id`, `POST /workout-assignments`, `GET /trainers/me/stats`; JWT role check.
- Frontend: add 6th tab `Clients` conditional on `session.role === "personal_trainer" || "physiotherapist"`; `ClientsContainer` + presenter, invite sheet, assign-workout flow.
- Review gate: sign in as trainer → see Clients tab → invite a client → cancel invite → assign a workout.
