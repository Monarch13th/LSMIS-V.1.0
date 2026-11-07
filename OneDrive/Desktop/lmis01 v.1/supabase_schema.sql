-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.permit_config_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  permit_prefix text,
  origin text,
  destination text,
  address text,
  time_issued text,
  conveyance text,
  plate_no text,
  inspector text,
  city_vet text,
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  changed_by uuid,
  CONSTRAINT permit_config_history_pkey PRIMARY KEY (id)
);
CREATE TABLE public.otp_rate_limits (
  email text NOT NULL,
  request_count integer DEFAULT 1,
  last_request timestamp with time zone DEFAULT now(),
  blocked_until timestamp with time zone,
  CONSTRAINT otp_rate_limits_pkey PRIMARY KEY (email)
);
CREATE TABLE public.permits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  permit_no text NOT NULL UNIQUE,
  livestock_id text,
  tag_number text NOT NULL,
  carcass_id uuid,
  owner_name text NOT NULL,
  species text NOT NULL,
  carcass_weight numeric NOT NULL CHECK (carcass_weight > 0::numeric),
  origin text NOT NULL DEFAULT 'TAPON TINAAN'::text,
  destination text NOT NULL DEFAULT 'NEW PEOPLES MARKET'::text,
  address text DEFAULT 'EAST POBLACION'::text,
  time_issued text DEFAULT '3:30 AM'::text,
  conveyance text NOT NULL DEFAULT 'MEAT VAN'::text,
  plate_no text NOT NULL DEFAULT 'TBA-1234'::text,
  inspector text NOT NULL DEFAULT 'NERISSA U. VELOSO'::text,
  city_vet text NOT NULL DEFAULT 'DR. RAYMUNDO VALENTINE P. PAMIREZ'::text,
  status text NOT NULL DEFAULT 'Active'::text CHECK (status = ANY (ARRAY['Active'::text, 'Revoked'::text, 'Used'::text])),
  issued_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  created_at timestamp with time zone DEFAULT clock_timestamp(),
  issued_by text,
  issued_by_user_id text,
  config_snapshot jsonb,
  CONSTRAINT permits_pkey PRIMARY KEY (id)
);
CREATE TABLE public.organ_inspections (
  id text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  tag_number text NOT NULL,
  organ text NOT NULL,
  finding text NOT NULL,
  decision text NOT NULL,
  CONSTRAINT organ_inspections_pkey PRIMARY KEY (id)
);
CREATE TABLE public.users (
  id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  username text,
  role text DEFAULT 'staff'::text,
  status text DEFAULT 'Active'::text,
  last_login text DEFAULT 'Never'::text,
  owner_id text,
  terminated_at timestamp with time zone,
  terminated_until timestamp with time zone,
  termination_reason text,
  active_session_id text,
  active_session_updated_at timestamp with time zone,
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamp with time zone,
  last_failed_login timestamp with time zone,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT users_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id)
);
CREATE TABLE public.owners (
  id text NOT NULL,
  name text NOT NULL,
  contact text NOT NULL,
  address text,
  registered_date date NOT NULL DEFAULT CURRENT_DATE,
  total_animals integer NOT NULL DEFAULT 0,
  email text,
  username text,
  status text NOT NULL DEFAULT 'Approved'::text,
  email_verified boolean NOT NULL DEFAULT false,
  email_verified_at timestamp with time zone,
  agreement_status boolean NOT NULL DEFAULT false,
  agreement_version text DEFAULT 'v1.0-2026'::text,
  agreement_accepted_at timestamp with time zone,
  approved_by text,
  approved_at timestamp with time zone,
  rejection_reason text,
  suspension_reason text,
  google_id text,
  auth_user_id uuid,
  avatar_url text,
  auth_provider text DEFAULT 'email'::text,
  history jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT owners_pkey PRIMARY KEY (id)
);
CREATE TABLE public.fees (
  id text NOT NULL,
  fee_name text NOT NULL,
  animal_type text NOT NULL,
  method text NOT NULL,
  rate numeric NOT NULL DEFAULT 0.00,
  effective_date date NOT NULL,
  status text NOT NULL DEFAULT 'Active'::text,
  CONSTRAINT fees_pkey PRIMARY KEY (id)
);
CREATE TABLE public.livestock (
  id text NOT NULL,
  tag_number text NOT NULL UNIQUE,
  species text NOT NULL,
  breed text,
  sex text,
  age_months text,
  age_value integer,
  age_unit text,
  weight numeric,
  owner_id text,
  owner_name text,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  status text DEFAULT 'Pending'::text,
  quantity integer DEFAULT 1,
  marked boolean NOT NULL DEFAULT false,
  mark_type text,
  mark_date date,
  permit_issued_at timestamp with time zone,
  registered_at timestamp with time zone DEFAULT now(),
  dispatched_at timestamp with time zone,
  released_at timestamp with time zone,
  marked_at timestamp with time zone,
  fallback_at timestamp with time zone,
  fallback_reason text,
  marking_history jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT livestock_pkey PRIMARY KEY (id),
  CONSTRAINT livestock_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id)
);
CREATE TABLE public.ante_mortem_inspections (
  id text NOT NULL,
  livestock_id text,
  tag_number text NOT NULL,
  species text,
  inspector_name text,
  date date NOT NULL DEFAULT CURRENT_DATE,
  findings text,
  decision text NOT NULL,
  remarks text,
  inspected_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ante_mortem_inspections_pkey PRIMARY KEY (id),
  CONSTRAINT ante_mortem_inspections_livestock_id_fkey FOREIGN KEY (livestock_id) REFERENCES public.livestock(id)
);
CREATE TABLE public.post_mortem_inspections (
  id text NOT NULL,
  livestock_id text,
  tag_number text NOT NULL,
  species text,
  inspector_name text,
  date date NOT NULL DEFAULT CURRENT_DATE,
  findings text,
  decision text NOT NULL,
  remarks text,
  raw_decision text DEFAULT 'Approved'::text,
  condemned_parts jsonb DEFAULT '[]'::jsonb,
  inspected_at timestamp with time zone DEFAULT now(),
  CONSTRAINT post_mortem_inspections_pkey PRIMARY KEY (id),
  CONSTRAINT post_mortem_inspections_livestock_id_fkey FOREIGN KEY (livestock_id) REFERENCES public.livestock(id)
);
CREATE TABLE public.slaughter_records (
  id text NOT NULL,
  tag_number text NOT NULL,
  species text,
  owner_name text,
  scheduled_date date NOT NULL,
  slaughter_date date,
  status text NOT NULL DEFAULT 'Scheduled'::text,
  operator text,
  livestock_id text,
  CONSTRAINT slaughter_records_pkey PRIMARY KEY (id),
  CONSTRAINT slaughter_records_livestock_id_fkey FOREIGN KEY (livestock_id) REFERENCES public.livestock(id)
);
CREATE TABLE public.slaughter_processing (
  id text NOT NULL,
  tag_number text NOT NULL,
  species text,
  owner_name text,
  operator text DEFAULT 'Unassigned'::text,
  date date NOT NULL DEFAULT CURRENT_DATE,
  steps jsonb NOT NULL,
  status text NOT NULL DEFAULT 'In Progress'::text,
  notes text,
  CONSTRAINT slaughter_processing_pkey PRIMARY KEY (id)
);
CREATE TABLE public.carcass_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tag_number text NOT NULL,
  slaughter_id text,
  quantity integer NOT NULL DEFAULT 1,
  total_weight numeric NOT NULL,
  hot_weight numeric,
  cold_weight numeric,
  organ_weight numeric,
  grade text DEFAULT 'A'::text,
  operator text,
  date date NOT NULL DEFAULT CURRENT_DATE,
  status text DEFAULT 'Weighed'::text,
  weighed_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT carcass_records_pkey PRIMARY KEY (id)
);
CREATE TABLE public.payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  receipt_no text NOT NULL,
  owner_name text NOT NULL,
  tag_number text NOT NULL,
  animal_type text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  weight numeric NOT NULL DEFAULT 0.00,
  method text NOT NULL,
  rate numeric NOT NULL DEFAULT 0.00,
  amount numeric NOT NULL DEFAULT 0.00,
  status text NOT NULL DEFAULT 'Paid'::text,
  staff_name text NOT NULL DEFAULT 'Staff'::text,
  livestock_id text,
  fee_id text,
  species text,
  fee_name text,
  paid_at timestamp with time zone DEFAULT clock_timestamp(),
  created_at timestamp with time zone DEFAULT clock_timestamp(),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_livestock_id_fkey FOREIGN KEY (livestock_id) REFERENCES public.livestock(id),
  CONSTRAINT payments_fee_id_fkey FOREIGN KEY (fee_id) REFERENCES public.fees(id)
);
CREATE TABLE public.audit_logs (
  id text NOT NULL,
  user text,
  role text,
  action text,
  module text,
  timestamp text,
  ip text,
  tag_number text,
  old_value text,
  new_value text,
  field_changed text,
  security_event text,
  severity text DEFAULT 'info'::text,
  user_id text,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.notifications (
  id text NOT NULL,
  title text,
  message text,
  date text,
  read boolean DEFAULT false,
  type text DEFAULT 'info'::text,
  owner_id text,
  role text,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id)
);
CREATE TABLE public.permit_config (
  id text NOT NULL DEFAULT 'default'::text,
  permit_prefix text NOT NULL DEFAULT 'permit-'::text,
  origin text NOT NULL DEFAULT 'TAPON TINAAN'::text,
  destination text NOT NULL DEFAULT 'NEW PEOPLES MARKET'::text,
  address text NOT NULL DEFAULT 'EAST POBLACION'::text,
  time_issued text DEFAULT ''::text,
  conveyance text NOT NULL DEFAULT 'MEAT VAN'::text,
  plate_no text DEFAULT ''::text,
  inspector text NOT NULL DEFAULT 'NERISSA U. VELOSO'::text,
  city_vet text NOT NULL DEFAULT 'DR. RAYMUNDO VALENTINE P. PAMIREZ'::text,
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT permit_config_pkey PRIMARY KEY (id)
);
CREATE TABLE public.dispatch (
  id text NOT NULL,
  owner_id text,
  owner_name text,
  carcass_weight numeric,
  organ_weight numeric,
  driver text,
  vehicle text,
  released_date text,
  status text DEFAULT 'Released'::text,
  destination text,
  permit_config_id text,
  tags jsonb DEFAULT '[]'::jsonb,
  released_at timestamp with time zone DEFAULT now(),
  dispatched_at timestamp with time zone DEFAULT clock_timestamp(),
  created_at timestamp with time zone DEFAULT clock_timestamp(),
  CONSTRAINT dispatch_pkey PRIMARY KEY (id),
  CONSTRAINT dispatch_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id)
);
CREATE TABLE public.system_settings (
  id text NOT NULL,
  system_name text,
  organization text,
  email text,
  timezone text,
  language text,
  date_format text,
  session_timeout integer,
  enable_notifications boolean DEFAULT true,
  enable_email_alerts boolean DEFAULT true,
  enable_audit_log boolean DEFAULT true,
  CONSTRAINT system_settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.backups_metadata (
  id text NOT NULL,
  name text,
  size text,
  date text,
  status text,
  CONSTRAINT backups_metadata_pkey PRIMARY KEY (id)
);
CREATE TABLE public.diseases (
  id text NOT NULL,
  livestock_id text,
  date date NOT NULL DEFAULT CURRENT_DATE,
  tag_number text NOT NULL,
  disease text NOT NULL,
  severity text NOT NULL DEFAULT 'Medium'::text,
  status text NOT NULL DEFAULT 'Active'::text,
  species text NOT NULL,
  CONSTRAINT diseases_pkey PRIMARY KEY (id),
  CONSTRAINT diseases_livestock_id_fkey FOREIGN KEY (livestock_id) REFERENCES public.livestock(id)
);
CREATE TABLE public.condemnation_records (
  id text NOT NULL,
  livestock_id text,
  date date NOT NULL DEFAULT CURRENT_DATE,
  tag_number text NOT NULL,
  species text NOT NULL,
  reason text NOT NULL,
  part text NOT NULL,
  quantity text NOT NULL,
  inspector text NOT NULL,
  notes text,
  weight_kg numeric DEFAULT 0.00,
  location text,
  disposition text DEFAULT 'Condemned / Rendered'::text,
  findings text,
  photo_url text,
  file_url text,
  CONSTRAINT condemnation_records_pkey PRIMARY KEY (id),
  CONSTRAINT condemnation_records_livestock_id_fkey FOREIGN KEY (livestock_id) REFERENCES public.livestock(id)
);
CREATE TABLE public.disposal_records (
  id text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  tag_number text NOT NULL,
  method text NOT NULL,
  quantity text NOT NULL,
  disposed_by text NOT NULL,
  witness text,
  status text NOT NULL DEFAULT 'Completed'::text,
  notes text,
  CONSTRAINT disposal_records_pkey PRIMARY KEY (id)
);
CREATE TABLE public.evidence_records (
  id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  date date NOT NULL DEFAULT CURRENT_DATE,
  tag_number text NOT NULL,
  type text NOT NULL DEFAULT 'Photo'::text,
  file_name text NOT NULL,
  file_path text,
  file_url text,
  file_size bigint,
  mime_type text,
  uploaded_by uuid,
  inspection_type text,
  status text NOT NULL DEFAULT 'Active'::text,
  notes text,
  file_preview text,
  photos jsonb DEFAULT '[]'::jsonb,
  file_urls jsonb DEFAULT '[]'::jsonb,
  CONSTRAINT evidence_records_pkey PRIMARY KEY (id),
  CONSTRAINT evidence_records_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id)
);
CREATE TABLE public.post_mortem_condemned_cuts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  date date NOT NULL DEFAULT CURRENT_DATE,
  inspection_id text,
  livestock_id text,
  tag_number text NOT NULL,
  species text NOT NULL DEFAULT 'Hog'::text,
  part text NOT NULL,
  custom_part text,
  location text,
  weight_kg numeric NOT NULL CHECK (weight_kg > 0::numeric),
  reason text NOT NULL,
  custom_reason text,
  findings text,
  disposition text NOT NULL DEFAULT 'Condemned / Rendered'::text,
  photo_url text,
  photo_name text,
  inspector text NOT NULL DEFAULT 'Dr. Dave'::text,
  notes text,
  CONSTRAINT post_mortem_condemned_cuts_pkey PRIMARY KEY (id),
  CONSTRAINT post_mortem_condemned_cuts_inspection_fk FOREIGN KEY (inspection_id) REFERENCES public.post_mortem_inspections(id),
  CONSTRAINT post_mortem_condemned_cuts_livestock_fk FOREIGN KEY (livestock_id) REFERENCES public.livestock(id)
);
CREATE TABLE public.owner_otps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  otp_code text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamp with time zone NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  verified boolean NOT NULL DEFAULT false,
  last_sent_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT owner_otps_pkey PRIMARY KEY (id)
);

