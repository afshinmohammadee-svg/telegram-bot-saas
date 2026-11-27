-- 0004: explicit license catalog/instances and hierarchical bot menu content.
-- Additive migration: preserves existing users, subscriptions, bots, and menu rows.

CREATE TABLE IF NOT EXISTS license_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  max_bots integer NOT NULL DEFAULT 1 CHECK (max_bots > 0),
  max_menus integer NOT NULL DEFAULT 20 CHECK (max_menus >= 0),
  max_visitors bigint CHECK (max_visitors IS NULL OR max_visitors >= 0),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES license_plans(id) ON DELETE RESTRICT,
  user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  license_key_hash text UNIQUE,
  license_key_prefix text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'suspended', 'revoked', 'expired')),
  starts_at timestamptz,
  expires_at timestamptz,
  limits_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  features_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_licenses_user_status
  ON licenses(user_id, status);
CREATE INDEX IF NOT EXISTS idx_licenses_expiry
  ON licenses(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_license_plans_active
  ON license_plans(is_active);

-- Preserve compatibility with the existing subscription-based expiry checks.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS license_id uuid REFERENCES licenses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_license_id
  ON subscriptions(license_id);

-- Existing bot_menus rows remain valid; new columns enable nested menus and content.
ALTER TABLE bot_menus
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS response_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS response_content text,
  ADD COLUMN IF NOT EXISTS target_url text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE bot_menus
  ADD CONSTRAINT bot_menus_response_type_check
  CHECK (response_type IN ('text', 'photo', 'document', 'url', 'submenu'))
  NOT VALID;

ALTER TABLE bot_menus
  ADD CONSTRAINT bot_menus_id_bot_id_unique UNIQUE (id, bot_id);

ALTER TABLE bot_menus
  ADD CONSTRAINT bot_menus_parent_same_bot_fk
  FOREIGN KEY (parent_id, bot_id)
  REFERENCES bot_menus(id, bot_id)
  ON DELETE CASCADE
  NOT VALID;

CREATE INDEX IF NOT EXISTS idx_bot_menus_bot_parent_order
  ON bot_menus(bot_id, parent_id, sort_order);
