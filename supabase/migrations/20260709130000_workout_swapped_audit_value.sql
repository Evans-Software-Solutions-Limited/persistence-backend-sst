-- M18 (Live-session / Swap) — extend action_type_enum for the coach
-- workout-swap write.
--
-- PATCH /trainers/me/clients/:clientId/workout-assignments/:id replaces an
-- open assignment's workout in place (ad-hoc OR a programme occurrence). The
-- update + trainer_actions_audit row (action 'workout_swapped') land in ONE
-- transaction per cross-cuts § 1.4.2.
--
-- Why a standalone file: Postgres forbids *using* a newly added enum value in
-- the same transaction that adds it. Keeping the ADD VALUE statement in its
-- own migration (no usage here) sidesteps that entirely — mirrors the M8
-- precedent (20260706170000_workout_unassigned_audit_value.sql) and the M17
-- precedent (20260709120100_coach_brief_sent_audit_value.sql).
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op on re-run. Append-only —
-- forward/back safe (a rollback leaves one unused enum value, harmless).

ALTER TYPE action_type_enum ADD VALUE IF NOT EXISTS 'workout_swapped';