-- ==============================================================================
-- SUPABASE OCTOBER 30, 2026 DATA API EXPLICIT GRANTS & ROW LEVEL SECURITY
-- ==============================================================================

-- 1. Ensure Row Level Security is active across all public tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.livestock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ante_mortem_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_mortem_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organ_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slaughter_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slaughter_processing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carcass_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_config_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.condemnation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disposal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_mortem_condemned_cuts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backups_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diseases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_otps ENABLE ROW LEVEL SECURITY;

-- 2. Explicit Grants for service_role
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- 3. Explicit Grants for authenticated API users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owners TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.livestock TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ante_mortem_inspections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_mortem_inspections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organ_inspections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slaughter_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slaughter_processing TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carcass_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_config_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.condemnation_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disposal_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_mortem_condemned_cuts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backups_metadata TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.diseases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.otp_rate_limits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_otps TO authenticated;

-- Audit Logs (Append-Only)
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated;

-- 4. Explicit Grants for anon (Public API users)
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.users TO anon;
GRANT SELECT, INSERT ON public.owners TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_otps TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.otp_rate_limits TO anon;

REVOKE ALL ON public.livestock FROM anon;
REVOKE ALL ON public.ante_mortem_inspections FROM anon;
REVOKE ALL ON public.post_mortem_inspections FROM anon;
REVOKE ALL ON public.organ_inspections FROM anon;
REVOKE ALL ON public.slaughter_records FROM anon;
REVOKE ALL ON public.slaughter_processing FROM anon;
REVOKE ALL ON public.carcass_records FROM anon;
REVOKE ALL ON public.payments FROM anon;
REVOKE ALL ON public.permits FROM anon;
REVOKE ALL ON public.permit_config FROM anon;
REVOKE ALL ON public.permit_config_history FROM anon;
REVOKE ALL ON public.dispatch FROM anon;
REVOKE ALL ON public.notifications FROM anon;
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.condemnation_records FROM anon;
REVOKE ALL ON public.disposal_records FROM anon;
REVOKE ALL ON public.evidence_records FROM anon;
REVOKE ALL ON public.post_mortem_condemned_cuts FROM anon;
REVOKE ALL ON public.fees FROM anon;
REVOKE ALL ON public.system_settings FROM anon;
REVOKE ALL ON public.backups_metadata FROM anon;
REVOKE ALL ON public.diseases FROM anon;

