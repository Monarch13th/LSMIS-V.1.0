CREATE OR REPLACE FUNCTION public.enforce_com_email_registration()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF COALESCE(lower(btrim(NEW.auth_provider)), 'email') = 'google' THEN
    RETURN NEW;
  END IF;

  v_email := lower(btrim(COALESCE(NEW.email, '')));
  IF v_email = '' OR v_email !~* '^[^\s@]+@[^\s@]+\.com$' THEN
    RAISE EXCEPTION 'Please enter a valid email address'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.email := v_email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owners_enforce_com_email ON public.owners;
CREATE TRIGGER trg_owners_enforce_com_email
  BEFORE INSERT ON public.owners
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_com_email_registration();

DROP TRIGGER IF EXISTS trg_users_enforce_com_email ON public.users;
CREATE TRIGGER trg_users_enforce_com_email
  BEFORE INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_com_email_registration();
