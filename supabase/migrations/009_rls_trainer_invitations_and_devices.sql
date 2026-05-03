-- =====================================================
-- RLS POLICIES FOR TRAINER INVITATIONS AND DEVICES
-- =====================================================

-- =====================================================
-- TRAINER INVITATIONS RLS
-- =====================================================

ALTER TABLE trainer_invitations ENABLE ROW LEVEL SECURITY;

-- Trainers can view their own invitations
CREATE POLICY "Trainers can view own invitations"
    ON trainer_invitations FOR SELECT
    TO authenticated
    USING (trainer_id = auth.uid());

-- Trainers can create invitations
CREATE POLICY "Trainers can create invitations"
    ON trainer_invitations FOR INSERT
    TO authenticated
    WITH CHECK (
        trainer_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND role IN ('personal_trainer', 'physiotherapist')
        )
    );

-- Trainers can update their own invitations (for cancelling)
CREATE POLICY "Trainers can update own invitations"
    ON trainer_invitations FOR UPDATE
    TO authenticated
    USING (trainer_id = auth.uid())
    WITH CHECK (trainer_id = auth.uid());

-- Trainers can delete their own cancelled invitations (optional cleanup)
CREATE POLICY "Trainers can delete own cancelled invitations"
    ON trainer_invitations FOR DELETE
    TO authenticated
    USING (
        trainer_id = auth.uid()
        AND status = 'cancelled'
    );

-- =====================================================
-- USER DEVICES RLS
-- =====================================================

ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

-- Users can view their own devices
CREATE POLICY "Users can view own devices"
    ON user_devices FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Users can register their own devices
CREATE POLICY "Users can register own devices"
    ON user_devices FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Users can update their own devices
CREATE POLICY "Users can update own devices"
    ON user_devices FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Users can delete their own devices
CREATE POLICY "Users can delete own devices"
    ON user_devices FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- =====================================================
-- SUBSCRIPTION PRICE HISTORY RLS
-- =====================================================

ALTER TABLE subscription_price_history ENABLE ROW LEVEL SECURITY;

-- Only admins can view price history
CREATE POLICY "Admins can view price history"
    ON subscription_price_history FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- Only admins can insert price history (via function)
CREATE POLICY "Admins can insert price history"
    ON subscription_price_history FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- No updates or deletes allowed (immutable audit trail)
CREATE POLICY "Price history is immutable"
    ON subscription_price_history FOR UPDATE
    TO authenticated
    USING (false);

CREATE POLICY "Price history cannot be deleted"
    ON subscription_price_history FOR DELETE
    TO authenticated
    USING (false);

