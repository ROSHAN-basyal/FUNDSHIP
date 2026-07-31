-- Device-scoped Android push registrations. Each token is tied to the exact
-- remembered session that registered it, so logout and session expiry revoke
-- notification delivery automatically through the foreign-key cascade.

CREATE TABLE IF NOT EXISTS android_push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS android_push_tokens_user_idx
  ON android_push_tokens(user_id);

CREATE INDEX IF NOT EXISTS android_push_tokens_session_idx
  ON android_push_tokens(session_token);

-- The mobile app registers through the authenticated Vercel API. No public
-- Supabase Data API policy is intentionally provided for this private table.
ALTER TABLE android_push_tokens ENABLE ROW LEVEL SECURITY;
