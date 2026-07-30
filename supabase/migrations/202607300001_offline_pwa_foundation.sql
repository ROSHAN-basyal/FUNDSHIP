-- Durable sessions, idempotent offline payment mutations, and browser push
-- subscriptions. This migration is safe to run once through Supabase SQL Editor
-- or the repository migration command.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE sessions
SET expires_at = created_at::timestamptz + INTERVAL '30 days'
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS sessions_expiry_idx
  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS payment_mutations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lend', 'split')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS payment_mutations_created_idx
  ON payment_mutations(created_at);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  poll_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_poll_idx
  ON web_push_subscriptions(user_id, poll_enabled);

-- These tables are private backend infrastructure. The Vercel backend connects
-- with the trusted Postgres role; Supabase's public Data API receives no policy.
ALTER TABLE payment_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
