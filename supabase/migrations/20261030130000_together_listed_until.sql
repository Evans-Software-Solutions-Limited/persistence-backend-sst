-- PER-60: how long a session stays listed in discovery, kept apart from
-- expires_at (the session's own lifetime). Apps before PER-60 offered "for 15
-- minutes"; null means listed until the session ends.
alter table together_sessions add column if not exists listed_until timestamptz;
