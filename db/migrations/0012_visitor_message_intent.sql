-- 0012: track the visitor's explicit intent to message the bot manager.
ALTER TABLE bot_visitor_menu_state
  ADD COLUMN IF NOT EXISTS awaiting_manager_message boolean NOT NULL DEFAULT false;
