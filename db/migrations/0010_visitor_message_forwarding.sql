-- 0010: forward visitor messages to the linked owner through the central management bot.
ALTER TABLE bot_menu_appearance
  ADD COLUMN IF NOT EXISTS visitor_messages_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS visitor_message_forward_map (
  management_message_id bigint NOT NULL,
  management_chat_id bigint NOT NULL,
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  visitor_chat_id bigint NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  visitor_telegram_user_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (management_chat_id, management_message_id)
);
CREATE INDEX IF NOT EXISTS idx_visitor_message_forward_map_owner
  ON visitor_message_forward_map(owner_user_id, created_at DESC);
