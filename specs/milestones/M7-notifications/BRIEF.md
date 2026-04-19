# M7 — Notifications — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent spec:** [`../../09-notifications-social/`](../../09-notifications-social/) (notifications portion — social deferred beyond M7).

**Scope sketch:**

- Backend: add full notifications surface (`GET /notifications`, `PATCH /notifications/:id`, `PATCH /notifications/all`, `GET+POST /notifications/preferences`, `POST /devices/register`).
- Frontend: `NotificationsContainer` + presenter with tap-to-deep-link; `NotificationPreferencesContainer` + presenter with toggle switches; device-token registration on sign-in.
