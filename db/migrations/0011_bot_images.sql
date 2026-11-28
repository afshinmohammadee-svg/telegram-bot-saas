-- 0011: metadata for private Neon Object Storage images. Additive only.
CREATE TABLE IF NOT EXISTS bot_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('banner','menu')),
  menu_id uuid,
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 307200),
  sha256 char(64) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','deleting')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bot_images_menu_same_bot_fk
    FOREIGN KEY (menu_id, bot_id) REFERENCES bot_menus(id, bot_id) ON DELETE CASCADE,
  CONSTRAINT bot_images_kind_menu_check
    CHECK ((kind='banner' AND menu_id IS NULL) OR (kind='menu' AND menu_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_bot_images_bot_status ON bot_images(bot_id,status);
CREATE INDEX IF NOT EXISTS idx_bot_images_menu ON bot_images(bot_id,menu_id) WHERE menu_id IS NOT NULL;
