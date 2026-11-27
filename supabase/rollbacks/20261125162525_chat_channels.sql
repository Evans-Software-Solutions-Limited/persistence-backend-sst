-- Rollback for 20261125162525_chat_channels.sql (PER-120).
--
-- ⚠ Roll back the core deploy FIRST: the chat routes, the Stream webhook,
-- channel provisioning, coaching offboarding and the coach scheduler's chat
-- job read this table. Dropping it forgets which relationships have a Stream
-- channel; the channels and their messages stay in Stream, and a re-applied
-- migration plus the scheduler re-provision them idempotently (the channel id
-- is deterministic).
DROP TABLE IF EXISTS chat_channels;
