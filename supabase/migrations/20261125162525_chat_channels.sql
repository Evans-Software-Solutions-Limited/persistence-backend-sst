-- PER-120 (BE-E1b) — Backend design E, migration 7: one Stream chat channel
-- per coach–client relationship
-- (Linear: "Backend design E — Coach–client messages (Stream)", C3.6, C6).
--
-- Additive and idempotent. Re-running it is a no-op; no existing table or
-- column changes. Rollback: supabase/rollbacks/20261125162525_chat_channels.sql
--
--   * chat_channels — our record of the relationship's Stream channel
--                     (`coaching:coach-<relationshipId>`) and where it is:
--       pending — not provisioned in Stream yet (or provisioning failed);
--                 the coach scheduler retries it
--       active  — trainer and client are members; both can write
--       frozen  — coaching ended: the client was removed and the channel is
--                 frozen; the coach keeps a read-only thread (C9d)
--
-- `coaching` is our own Stream channel type: members may only read and write;
-- creating channels and changing members is server-only (chat/streamClient.ts).
-- Message content lives in Stream only; nothing here stores it.
-- Service-role only (RLS on, no policies): read and written through the core
-- API, which authorizes explicitly.

CREATE TABLE IF NOT EXISTS chat_channels (
  relationship_id      uuid PRIMARY KEY REFERENCES pt_client_relationships(id) ON DELETE CASCADE,
  stream_channel_type  text NOT NULL DEFAULT 'coaching' CHECK (stream_channel_type = 'coaching'),
  stream_channel_id    text NOT NULL CHECK (char_length(stream_channel_id) BETWEEN 1 AND 64),
  trainer_id           uuid NOT NULL,
  client_id            uuid NOT NULL,
  state                text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active', 'frozen')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  frozen_at            timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_stream_channel_uq
  ON chat_channels (stream_channel_type, stream_channel_id);
CREATE INDEX IF NOT EXISTS chat_channels_trainer_idx
  ON chat_channels (trainer_id);
CREATE INDEX IF NOT EXISTS chat_channels_client_idx
  ON chat_channels (client_id);

ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;
