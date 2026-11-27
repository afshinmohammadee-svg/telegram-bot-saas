-- 0009: persist customer Reply Keyboard navigation and central-bot menu editor sessions.
-- Additive migration; scoped to the Preview database before any production rollout.
CREATE TABLE IF NOT EXISTS bot_visitor_menu_state (
  visitor_id uuid PRIMARY KEY REFERENCES bot_visitors(id) ON DELETE CASCADE,
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  current_parent_id uuid REFERENCES bot_menus(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bot_visitor_menu_state_bot
  ON bot_visitor_menu_state(bot_id);

CREATE TABLE IF NOT EXISTS management_menu_sessions (
  telegram_user_id bigint PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  bot_id uuid REFERENCES bots(id) ON DELETE CASCADE,
  step text NOT NULL,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
