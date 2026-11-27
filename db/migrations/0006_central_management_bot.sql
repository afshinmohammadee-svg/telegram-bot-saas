-- 0006: central management bot identities, one-time account linking, bot deep links, and reminder idempotency.
-- Additive only; does not alter production data unless explicitly migrated there.

CREATE TABLE IF NOT EXISTS customer_telegram_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL UNIQUE,
  telegram_username text,
  phone_number text,
  phone_verified_at timestamptz,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_telegram_accounts_user
  ON customer_telegram_accounts(user_id);

CREATE TABLE IF NOT EXISTS telegram_link_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_telegram_link_challenges_expiry
  ON telegram_link_challenges(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS bot_start_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  source_label text,
  created_by text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_bot_start_links_bot
  ON bot_start_links(bot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS license_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id uuid NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  reminder_days integer NOT NULL CHECK (reminder_days IN (30, 7, 1)),
  scheduled_for date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  telegram_user_id bigint NOT NULL,
  UNIQUE (license_id, reminder_days, scheduled_for)
);
CREATE INDEX IF NOT EXISTS idx_license_reminder_log_license
  ON license_reminder_log(license_id, scheduled_for DESC);
