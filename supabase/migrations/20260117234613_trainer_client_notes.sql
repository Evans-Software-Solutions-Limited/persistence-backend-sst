-- =====================================================
-- TRAINER CLIENT NOTES
-- =====================================================

-- Note types enum
CREATE TYPE note_type AS ENUM ('progress', 'injury', 'milestone', 'concern', 'general');

-- Trainer client notes table for ongoing journaling
CREATE TABLE trainer_client_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    note_type note_type DEFAULT 'progress',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_private BOOLEAN DEFAULT false, -- Trainer-only vs shareable with client
    session_id UUID REFERENCES workout_sessions(id) ON DELETE SET NULL, -- Optional link to session
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure trainer-client relationship exists
    FOREIGN KEY (trainer_id, client_id) REFERENCES pt_client_relationships(trainer_id, client_id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_trainer_client_notes_trainer ON trainer_client_notes(trainer_id);
CREATE INDEX idx_trainer_client_notes_client ON trainer_client_notes(client_id);
CREATE INDEX idx_trainer_client_notes_type ON trainer_client_notes(note_type);
CREATE INDEX idx_trainer_client_notes_created ON trainer_client_notes(created_at DESC);
CREATE INDEX idx_trainer_client_notes_session ON trainer_client_notes(session_id) WHERE session_id IS NOT NULL;


-- Enable RLS
ALTER TABLE trainer_client_notes ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- Trainers can manage their client notes
CREATE POLICY "Trainers can manage client notes"
    ON trainer_client_notes FOR ALL
    TO authenticated
    USING (trainer_id = auth.uid())
    WITH CHECK (trainer_id = auth.uid());

-- Clients can view non-private notes from their trainers
CREATE POLICY "Clients can view shared trainer notes"
    ON trainer_client_notes FOR SELECT
    TO authenticated
    USING (
        client_id = auth.uid()
        AND is_private = false
        AND trainer_id IN (
            SELECT trainer_id FROM pt_client_relationships
            WHERE client_id = auth.uid() AND status = 'active'
        )
    );

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Updated at trigger
CREATE TRIGGER update_trainer_client_notes_updated_at
    BEFORE UPDATE ON trainer_client_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE trainer_client_notes IS 'Ongoing trainer notes and journals for client progress tracking';
COMMENT ON COLUMN trainer_client_notes.note_type IS 'Type of note: progress, injury, milestone, concern, or general';
COMMENT ON COLUMN trainer_client_notes.is_private IS 'Whether the note is private to trainer only or shareable with client';
COMMENT ON COLUMN trainer_client_notes.session_id IS 'Optional link to a specific workout session';
