-- PER-60: a join request made with the session code. The code is a credential
-- like an invite, so approving such a request skips the session's audience
-- (a private or partners-only session is still joinable by its code).
alter table together_join_requests
  add column if not exists via_code boolean not null default false;