-- =========================================================================
-- 5. Audit Logs Role-Scoped Policies & Functions (PHT / LSMIS Multi-Role)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT LOWER(TRIM(COALESCE(
    (SELECT role FROM public.users WHERE id = auth.uid() LIMIT 1),
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid() LIMIT 1),
    auth.jwt() ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role',
    ''
  )));
$$;

DROP POLICY IF EXISTS audit_logs_admin_select_policy ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_role_scoped_select_policy ON public.audit_logs;

CREATE POLICY audit_logs_role_scoped_select_policy ON public.audit_logs
FOR SELECT TO authenticated USING (
  (public.get_auth_role() IN ('admin', 'administrator') AND LOWER(TRIM(COALESCE(role, ''))) IN ('admin', 'administrator'))
  OR
  (public.get_auth_role() IN ('vet', 'veterinarian') AND LOWER(TRIM(COALESCE(role, ''))) IN ('vet', 'veterinarian'))
  OR
  (public.get_auth_role() IN ('staff', 'operator') AND LOWER(TRIM(COALESCE(role, ''))) IN ('staff', 'operator'))
);

-- =========================================================================
-- 6. Notifications Role-Scoped Policies (PHT / LSMIS Multi-Role)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.get_current_user_owner_id()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT owner_id FROM public.users WHERE id = auth.uid() LIMIT 1),
    (SELECT id FROM public.owners WHERE auth_user_id = auth.uid() LIMIT 1),
    (SELECT id FROM public.owners WHERE lower(email) = lower(auth.jwt()->>'email') LIMIT 1),
    ''
  );
