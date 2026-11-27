-- Idempotency for Telegram updates received by the central management bot.
CREATE TABLE IF NOT EXISTS management_telegram_updates (
  update_id bigint PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_management_telegram_updates_received
  ON management_telegram_updates(received_at);
