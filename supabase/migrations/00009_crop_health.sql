-- Migration: Crop Health, Scouting Rounds, Observations & Response Tracking
-- Tables: scouting_rounds, crop_observations, crop_observation_attachments, follow_up_tasks
-- Views: v_unresolved_observations, v_overdue_followups

-- ============================================================
-- SCOUTING ROUNDS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scouting_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  house_id uuid NOT NULL REFERENCES public.houses(id),
  zone_id uuid REFERENCES public.zones(id),
  crop_cycle_id uuid REFERENCES public.crop_cycles(id),
  scouting_date date NOT NULL DEFAULT CURRENT_DATE,
  scouting_time time DEFAULT CURRENT_TIME,
  scout_id uuid NOT NULL REFERENCES public.profiles(id),
  growth_stage text,
  sampling_method text DEFAULT 'Zig-zag random sampling across 5 beds',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scouting_rounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scouting_rounds_select" ON public.scouting_rounds;
CREATE POLICY "scouting_rounds_select" ON public.scouting_rounds
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "scouting_rounds_insert" ON public.scouting_rounds;
CREATE POLICY "scouting_rounds_insert" ON public.scouting_rounds
  FOR INSERT WITH CHECK (
    scout_id = auth.uid()
    AND public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

DROP POLICY IF EXISTS "scouting_rounds_update" ON public.scouting_rounds;
CREATE POLICY "scouting_rounds_update" ON public.scouting_rounds
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

DROP TRIGGER IF EXISTS set_scouting_rounds_updated_at ON public.scouting_rounds;
CREATE TRIGGER set_scouting_rounds_updated_at
  BEFORE UPDATE ON public.scouting_rounds
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_scouting_farm ON public.scouting_rounds(farm_id);
CREATE INDEX IF NOT EXISTS idx_scouting_date ON public.scouting_rounds(farm_id, scouting_date);

-- ============================================================
-- CROP OBSERVATIONS (Incidence, Severity & Response Tracking)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crop_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scouting_round_id uuid NOT NULL REFERENCES public.scouting_rounds(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  plants_checked integer NOT NULL CHECK (plants_checked >= 0),
  plants_affected integer NOT NULL DEFAULT 0 CHECK (plants_affected >= 0),
  
  -- Incidence Percentage computed with zero-division protection
  incidence_pct numeric(5,2) GENERATED ALWAYS AS (
    CASE 
      WHEN plants_checked > 0 THEN ROUND(((plants_affected::numeric / plants_checked) * 100), 2)
      ELSE 0.00
    END
  ) STORED,
  
  symptoms text,
  suspected_issue text,
  diagnosis_status text NOT NULL DEFAULT 'suspected' CHECK (
    diagnosis_status IN ('suspected', 'confirmed', 'ruled_out')
  ),
  severity text NOT NULL DEFAULT 'low',
  severity_scale text DEFAULT '0-10',
  leaves_affected text,
  flower_condition text,
  fruit_condition text,
  pest_observations text,
  agronomist_assessment text,
  follow_up_date date,
  
  -- Linking to treatment for Before/After Response Verification
  linked_work_order_id uuid REFERENCES public.work_orders(id),
  response_vs_previous text CHECK (response_vs_previous IN ('improved', 'same', 'worsened')),
  
  is_escalated boolean NOT NULL DEFAULT false,
  is_resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crop_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crop_obs_select" ON public.crop_observations;
CREATE POLICY "crop_obs_select" ON public.crop_observations
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "crop_obs_insert" ON public.crop_observations;
CREATE POLICY "crop_obs_insert" ON public.crop_observations
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

DROP POLICY IF EXISTS "crop_obs_update" ON public.crop_observations;
CREATE POLICY "crop_obs_update" ON public.crop_observations
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

DROP TRIGGER IF EXISTS set_crop_observations_updated_at ON public.crop_observations;
CREATE TRIGGER set_crop_observations_updated_at
  BEFORE UPDATE ON public.crop_observations
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_obs_farm ON public.crop_observations(farm_id);
CREATE INDEX IF NOT EXISTS idx_obs_unresolved ON public.crop_observations(farm_id) WHERE is_resolved = false;
CREATE INDEX IF NOT EXISTS idx_obs_escalated ON public.crop_observations(farm_id) WHERE is_escalated = true;

-- ============================================================
-- CROP OBSERVATION ATTACHMENTS (Photographic Evidence)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crop_observation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid NOT NULL REFERENCES public.crop_observations(id) ON DELETE CASCADE,
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  caption text,
  observation_phase text NOT NULL DEFAULT 'general' CHECK (
    observation_phase IN ('before_treatment', 'after_treatment', 'general')
  ),
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crop_observation_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "obs_attachments_select" ON public.crop_observation_attachments;
CREATE POLICY "obs_attachments_select" ON public.crop_observation_attachments
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "obs_attachments_insert" ON public.crop_observation_attachments;
CREATE POLICY "obs_attachments_insert" ON public.crop_observation_attachments
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

-- ============================================================
-- FOLLOW-UP TASKS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  observation_id uuid REFERENCES public.crop_observations(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (
    task_type IN ('follow_up_assessment', 'agronomist_review', 'escalation', 'general')
  ),
  title text NOT NULL,
  description text,
  assigned_to uuid REFERENCES public.profiles(id),
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'in_progress', 'completed', 'cancelled')
  ),
  completed_at timestamptz,
  completed_by uuid REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.follow_up_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "follow_ups_select" ON public.follow_up_tasks;
CREATE POLICY "follow_ups_select" ON public.follow_up_tasks
  FOR SELECT USING (farm_id IN (SELECT public.fn_user_farm_ids()));

DROP POLICY IF EXISTS "follow_ups_insert" ON public.follow_up_tasks;
CREATE POLICY "follow_ups_insert" ON public.follow_up_tasks
  FOR INSERT WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

DROP POLICY IF EXISTS "follow_ups_update" ON public.follow_up_tasks;
CREATE POLICY "follow_ups_update" ON public.follow_up_tasks
  FOR UPDATE USING (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  )
  WITH CHECK (
    public.fn_user_has_any_farm_role(farm_id, ARRAY['owner', 'agronomist', 'supervisor'])
  );

DROP TRIGGER IF EXISTS set_follow_up_tasks_updated_at ON public.follow_up_tasks;
CREATE TRIGGER set_follow_up_tasks_updated_at
  BEFORE UPDATE ON public.follow_up_tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================
-- VIEWS: UNRESOLVED ANOMALIES & OVERDUE FOLLOW-UPS
-- ============================================================

DROP VIEW IF EXISTS public.v_overdue_followups CASCADE;
DROP VIEW IF EXISTS public.v_unresolved_observations CASCADE;

CREATE OR REPLACE VIEW public.v_unresolved_observations AS
SELECT
  co.id AS observation_id,
  co.farm_id,
  sr.house_id,
  h.name AS house_name,
  sr.crop_cycle_id,
  cc.crop_name,
  co.suspected_issue,
  co.symptoms,
  co.incidence_pct,
  co.severity,
  co.is_escalated,
  co.created_at AS observed_at
FROM public.crop_observations co
JOIN public.scouting_rounds sr ON sr.id = co.scouting_round_id
JOIN public.houses h ON h.id = sr.house_id
LEFT JOIN public.crop_cycles cc ON cc.id = sr.crop_cycle_id
WHERE co.is_resolved = false
ORDER BY co.is_escalated DESC, co.incidence_pct DESC;

CREATE OR REPLACE VIEW public.v_overdue_followups AS
SELECT
  fut.id AS task_id,
  fut.farm_id,
  fut.title,
  fut.due_date,
  fut.task_type,
  (CURRENT_DATE - fut.due_date) AS days_overdue,
  p.full_name AS assigned_to_name
FROM public.follow_up_tasks fut
LEFT JOIN public.profiles p ON p.id = fut.assigned_to
WHERE fut.status IN ('pending', 'in_progress')
  AND fut.due_date < CURRENT_DATE
ORDER BY fut.due_date ASC;