$$;

ALTER POLICY notifications_select_policy ON public.notifications
USING (
  (public.get_auth_role() IN ('admin', 'administrator') AND LOWER(TRIM(COALESCE(role, ''))) IN ('admin', 'administrator'))
  OR
  (public.get_auth_role() IN ('vet', 'veterinarian') AND LOWER(TRIM(COALESCE(role, ''))) IN ('vet', 'veterinarian'))
  OR
  (public.get_auth_role() IN ('staff', 'operator') AND LOWER(TRIM(COALESCE(role, ''))) IN ('staff', 'operator'))
  OR
  (
    (LOWER(TRIM(COALESCE(role, ''))) = 'owner' OR owner_id IS NOT NULL)
    AND owner_id IS NOT NULL 
    AND owner_id = public.get_current_user_owner_id()
  )
);

-- ============================================================================
-- LOGIN SECURITY & CONCURRENT SESSION PROTECTION
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.login_security (
  email text PRIMARY KEY,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamp with time zone DEFAULT NULL,
  last_failed_at timestamp with time zone DEFAULT NULL,
  active_session_id text DEFAULT NULL,
  active_session_updated_at timestamp with time zone DEFAULT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.login_security ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon and authenticated to read login_security" ON public.login_security FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anon and authenticated to insert login_security" ON public.login_security FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow anon and authenticated to update login_security" ON public.login_security FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_security TO anon, authenticated;

-- Centralized Single-Active-Session Validation & Heartbeat Functions
CREATE OR REPLACE FUNCTION public.check_active_session(p_email text, p_client_session_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
  v_session_id text;
  v_updated_at timestamp with time zone;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('is_active_elsewhere', false);
  END IF;

  clean_email := lower(trim(p_email));

  SELECT active_session_id, active_session_updated_at
  INTO v_session_id, v_updated_at
  FROM public.login_security
  WHERE lower(email) = clean_email;

  IF v_session_id IS NULL THEN
    SELECT active_session_id, active_session_updated_at
    INTO v_session_id, v_updated_at
    FROM public.users
    WHERE lower(email) = clean_email;
  END IF;

  IF v_session_id IS NOT NULL AND trim(v_session_id) <> '' THEN
    IF p_client_session_id IS NOT NULL AND trim(p_client_session_id) = trim(v_session_id) THEN
      RETURN jsonb_build_object('is_active_elsewhere', false);
    END IF;

    IF v_updated_at IS NOT NULL AND v_updated_at > (NOW() - INTERVAL '120 seconds') THEN
      RETURN jsonb_build_object(
        'is_active_elsewhere', true,
        'message', 'This account is currently being used on another device. Please try again later.'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('is_active_elsewhere', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_active_session_secure(
  p_email text,
  p_session_id text,
  p_client_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
  v_locked_until timestamp with time zone;
  v_curr_session_id text;
  v_curr_updated_at timestamp with time zone;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Email is required');
  END IF;

  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session ID is required');
  END IF;

  clean_email := lower(trim(p_email));

  INSERT INTO public.login_security (email, failed_attempts, created_at, updated_at)
  VALUES (clean_email, 0, NOW(), NOW())
  ON CONFLICT (email) DO NOTHING;

  SELECT locked_until, active_session_id, active_session_updated_at
  INTO v_locked_until, v_curr_session_id, v_curr_updated_at
  FROM public.login_security
  WHERE lower(email) = clean_email
  FOR UPDATE;

  IF (v_curr_session_id IS NULL OR trim(v_curr_session_id) = '') THEN
    SELECT active_session_id, active_session_updated_at
    INTO v_curr_session_id, v_curr_updated_at
    FROM public.users
    WHERE lower(email) = clean_email;
  END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until > NOW() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Account is locked',
      'is_locked', true,
      'remaining_seconds', ceil(EXTRACT(EPOCH FROM (v_locked_until - NOW())))::integer
    );
  END IF;

  IF v_curr_session_id IS NOT NULL AND trim(v_curr_session_id) <> '' AND trim(v_curr_session_id) <> trim(p_session_id) THEN
    IF v_curr_updated_at IS NOT NULL AND v_curr_updated_at > (NOW() - INTERVAL '120 seconds') THEN
      RETURN jsonb_build_object(
        'success', false,
        'is_active_elsewhere', true,
        'message', 'This account is currently being used on another device. Please try again later.'
      );
    END IF;
  END IF;

  UPDATE public.login_security
  SET failed_attempts = 0,
      locked_until = NULL,
      last_failed_at = NULL,
      active_session_id = p_session_id,
      active_session_updated_at = NOW(),
      updated_at = NOW()
  WHERE lower(email) = clean_email;

  UPDATE public.users
  SET failed_login_attempts = 0,
      locked_until = NULL,
      active_session_id = p_session_id,
      active_session_updated_at = NOW(),
      last_login = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
  WHERE lower(email) = clean_email;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'updated_at', NOW()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_active_session(p_email text, p_session_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.register_active_session_secure(p_email, p_session_id, NULL);
  RETURN (v_res->>'success')::boolean;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_session(p_email text, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
  v_db_session_id text;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' OR p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN jsonb_build_object('is_valid', true);
  END IF;

  clean_email := lower(trim(p_email));

  SELECT active_session_id INTO v_db_session_id
  FROM public.login_security
  WHERE lower(email) = clean_email;

  IF v_db_session_id IS NULL THEN
    SELECT active_session_id INTO v_db_session_id
    FROM public.users
    WHERE lower(email) = clean_email;
  END IF;

  IF v_db_session_id IS NOT NULL AND trim(v_db_session_id) = trim(p_session_id) THEN
    UPDATE public.login_security
    SET active_session_updated_at = NOW(), updated_at = NOW()
    WHERE lower(email) = clean_email;

    UPDATE public.users
    SET active_session_updated_at = NOW()
    WHERE lower(email) = clean_email;

    RETURN jsonb_build_object('is_valid', true, 'updated_at', NOW());
  END IF;

  IF v_db_session_id IS NULL OR trim(v_db_session_id) = '' THEN
    RETURN jsonb_build_object('is_valid', true);
  END IF;

  RETURN jsonb_build_object('is_valid', false, 'reason', 'concurrent_login');
END;
$$;

CREATE OR REPLACE FUNCTION public.release_active_session(p_email text, p_session_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  clean_email := lower(trim(p_email));

  IF p_session_id IS NOT NULL AND trim(p_session_id) <> '' THEN
    UPDATE public.login_security
    SET active_session_id = NULL, active_session_updated_at = NULL, updated_at = NOW()
    WHERE lower(email) = clean_email AND (active_session_id = p_session_id OR active_session_id IS NULL);

    UPDATE public.users
    SET active_session_id = NULL, active_session_updated_at = NULL
    WHERE lower(email) = clean_email AND (active_session_id = p_session_id OR active_session_id IS NULL);
  ELSE
    UPDATE public.login_security
    SET active_session_id = NULL, active_session_updated_at = NULL
    WHERE lower(email) = clean_email;

    UPDATE public.users
    SET active_session_id = NULL, active_session_updated_at = NULL
    WHERE lower(email) = clean_email;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_active_session(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_active_session_secure(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_active_session(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_session(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_active_session(text, text) TO anon, authenticated;


ALTER POLICY notifications_update_policy ON public.notifications
USING (
  (public.get_auth_role() IN ('admin', 'administrator') AND LOWER(TRIM(COALESCE(role, ''))) IN ('admin', 'administrator'))
  OR
  (public.get_auth_role() IN ('vet', 'veterinarian') AND LOWER(TRIM(COALESCE(role, ''))) IN ('vet', 'veterinarian'))
  OR
  (public.get_auth_role() IN ('staff', 'operator') AND LOWER(TRIM(COALESCE(role, ''))) IN ('staff', 'operator'))
  OR
  (
    (LOWER(TRIM(COALESCE(role, ''))) = 'owner' OR owner_id IS NOT NULL)
    AND owner_id IS NOT NULL 
    AND owner_id = public.get_current_user_owner_id()
  )
)
WITH CHECK (
  (public.get_auth_role() IN ('admin', 'administrator') AND LOWER(TRIM(COALESCE(role, ''))) IN ('admin', 'administrator'))
  OR
  (public.get_auth_role() IN ('vet', 'veterinarian') AND LOWER(TRIM(COALESCE(role, ''))) IN ('vet', 'veterinarian'))
  OR
  (public.get_auth_role() IN ('staff', 'operator') AND LOWER(TRIM(COALESCE(role, ''))) IN ('staff', 'operator'))
  OR
  (
    (LOWER(TRIM(COALESCE(role, ''))) = 'owner' OR owner_id IS NOT NULL)
    AND owner_id IS NOT NULL 
    AND owner_id = public.get_current_user_owner_id()
  )
);

-- ============================================================================
-- LOGIN SECURITY & CONCURRENT SESSION PROTECTION
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.login_security (
  email text PRIMARY KEY,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamp with time zone DEFAULT NULL,
  last_failed_at timestamp with time zone DEFAULT NULL,
  active_session_id text DEFAULT NULL,
  active_session_updated_at timestamp with time zone DEFAULT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.login_security ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon and authenticated to read login_security" ON public.login_security FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anon and authenticated to insert login_security" ON public.login_security FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow anon and authenticated to update login_security" ON public.login_security FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_security TO anon, authenticated;

-- Centralized Single-Active-Session Validation & Heartbeat Functions
CREATE OR REPLACE FUNCTION public.check_active_session(p_email text, p_client_session_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
  v_session_id text;
  v_updated_at timestamp with time zone;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('is_active_elsewhere', false);
  END IF;

  clean_email := lower(trim(p_email));

  SELECT active_session_id, active_session_updated_at
  INTO v_session_id, v_updated_at
  FROM public.login_security
  WHERE lower(email) = clean_email;

  IF v_session_id IS NULL THEN
    SELECT active_session_id, active_session_updated_at
    INTO v_session_id, v_updated_at
    FROM public.users
    WHERE lower(email) = clean_email;
  END IF;

  IF v_session_id IS NOT NULL AND trim(v_session_id) <> '' THEN
    IF p_client_session_id IS NOT NULL AND trim(p_client_session_id) = trim(v_session_id) THEN
      RETURN jsonb_build_object('is_active_elsewhere', false);
    END IF;

    IF v_updated_at IS NOT NULL AND v_updated_at > (NOW() - INTERVAL '120 seconds') THEN
      RETURN jsonb_build_object(
        'is_active_elsewhere', true,
        'message', 'This account is currently being used on another device. Please try again later.'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('is_active_elsewhere', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_active_session_secure(
  p_email text,
  p_session_id text,
  p_client_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
  v_locked_until timestamp with time zone;
  v_curr_session_id text;
  v_curr_updated_at timestamp with time zone;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Email is required');
  END IF;

  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session ID is required');
  END IF;

  clean_email := lower(trim(p_email));

  INSERT INTO public.login_security (email, failed_attempts, created_at, updated_at)
  VALUES (clean_email, 0, NOW(), NOW())
  ON CONFLICT (email) DO NOTHING;

  SELECT locked_until, active_session_id, active_session_updated_at
  INTO v_locked_until, v_curr_session_id, v_curr_updated_at
  FROM public.login_security
  WHERE lower(email) = clean_email
  FOR UPDATE;

  IF (v_curr_session_id IS NULL OR trim(v_curr_session_id) = '') THEN
    SELECT active_session_id, active_session_updated_at
    INTO v_curr_session_id, v_curr_updated_at
    FROM public.users
    WHERE lower(email) = clean_email;
  END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until > NOW() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Account is locked',
      'is_locked', true,
      'remaining_seconds', ceil(EXTRACT(EPOCH FROM (v_locked_until - NOW())))::integer
    );
  END IF;

  IF v_curr_session_id IS NOT NULL AND trim(v_curr_session_id) <> '' AND trim(v_curr_session_id) <> trim(p_session_id) THEN
    IF v_curr_updated_at IS NOT NULL AND v_curr_updated_at > (NOW() - INTERVAL '120 seconds') THEN
      RETURN jsonb_build_object(
        'success', false,
        'is_active_elsewhere', true,
        'message', 'This account is currently being used on another device. Please try again later.'
      );
    END IF;
  END IF;

  UPDATE public.login_security
  SET failed_attempts = 0,
      locked_until = NULL,
      last_failed_at = NULL,
      active_session_id = p_session_id,
      active_session_updated_at = NOW(),
      updated_at = NOW()
  WHERE lower(email) = clean_email;

  UPDATE public.users
  SET failed_login_attempts = 0,
      locked_until = NULL,
      active_session_id = p_session_id,
      active_session_updated_at = NOW(),
      last_login = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
  WHERE lower(email) = clean_email;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'updated_at', NOW()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_active_session(p_email text, p_session_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.register_active_session_secure(p_email, p_session_id, NULL);
  RETURN (v_res->>'success')::boolean;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_session(p_email text, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
  v_db_session_id text;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' OR p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN jsonb_build_object('is_valid', true);
  END IF;

  clean_email := lower(trim(p_email));

  SELECT active_session_id INTO v_db_session_id
  FROM public.login_security
  WHERE lower(email) = clean_email;

  IF v_db_session_id IS NULL THEN
    SELECT active_session_id INTO v_db_session_id
    FROM public.users
    WHERE lower(email) = clean_email;
  END IF;

  IF v_db_session_id IS NOT NULL AND trim(v_db_session_id) = trim(p_session_id) THEN
    UPDATE public.login_security
    SET active_session_updated_at = NOW(), updated_at = NOW()
    WHERE lower(email) = clean_email;

    UPDATE public.users
    SET active_session_updated_at = NOW()
    WHERE lower(email) = clean_email;

    RETURN jsonb_build_object('is_valid', true, 'updated_at', NOW());
  END IF;

  IF v_db_session_id IS NULL OR trim(v_db_session_id) = '' THEN
    RETURN jsonb_build_object('is_valid', true);
  END IF;

  RETURN jsonb_build_object('is_valid', false, 'reason', 'concurrent_login');
END;
$$;

CREATE OR REPLACE FUNCTION public.release_active_session(p_email text, p_session_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  clean_email := lower(trim(p_email));

  IF p_session_id IS NOT NULL AND trim(p_session_id) <> '' THEN
    UPDATE public.login_security
    SET active_session_id = NULL, active_session_updated_at = NULL, updated_at = NOW()
    WHERE lower(email) = clean_email AND (active_session_id = p_session_id OR active_session_id IS NULL);

    UPDATE public.users
    SET active_session_id = NULL, active_session_updated_at = NULL
    WHERE lower(email) = clean_email AND (active_session_id = p_session_id OR active_session_id IS NULL);
  ELSE
    UPDATE public.login_security
    SET active_session_id = NULL, active_session_updated_at = NULL
    WHERE lower(email) = clean_email;

    UPDATE public.users
    SET active_session_id = NULL, active_session_updated_at = NULL
    WHERE lower(email) = clean_email;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_active_session(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_active_session_secure(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_active_session(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_session(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_active_session(text, text) TO anon, authenticated;


ALTER POLICY notifications_delete_policy ON public.notifications
USING (
  (public.get_auth_role() IN ('admin', 'administrator') AND LOWER(TRIM(COALESCE(role, ''))) IN ('admin', 'administrator'))
  OR
  (public.get_auth_role() IN ('vet', 'veterinarian') AND LOWER(TRIM(COALESCE(role, ''))) IN ('vet', 'veterinarian'))
  OR
  (public.get_auth_role() IN ('staff', 'operator') AND LOWER(TRIM(COALESCE(role, ''))) IN ('staff', 'operator'))
  OR
  (
    (LOWER(TRIM(COALESCE(role, ''))) = 'owner' OR owner_id IS NOT NULL)
    AND owner_id IS NOT NULL 
    AND owner_id = public.get_current_user_owner_id()
  )
);

-- ============================================================================
-- LOGIN SECURITY & CONCURRENT SESSION PROTECTION
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.login_security (
  email text PRIMARY KEY,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamp with time zone DEFAULT NULL,
  last_failed_at timestamp with time zone DEFAULT NULL,
  active_session_id text DEFAULT NULL,
  active_session_updated_at timestamp with time zone DEFAULT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.login_security ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon and authenticated to read login_security" ON public.login_security FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow anon and authenticated to insert login_security" ON public.login_security FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow anon and authenticated to update login_security" ON public.login_security FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_security TO anon, authenticated;

-- Centralized Single-Active-Session Validation & Heartbeat Functions
CREATE OR REPLACE FUNCTION public.check_active_session(p_email text, p_client_session_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
  v_session_id text;
  v_updated_at timestamp with time zone;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('is_active_elsewhere', false);
  END IF;

  clean_email := lower(trim(p_email));

  SELECT active_session_id, active_session_updated_at
  INTO v_session_id, v_updated_at
  FROM public.login_security
  WHERE lower(email) = clean_email;

  IF v_session_id IS NULL THEN
    SELECT active_session_id, active_session_updated_at
    INTO v_session_id, v_updated_at
    FROM public.users
    WHERE lower(email) = clean_email;
  END IF;

  IF v_session_id IS NOT NULL AND trim(v_session_id) <> '' THEN
    IF p_client_session_id IS NOT NULL AND trim(p_client_session_id) = trim(v_session_id) THEN
      RETURN jsonb_build_object('is_active_elsewhere', false);
    END IF;

    IF v_updated_at IS NOT NULL AND v_updated_at > (NOW() - INTERVAL '120 seconds') THEN
      RETURN jsonb_build_object(
        'is_active_elsewhere', true,
        'message', 'This account is currently being used on another device. Please try again later.'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('is_active_elsewhere', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_active_session_secure(
  p_email text,
  p_session_id text,
  p_client_session_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
  v_locked_until timestamp with time zone;
  v_curr_session_id text;
  v_curr_updated_at timestamp with time zone;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Email is required');
  END IF;

  IF p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session ID is required');
  END IF;

  clean_email := lower(trim(p_email));

  INSERT INTO public.login_security (email, failed_attempts, created_at, updated_at)
  VALUES (clean_email, 0, NOW(), NOW())
  ON CONFLICT (email) DO NOTHING;

  SELECT locked_until, active_session_id, active_session_updated_at
  INTO v_locked_until, v_curr_session_id, v_curr_updated_at
  FROM public.login_security
  WHERE lower(email) = clean_email
  FOR UPDATE;

  IF (v_curr_session_id IS NULL OR trim(v_curr_session_id) = '') THEN
    SELECT active_session_id, active_session_updated_at
    INTO v_curr_session_id, v_curr_updated_at
    FROM public.users
    WHERE lower(email) = clean_email;
  END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until > NOW() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Account is locked',
      'is_locked', true,
      'remaining_seconds', ceil(EXTRACT(EPOCH FROM (v_locked_until - NOW())))::integer
    );
  END IF;

  IF v_curr_session_id IS NOT NULL AND trim(v_curr_session_id) <> '' AND trim(v_curr_session_id) <> trim(p_session_id) THEN
    IF v_curr_updated_at IS NOT NULL AND v_curr_updated_at > (NOW() - INTERVAL '120 seconds') THEN
      RETURN jsonb_build_object(
        'success', false,
        'is_active_elsewhere', true,
        'message', 'This account is currently being used on another device. Please try again later.'
      );
    END IF;
  END IF;

  UPDATE public.login_security
  SET failed_attempts = 0,
      locked_until = NULL,
      last_failed_at = NULL,
      active_session_id = p_session_id,
      active_session_updated_at = NOW(),
      updated_at = NOW()
  WHERE lower(email) = clean_email;

  UPDATE public.users
  SET failed_login_attempts = 0,
      locked_until = NULL,
      active_session_id = p_session_id,
      active_session_updated_at = NOW(),
      last_login = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
  WHERE lower(email) = clean_email;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', p_session_id,
    'updated_at', NOW()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.register_active_session(p_email text, p_session_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := public.register_active_session_secure(p_email, p_session_id, NULL);
  RETURN (v_res->>'success')::boolean;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_session(p_email text, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
  v_db_session_id text;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' OR p_session_id IS NULL OR trim(p_session_id) = '' THEN
    RETURN jsonb_build_object('is_valid', true);
  END IF;

  clean_email := lower(trim(p_email));

  SELECT active_session_id INTO v_db_session_id
  FROM public.login_security
  WHERE lower(email) = clean_email;

  IF v_db_session_id IS NULL THEN
    SELECT active_session_id INTO v_db_session_id
    FROM public.users
    WHERE lower(email) = clean_email;
  END IF;

  IF v_db_session_id IS NOT NULL AND trim(v_db_session_id) = trim(p_session_id) THEN
    UPDATE public.login_security
    SET active_session_updated_at = NOW(), updated_at = NOW()
    WHERE lower(email) = clean_email;

    UPDATE public.users
    SET active_session_updated_at = NOW()
    WHERE lower(email) = clean_email;

    RETURN jsonb_build_object('is_valid', true, 'updated_at', NOW());
  END IF;

  IF v_db_session_id IS NULL OR trim(v_db_session_id) = '' THEN
    RETURN jsonb_build_object('is_valid', true);
  END IF;

  RETURN jsonb_build_object('is_valid', false, 'reason', 'concurrent_login');
END;
$$;

CREATE OR REPLACE FUNCTION public.release_active_session(p_email text, p_session_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  clean_email text;
BEGIN
  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  clean_email := lower(trim(p_email));

  IF p_session_id IS NOT NULL AND trim(p_session_id) <> '' THEN
    UPDATE public.login_security
    SET active_session_id = NULL, active_session_updated_at = NULL, updated_at = NOW()
    WHERE lower(email) = clean_email AND (active_session_id = p_session_id OR active_session_id IS NULL);

    UPDATE public.users
    SET active_session_id = NULL, active_session_updated_at = NULL
    WHERE lower(email) = clean_email AND (active_session_id = p_session_id OR active_session_id IS NULL);
  ELSE
    UPDATE public.login_security
    SET active_session_id = NULL, active_session_updated_at = NULL
    WHERE lower(email) = clean_email;

    UPDATE public.users
    SET active_session_id = NULL, active_session_updated_at = NULL
    WHERE lower(email) = clean_email;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_active_session(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_active_session_secure(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_active_session(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_session(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_active_session(text, text) TO anon, authenticated;


