-- Add optional target menu to QR/deep links. A null target opens the root menu.
ALTER TABLE bot_start_links
  ADD COLUMN IF NOT EXISTS menu_id uuid REFERENCES bot_menus(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bot_start_links_menu ON bot_start_links(menu_id) WHERE menu_id IS NOT NULL;
