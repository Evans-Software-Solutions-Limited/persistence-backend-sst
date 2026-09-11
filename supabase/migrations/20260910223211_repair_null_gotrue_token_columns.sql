-- GoTrue scans auth.users token columns into non-nullable Go strings, so a
-- single NULL makes GET /auth/v1/admin/users return 500 for EVERY user:
--   "unable to fetch records: sql: Scan error on column index 3,
--    name \"confirmation_token\": converting NULL to string is unsupported"
-- NULLs get there when a row is inserted directly via SQL rather than through
-- GoTrue. Empty string is the value GoTrue writes and every healthy row holds.
-- Idempotent: only touches rows that actually carry a NULL.
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;
