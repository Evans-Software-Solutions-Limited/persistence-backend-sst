-- Repoint the client-facing "trainer wants to connect" notification deeplink
-- from the dead-end profile screen to the new in-app Requests screen, where
-- the client can actually accept/decline the pending request.
--
-- Background: `create_pt_relationship_notifications()` (002) fires on a
-- pending INSERT into pt_client_relationships and notifies the CLIENT that a
-- coach wants to connect. It deeplinked to `persistencemobile://profile`,
-- which has no accept affordance — so the request was unreachable in-app.
-- M10 adds POST /clients/me/relationships/:id/respond + a Requests screen
-- reached via `persistencemobile://requests?relationshipId=<id>`.
--
-- This migration only changes the deeplink for the human-trainer case (the
-- AI-trainer branch is an auto-active self relationship with nothing to
-- accept, so it keeps pointing at profile). Everything else in the function
-- is preserved verbatim. `SET search_path = public` is re-declared inline so
-- the 2026-06-26 security hardening (20260626104757) is not lost by the
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

    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
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

    IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'active' AND NEW.is_ai_trainer = false THEN
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
