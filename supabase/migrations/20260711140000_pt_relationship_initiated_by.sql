-- Coach Mode Phase 8 (invite code + QR + coach-accept) — add a direction
-- column to pt_client_relationships so the two pending-creation paths can be
-- told apart, because they have OPPOSITE acceptance directions:
--
--   * Email invite  (trainer-initiated) → the CLIENT accepts
--       (POST /clients/me/relationships/:id/respond + the trigger notifies
--        the client "coach wants to connect").
--   * Invite code   (client-initiated)  → the COACH accepts
--       (POST /trainers/me/relationships/:id/respond, new in Phase 8).
--
-- Without a stored direction the shared create_pt_relationship_notifications
-- trigger cannot know which party to notify, and the client-side respond
-- endpoint would let an athlete self-accept an invite-code pending — which
-- bypasses the confirmed decision #2 ("the coach accepts").
--
-- Default 'trainer' is the SAFE backfill: every historical pending was either
-- an email invite (genuinely trainer-initiated) or a pre-Phase-8 invite-code
-- pending that was, de facto, client-accepted via the trigger's Requests
-- notification. Marking all existing rows 'trainer' keeps those in-flight
-- pendings acceptable on the CLIENT side exactly as they are today — no
-- request gets stranded when both accept surfaces change. Only NEW invite-code
-- redeems (from the updated handler) are written 'client'.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded named CHECK constraint.

ALTER TABLE pt_client_relationships
  ADD COLUMN IF NOT EXISTS initiated_by text NOT NULL DEFAULT 'trainer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pt_client_relationships_initiated_by_check'
  ) THEN
    ALTER TABLE pt_client_relationships
      ADD CONSTRAINT pt_client_relationships_initiated_by_check
      CHECK (initiated_by IN ('trainer', 'client'));
  END IF;
END $$;
