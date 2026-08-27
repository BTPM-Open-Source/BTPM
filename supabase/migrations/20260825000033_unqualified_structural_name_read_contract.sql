-- BTPM OSS fresh-install correction, second approved runtime-E2E repair.
-- Migration 00032 corrected alias-bound and explicit record-variable decrypts of
-- plaintext structural names. Independent post-migration review found a small
-- residual class where the source column is intentionally unqualified inside a
-- SELECT/CTE. Repair only the confirmed plaintext structural reads below.
-- Legitimately encrypted names (notably adoption_templates and
-- board_workflow_states) must remain decrypted on read.

DO $repair$
DECLARE
  target record;
  original_def text;
  revised_def text;
  hit_count integer;
  total_replacements integer := 0;
  remaining_total integer;
  allowed_adoption integer;
  allowed_workflow_state integer;
BEGIN
  -- Each row is deliberately function-specific and cardinality-checked. This
  -- avoids any global replacement of btpm_decrypt(name, ...) because some name
  -- columns are intentionally encrypted.
  FOR target IN
    SELECT *
    FROM (VALUES
      (
        'admin_preview_project_workspace_move',
        E'(?i)(?:public\\.)?btpm_decrypt\\s*\\(\\s*name\\s*,\\s*organization_id\\s*\\)(\\s+INTO\\s+v_src_program_name\\s+FROM\\s+public\\.programs)',
        E'name\\1',
        1
      ),
      (
        'add_adoption_template_tasks_to_existing_plan',
        E'(?i)(?:public\\.)?btpm_decrypt\\s*\\(\\s*name\\s*,\\s*organization_id\\s*\\)',
        'name',
        1
      ),
      (
        'preview_phase_clone_blueprint',
        E'(?i)(?:public\\.)?btpm_decrypt\\s*\\(\\s*name\\s*,\\s*_org\\s*\\)',
        'name',
        1
      ),
      (
        'preview_project_clone_blueprint',
        E'(?i)(''name''\\s*,\\s*)(?:public\\.)?btpm_decrypt\\s*\\(\\s*name\\s*,\\s*_org\\s*\\)(\\s*,\\s*''description''\\s*,\\s*(?:public\\.)?btpm_decrypt\\s*\\(\\s*description\\s*,\\s*_org\\s*\\)\\s*,\\s*''phase_type'')',
        E'\\1name\\2',
        1
      ),
      (
        'preview_project_clone_blueprint',
        E'(?i)(''name''\\s*,\\s*)(?:public\\.)?btpm_decrypt\\s*\\(\\s*name\\s*,\\s*_org\\s*\\)(\\s*,\\s*''description''\\s*,\\s*(?:public\\.)?btpm_decrypt\\s*\\(\\s*description\\s*,\\s*_org\\s*\\)\\s*,\\s*''task_type'')',
        E'\\1name\\2',
        1
      ),
      (
        'preview_project_clone_blueprint',
        E'(?i)(''name''\\s*,\\s*)(?:public\\.)?btpm_decrypt\\s*\\(\\s*name\\s*,\\s*_org\\s*\\)(\\s*,\\s*''description''\\s*,\\s*(?:public\\.)?btpm_decrypt\\s*\\(\\s*description\\s*,\\s*_org\\s*\\)\\s*,\\s*''unit'')',
        E'\\1name\\2',
        1
      )
    ) AS x(proname, pattern, replacement, expected_count)
  LOOP
    SELECT pg_get_functiondef(p.oid)
    INTO STRICT original_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = target.proname;

    SELECT count(*)
    INTO hit_count
    FROM regexp_matches(original_def, target.pattern, 'g');

    IF hit_count <> target.expected_count THEN
      RAISE EXCEPTION
        'Unqualified structural-name contract expected % match(es) in %, found %',
        target.expected_count,
        target.proname,
        hit_count;
    END IF;

    revised_def := regexp_replace(
      original_def,
      target.pattern,
      target.replacement,
      'g'
    );

    IF revised_def IS NOT DISTINCT FROM original_def THEN
      RAISE EXCEPTION
        'Unqualified structural-name contract produced no change in %',
        target.proname;
    END IF;

    -- pg_get_functiondef emits the complete CREATE OR REPLACE statement, so
    -- signature, return type, language, volatility, SECURITY posture and SET
    -- options are preserved. CREATE OR REPLACE preserves the existing ACL.
    EXECUTE revised_def;
    total_replacements := total_replacements + hit_count;
  END LOOP;

  IF total_replacements <> 6 THEN
    RAISE EXCEPTION
      'Unqualified structural-name correction expected 6 replacements, applied %',
      total_replacements;
  END IF;

  -- Fail closed on the residual unqualified-name class. After this migration
  -- exactly two unqualified btpm_decrypt(name, ...) calls are legitimate:
  --   1) adoption_templates.name (encrypted)
  --   2) board_workflow_states.name (encrypted)
  WITH defs AS (
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ), residuals AS (
    SELECT d.proname, (m)[1] AS second_arg
    FROM defs d
    CROSS JOIN LATERAL regexp_matches(
      d.def,
      E'(?i)(?:public\\.)?btpm_decrypt\\s*\\(\\s*name\\s*,\\s*([^)]*)\\)',
      'g'
    ) AS m
  )
  SELECT
    count(*),
    count(*) FILTER (
      WHERE proname = 'generate_project_adoption_plan_from_saved_template'
        AND btrim(second_arg) = 'organization_id'
    ),
    count(*) FILTER (
      WHERE proname = 'preview_project_clone_blueprint'
        AND btrim(second_arg) = '_org'
    )
  INTO remaining_total, allowed_adoption, allowed_workflow_state
  FROM residuals;

  IF remaining_total <> 2
     OR allowed_adoption <> 1
     OR allowed_workflow_state <> 1 THEN
    RAISE EXCEPTION
      'Unexpected residual unqualified name decrypts: total %, adoption %, workflow_state %',
      remaining_total,
      allowed_adoption,
      allowed_workflow_state;
  END IF;

  -- Prove the two residuals are still attached to their intended encrypted
  -- surfaces rather than merely occurring in the expected function names.
  SELECT count(*)
  INTO hit_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL regexp_matches(
    pg_get_functiondef(p.oid),
    E'(?i)(?:public\\.)?btpm_decrypt\\s*\\(\\s*name\\s*,\\s*organization_id\\s*\\)(\\s+INTO\\s+_template_name\\s+FROM\\s+public\\.adoption_templates)',
    'g'
  ) AS m
  WHERE n.nspname = 'public'
    AND p.proname = 'generate_project_adoption_plan_from_saved_template';

  IF hit_count <> 1 THEN
    RAISE EXCEPTION
      'Encrypted adoption_templates.name read contract is not preserved';
  END IF;

  SELECT count(*)
  INTO hit_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL regexp_matches(
    pg_get_functiondef(p.oid),
    E'(?i)''name''\\s*,\\s*(?:public\\.)?btpm_decrypt\\s*\\(\\s*name\\s*,\\s*_org\\s*\\)\\s*,\\s*''category''',
    'g'
  ) AS m
  WHERE n.nspname = 'public'
    AND p.proname = 'preview_project_clone_blueprint';

  IF hit_count <> 1 THEN
    RAISE EXCEPTION
      'Encrypted board_workflow_states.name read contract is not preserved';
  END IF;
END
$repair$;
