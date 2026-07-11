-- Coach Mode Phase 8 — extend action_type_enum for the coach's accept/decline
-- of a client-initiated (invite-code) pending relationship.
--
--   client_request_accepted — POST /trainers/me/relationships/:id/respond
--       (action=accept): the coach accepted; the relationship goes
--       pending → active. Audited alongside the activation in ONE transaction
--       (cross-cuts § 1.4.2), target = the pt_client_relationships row.
--   client_request_declined — same endpoint (action=decline): the coach
--       declined; the relationship goes pending → terminated.
--
-- Both are trainer-initiated writes to a client's relationship, so per
-- cross-cuts § 1.4 they carry an audit row.
--
-- Per cross-cuts § 5 action_type_enum is owned by 10-trainer-features; this
-- slice sequences its own ADD VALUEs before the handler emits.
--
-- Why a standalone file: Postgres forbids *using* a newly added enum value in
-- the same transaction that adds it. Adding (not using) both values here is
-- safe — mirrors the brief_sent / workout_swapped precedents. Both statements
-- are idempotent (ADD VALUE IF NOT EXISTS) and append-only (forward/back safe).

ALTER TYPE action_type_enum ADD VALUE IF NOT EXISTS 'client_request_accepted';
ALTER TYPE action_type_enum ADD VALUE IF NOT EXISTS 'client_request_declined';
