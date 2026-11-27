-- PER-115 (BE-B2) — Backend design B, migration 3: the AI weekly summary by
-- area (Linear: "Backend design B — Adherence and the AI weekly summary", D1
-- and D4).
--
--   * headline          text   — one line at the top of the summary grid.
--   * areas             jsonb  — [{area, status: 'good'|'check'|'info', text}],
--                                only areas with evidence.
--   * ask               text   — the "Worth a check-in" prompt.
--   * week_of_programme jsonb  — {week, of} at generation time (design G).
--
-- `summary` stays NOT NULL and is still written (the headline and area lines
-- joined), so 1.2.0 coach bundles keep showing a paragraph.
--
-- Additive and idempotent: four nullable columns, no defaults, no backfill.
-- Existing rows keep only `summary` and read back with these as null.
-- Re-running is a no-op.
-- Rollback: supabase/rollbacks/20261126120402_client_ai_summary_areas.sql

ALTER TABLE client_ai_summaries ADD COLUMN IF NOT EXISTS headline text NULL;
ALTER TABLE client_ai_summaries ADD COLUMN IF NOT EXISTS areas jsonb NULL;
ALTER TABLE client_ai_summaries ADD COLUMN IF NOT EXISTS ask text NULL;
ALTER TABLE client_ai_summaries
  ADD COLUMN IF NOT EXISTS week_of_programme jsonb NULL;
