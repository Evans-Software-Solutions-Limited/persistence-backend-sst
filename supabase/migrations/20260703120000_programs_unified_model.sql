-- Programs unified model (specs/19-programs, M13 PR B1).
--
-- Reshapes the dormant week-structured programme tables into the approved
-- flat-cycle model and adds programme→client assignment tracking:
--
--   1. workout_programs: total_weeks → duration_weeks (nullable — NULL means
--      an INDEFINITE programme, e.g. an ongoing weight-loss plan) +
--      days_per_week metadata (drives occurrence scheduling).
--   2. program_weeks is dropped; program_workouts is recreated FLAT
--      (program_id, workout_id, position). Position is the 0-based order in
--      the cycle; the same workout may repeat (e.g. Push/Pull/Legs/Push), so
--      there is deliberately NO unique (program_id, workout_id).
--   3. New program_assignments — one row per programme→client assignment.
--      end_date is stored at assign time (NULL = indefinite). At most one
--      LIVE (assigned/started) assignment per (programme, client).
--   4. workout_assignments gains the linkage + dual-visibility columns.
--      Programme assignment MATERIALISES occurrence rows here, which is what
--      lights up the existing adherence/missed/dashboard/type=assigned
--      readers with zero query changes.
--
-- Safe to reshape in place: all four tables are EMPTY in prod (verified
-- 2026-07-03) and nothing writes them yet. Idempotent: every destructive
-- step is guarded on the OLD shape still being present, so a re-run after
-- new-shape data exists is a no-op, not a wipe.

-- ── 1. workout_programs ──────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workout_programs' AND column_name = 'total_weeks'
  ) THEN
    ALTER TABLE workout_programs RENAME COLUMN total_weeks TO duration_weeks;
  END IF;
END $$;

ALTER TABLE workout_programs ALTER COLUMN duration_weeks DROP NOT NULL;

ALTER TABLE workout_programs
  ADD COLUMN IF NOT EXISTS days_per_week integer NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workout_programs_days_per_week_check'
  ) THEN
    ALTER TABLE workout_programs
      ADD CONSTRAINT workout_programs_days_per_week_check
      CHECK (days_per_week BETWEEN 1 AND 7);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workout_programs_duration_weeks_check'
  ) THEN
    ALTER TABLE workout_programs
      ADD CONSTRAINT workout_programs_duration_weeks_check
      CHECK (duration_weeks IS NULL OR duration_weeks >= 1);
  END IF;
END $$;

-- ── 2. Flatten program_workouts, drop program_weeks ─────────────────────────

-- Drop the OLD-shape table only (guard on program_week_id so a re-run never
-- wipes the new flat table).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'program_workouts' AND column_name = 'program_week_id'
  ) THEN
    DROP TABLE program_workouts;
  END IF;
END $$;

DROP TABLE IF EXISTS program_weeks;

CREATE TABLE IF NOT EXISTS program_workouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
  workout_id  uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS program_workouts_program_position_uq
  ON program_workouts (program_id, position);

-- ── 3. program_assignments ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS program_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       uuid NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by      uuid NOT NULL REFERENCES profiles(id),
  start_date       date NOT NULL,
  end_date         date,
  status           assignment_status NOT NULL DEFAULT 'assigned',
  show_in_plan     boolean NOT NULL DEFAULT true,
  show_in_library  boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One LIVE assignment per (programme, client); terminal history may accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS program_assignments_live_uq
  ON program_assignments (program_id, client_id)
  WHERE status IN ('assigned', 'started');

CREATE INDEX IF NOT EXISTS program_assignments_client_status_idx
  ON program_assignments (client_id, status);

CREATE INDEX IF NOT EXISTS program_assignments_assigned_by_idx
  ON program_assignments (assigned_by);

-- ── 4. workout_assignments linkage + visibility ─────────────────────────────

ALTER TABLE workout_assignments
  ADD COLUMN IF NOT EXISTS program_assignment_id uuid
    REFERENCES program_assignments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS occurrence_index integer,
  ADD COLUMN IF NOT EXISTS show_in_plan boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_in_library boolean NOT NULL DEFAULT true;

-- Materialisation idempotency: an occurrence exists at most once, so
-- concurrent horizon top-ups (ON CONFLICT DO NOTHING) can race safely.
CREATE UNIQUE INDEX IF NOT EXISTS workout_assignments_pa_occurrence_uq
  ON workout_assignments (program_assignment_id, occurrence_index)
  WHERE program_assignment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS workout_assignments_client_due_idx
  ON workout_assignments (client_id, due_date);

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
-- The SST backend uses the service role (bypasses RLS); these policies guard
-- legacy/direct PostgREST access. Dropping the old tables removed their
-- policies — recreate for the new shapes. workout_programs and
-- workout_assignments policies are untouched by this migration.

ALTER TABLE program_workouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage workouts in own programs" ON program_workouts;
CREATE POLICY "Users can manage workouts in own programs" ON program_workouts
  FOR ALL USING (
    program_id IN (
      SELECT id FROM workout_programs WHERE created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view program workouts they have access to" ON program_workouts;
CREATE POLICY "Users can view program workouts they have access to" ON program_workouts
  FOR SELECT USING (
    program_id IN (
      SELECT id FROM workout_programs
      WHERE created_by = auth.uid() OR is_public = true
    )
  );

ALTER TABLE program_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Assigner can manage program assignments" ON program_assignments;
CREATE POLICY "Assigner can manage program assignments" ON program_assignments
  FOR ALL USING (assigned_by = auth.uid());

DROP POLICY IF EXISTS "Clients can view own program assignments" ON program_assignments;
CREATE POLICY "Clients can view own program assignments" ON program_assignments
  FOR SELECT USING (client_id = auth.uid() OR assigned_by = auth.uid());
