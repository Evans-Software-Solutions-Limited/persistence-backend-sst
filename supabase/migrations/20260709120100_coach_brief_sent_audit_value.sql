-- M17 (Send brief) — extend action_type_enum for the coach → client
-- "Send brief" write (10-trainer-features, reshaped roadmap 2026-07-09).
--
-- POST /trainers/me/clients/:clientId/brief persists the client's
-- notification row and a trainer_actions_audit row (action type
-- 'brief_sent') in ONE transaction per cross-cuts § 1.4.2 — the
-- notification IS the target row for this action, so the audit references
-- the notifications table.
--
-- Why a standalone file: Postgres forbids *using* a newly added enum value
-- in the same transaction that adds it. Keeping the ADD VALUE statement in
-- its own migration (no usage here) sidesteps that entirely — mirrors the
-- M8 precedents (20260705150000_coach_notification_type_on_behalf_values.sql,
-- 20260706170000_workout_unassigned_audit_value.sql).
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op on re-run. Append-only —
-- forward/back safe (a rollback leaves one unused enum value, harmless).

ALTER TYPE action_type_enum ADD VALUE IF NOT EXISTS 'brief_sent';
