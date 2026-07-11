-- Coach Mode Phase 8 — make create_pt_relationship_notifications() honour the
-- new pt_client_relationships.initiated_by direction column so it notifies the
-- correct party for each pending-creation / acceptance path.
--
-- Background: the previous version (20260626130000) notified the CLIENT on
-- every pending INSERT ("coach wants to connect" → Requests screen) and the
-- TRAINER on every pending→active UPDATE ("client accepted your request").
-- That is correct ONLY for trainer-initiated (email-invite) relationships. For
-- client-initiated (invite-code) relationships the directions are reversed:
--   * on the pending INSERT the COACH must be told a client wants to join
--     (and must accept) — NOT the athlete told to accept, which would let the
--     athlete self-accept and bypass decision #2 ("the coach accepts");
--   * on the pending→active UPDATE the ATHLETE must be told the coach accepted
--     — NOT the coach told "the client accepted".
--
-- Rather than encode both new directions in SQL (which would only ever insert
-- an in-app row, losing the push the app-code dispatcher gives), this function
-- SKIPS the client-initiated cases and lets the invite-code redeem handler
-- (trainer notification) and the coach-accept handler (athlete notification)
-- emit them through NotificationDispatcher (in-app row + preference-gated
-- push). Trainer-initiated (email-invite) behaviour is preserved verbatim, so
-- the M10 client-accept flow is completely unchanged.
--
-- initiated_by defaults to 'trainer', so every existing row and every
-- email-invite pending keeps the previous behaviour. `SET search_path = public`
-- is re-declared inline so the 2026-06-26 security hardening survives the
-- CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION create_pt_relationship_notifications()
RETURNS TRIGGER
SET search_path = public
AS $$
DECLARE
    v_trainer_role user_role;
    v_relationship_type TEXT;
BEGIN
    -- Handle DELETE operation (no notification created, just return OLD)
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    -- For INSERT and UPDATE, NEW is available
    SELECT role INTO v_trainer_role
    FROM profiles
    WHERE id = NEW.trainer_id;

    v_relationship_type := CASE
        WHEN NEW.is_ai_trainer THEN 'AI Trainer'
        WHEN v_trainer_role = 'physiotherapist' THEN 'Physiotherapist'
        WHEN v_trainer_role = 'personal_trainer' THEN 'Personal Trainer'
        ELSE 'Trainer'
    END;

    -- Pending INSERT. The AI self-relationship and trainer-initiated
    -- (email-invite) pendings notify the CLIENT as before. Client-initiated
    -- (invite-code) pendings are skipped here — the redeem handler notifies the
    -- coach with a push instead.
    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
        IF NEW.is_ai_trainer OR NEW.initiated_by = 'trainer' THEN
            INSERT INTO notifications (
                user_id, type, title, message, related_entity_type, related_entity_id, data
            )
            SELECT
                NEW.client_id,
                (CASE
                    WHEN NEW.is_ai_trainer THEN 'pt_request'
                    WHEN v_trainer_role = 'physiotherapist' THEN 'physio_request'
                    ELSE 'pt_request'
                END)::notification_type,
                CASE
                    WHEN NEW.is_ai_trainer THEN 'AI Personal Trainer'
                    WHEN v_trainer_role = 'physiotherapist' THEN 'Physiotherapist Request'
                    ELSE 'Training Request'
                END,
                CASE
                    WHEN NEW.is_ai_trainer THEN 'Your AI Personal Trainer is ready to help you reach your goals'
                    ELSE (SELECT full_name FROM profiles WHERE id = NEW.trainer_id) ||
                         ' wants to be your ' || LOWER(v_relationship_type)
                END,
                'pt_relationship',
                NEW.id,
                jsonb_build_object(
                    'is_ai_trainer', NEW.is_ai_trainer,
                    'trainer_role', v_trainer_role,
                    'relationship_reason', NEW.relationship_reason,
                    -- AI trainer (auto-active self relationship) → profile; a real
                    -- coach request → the Requests screen so the client can accept.
                    'deeplink', CASE
                        WHEN NEW.is_ai_trainer THEN 'persistencemobile://profile'
                        ELSE 'persistencemobile://requests?relationshipId=' || NEW.id::text
                    END,
                    'trainer_id', NEW.trainer_id::text,
                    'relationship_id', NEW.id::text
                );
        END IF;
    END IF;

    -- Pending → active. Trainer-initiated (email-invite, client-accepted) still
    -- notifies the TRAINER. Client-initiated (invite-code, coach-accepted) is
    -- skipped — the coach-accept handler notifies the ATHLETE with a push.
    IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'active'
       AND NEW.is_ai_trainer = false AND NEW.initiated_by = 'trainer' THEN
        INSERT INTO notifications (
            user_id, type, title, message, related_entity_type, related_entity_id, data
        )
        SELECT
            NEW.trainer_id,
            (CASE
                WHEN v_trainer_role = 'physiotherapist' THEN 'physio_accepted'
                ELSE 'pt_accepted'
            END)::notification_type,
            'Client Accepted',
            (SELECT full_name FROM profiles WHERE id = NEW.client_id) || ' accepted your request',
            'pt_relationship',
            NEW.id,
            jsonb_build_object(
                'deeplink', 'persistencemobile://clients?clientId=' || NEW.client_id::text,
                'client_id', NEW.client_id::text,
                'relationship_id', NEW.id::text
            );
    END IF;

    -- Return NEW for INSERT and UPDATE operations
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
