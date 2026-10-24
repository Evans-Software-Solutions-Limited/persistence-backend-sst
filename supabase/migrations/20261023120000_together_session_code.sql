-- PER-60: six-character join code for Together sessions (shown under the host's QR,
-- typed on Join a session). Unique among active sessions only, so codes recycle.
alter table together_sessions add column if not exists code text;
create unique index if not exists together_sessions_code_idx
  on together_sessions (code) where state = 'active';
