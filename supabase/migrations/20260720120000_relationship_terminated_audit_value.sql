-- 25-coach-client-offboarding — extend action_type_enum for the relationship
-- teardown audit row.
--
--   relationship_terminated — a coach↔client relationship was ended (coach
--     removed a client via DELETE /trainers/me/clients/:clientId, or a client
--     left a coach via DELETE /clients/me/relationships/:relationshipId). The
--     soft-end UPDATE + the assignment-teardown deletes + this audit row land
--     in ONE transaction (cross-cuts § 1.4.2). payload.initiatedBy records the
--     direction ('trainer' | 'client').
--
-- Why a standalone file: Postgres forbids *using* a newly added enum value in
-- the same transaction that adds it. Keeping the ADD VALUE statement in its
-- own migration (no usage here) sidesteps that entirely — mirrors the M8
-- precedent (20260706170000_workout_unassigned_audit_value.sql).
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op on re-run. Append-only —
-- forward/back safe (a rollback leaves one unused enum value, harmless).

ALTER TYPE action_type_enum ADD VALUE IF NOT EXISTS 'relationship_terminated';
