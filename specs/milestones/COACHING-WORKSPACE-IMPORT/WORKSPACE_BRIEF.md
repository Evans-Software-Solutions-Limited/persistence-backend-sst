# Web planning and athlete review — agent brief

Authority: spec 36 [requirements](../../36-coaching-workspace-and-athlete-review/requirements.md), [design](../../36-coaching-workspace-and-athlete-review/design.md), [tasks](../../36-coaching-workspace-and-athlete-review/tasks.md). Spec 19 remains the existing programme authority; spec 36 describes its proposed additive extension.

## Responsibilities

1. Backend schedule/self owner: versioned prescriptions and cycle/explicit schedules, populated migration/backfill, owner routes and self-assignment origin, capability matrix, compatible old-client handling. Preserve coached-client guards and session history. Prove round-trip/publish races before importing arbitrary multiweek plans.
2. Backend review owner: deterministic scoped metrics, safe DTO, audience-scoped summary/cache and shared comment flow. Never return `ClientDetail` wholesale or reuse trainer/client/day as sufficient summary cache identity.
3. Web owner: `/workspace` authenticated non-admin shell, keyboard-first programme/workout editor, library/import entry, own progress, and Clients only for eligible coaches. Audit browser auth/CORS rather than copying admin-only settings.
4. Mobile owner: reusable role-neutral authoring model, My training for personal planning/progress, From my coach shared review, and existing coach view consuming the same safe metrics. No athlete coach mode or fabricated self-relationship.

One integration owner coordinates shared contract types, schema ordering and compatibility. Frontends may prepare fixtures/wireframes in parallel; do not treat fixture integration as live backend proof.

## Must demonstrate

Premium Plus user can plan and understand only their own training; no roster leakage. Free coached client can see assigned/shared content under the recommended entitlement choice, without receiving self-import benefits. Two coaches see only their own authorized relationship scope. Identical scope/period/version has identical coach/athlete adherence; rest/cancelled/current-day/future work is handled by the defined denominator. No schedule yields null adherence, not zero effort. Late/offline sync is visible.

Private notes and coach-private AI never enter shared prompts/responses. Revoke consent while a summary runs: coach cannot retrieve it after completion. Edit a programme while an athlete starts a workout: no mixed prescriptions or rewritten history. Show summary unavailable with metrics still usable during provider failure. Verify browser/mobile screenshots, keyboard/accessibility and existing cycles/old-runtime errors.

Return acceptance mapping, tests/screenshots, live-vs-fixture status, migration/release dependencies and remaining product defaults. Do not initiate native builds or auto-publish plans. Current scope session does not itself dispatch production implementation.
