-- Better Auth Admin plugin fields. Existing role constraint already allows
-- only 'super_admin' and 'user'; this migration preserves that policy.
ALTER TABLE public."user"
  ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ban_reason text,
  ADD COLUMN IF NOT EXISTS ban_expires timestamptz;

ALTER TABLE public.session
  ADD COLUMN IF NOT EXISTS impersonated_by text;

CREATE INDEX IF NOT EXISTS session_user_id_idx ON public.session(user_id);
CREATE INDEX IF NOT EXISTS session_expires_at_idx ON public.session(expires_at);
