-- Unify application identities with Better Auth's public."user" table.
-- Safe guard: do not drop the legacy table if it contains accounts that need an explicit mapping.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_users LIMIT 1) THEN
    RAISE EXCEPTION 'app_users is not empty; map legacy accounts to public."user" before applying this migration';
  END IF;
END
$$;

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey;
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_target_user_id_fkey;
ALTER TABLE public.bots DROP CONSTRAINT IF EXISTS bots_owner_id_fkey;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_created_by_fkey;
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;

ALTER TABLE public.audit_logs
  ALTER COLUMN actor_user_id TYPE text USING actor_user_id::text,
  ALTER COLUMN target_user_id TYPE text USING target_user_id::text;
ALTER TABLE public.bots ALTER COLUMN owner_id TYPE text USING owner_id::text;
ALTER TABLE public.notifications ALTER COLUMN user_id TYPE text USING user_id::text;
ALTER TABLE public.subscriptions
  ALTER COLUMN created_by TYPE text USING created_by::text,
  ALTER COLUMN user_id TYPE text USING user_id::text;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public."user"(id) ON DELETE SET NULL,
  ADD CONSTRAINT audit_logs_target_user_id_fkey
    FOREIGN KEY (target_user_id) REFERENCES public."user"(id) ON DELETE SET NULL;
ALTER TABLE public.bots
  ADD CONSTRAINT bots_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public."user"(id) ON DELETE SET NULL,
  ADD CONSTRAINT subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public."user"(id) ON DELETE CASCADE;

DROP TABLE public.app_users;
DROP TYPE IF EXISTS public.app_role;
