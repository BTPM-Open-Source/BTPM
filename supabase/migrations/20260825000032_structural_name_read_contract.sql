-- BTPM OSS fresh-install correction: structural entity names are intentionally
-- plaintext/queryable. Narrative fields remain encrypted. Some consolidated
-- read functions still inherited historical btpm_decrypt(name, organization_id)
-- calls; on a fresh tenant with no legacy organization key those calls return
-- NULL. Repair only names belonging to the canonical plaintext structural
-- tables and preserve every other function attribute/body/ACL unchanged.

DO $repair$
DECLARE
  fn record;
  alias_row record;
  explicit_row record;
  expr text;
  original_def text;
  revised_def text;
  pattern text;
  hit_count integer;
  replacement_count integer := 0;
  function_count integer := 0;
  remaining_count integer;
BEGIN
  -- Catalog-bound structural aliases. pg_get_functiondef emits the complete
  -- CREATE OR REPLACE FUNCTION statement, so executing the revised definition
  -- preserves signature, return type, language, volatility, SECURITY posture,
  -- SET options and body. CREATE OR REPLACE also preserves existing ACLs.
  FOR fn IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_functiondef(p.oid) LIKE '%btpm_decrypt%name%'
  LOOP
    original_def := fn.def;
    revised_def := original_def;

    FOR alias_row IN
      SELECT DISTINCT (m)[2] AS alias_name
      FROM regexp_matches(
        original_def,
        E'(?i)(?:from|join)\\s+(?:public\\.)?(workspaces|programs|projects|phases|tasks)\\s+(?:as\\s+)?([a-zA-Z_][a-zA-Z0-9_]*)',
        'g'
      ) AS m
    LOOP
      pattern := E'(?:public\\.)?btpm_decrypt\\s*\\(\\s*'
        || alias_row.alias_name
        || E'\\.name\\s*,\\s*[^)]*\\)';

      SELECT count(*)
      INTO hit_count
      FROM regexp_matches(revised_def, pattern, 'g');

      IF hit_count > 0 THEN
        revised_def := regexp_replace(
          revised_def,
          pattern,
          alias_row.alias_name || '.name',
          'g'
        );
        replacement_count := replacement_count + hit_count;
      END IF;
    END LOOP;

    IF revised_def IS DISTINCT FROM original_def THEN
      EXECUTE revised_def;
      function_count := function_count + 1;
    END IF;
  END LOOP;

  -- A small number of functions first load a structural row into a PL/pgSQL
  -- record and later decrypt record.name. These expressions cannot be inferred
  -- from FROM/JOIN aliases, so keep the list explicit and fail closed if the
  -- expected expression is absent or duplicated.
  FOR explicit_row IN
    SELECT *
    FROM (VALUES
      ('admin_preview_project_workspace_move', ARRAY['v_tgt_pg.name']::text[]),
      ('apply_program_update', ARRAY['v_prog.name']::text[]),
      ('get_decrypted_phase', ARRAY['_phase.name']::text[]),
      ('preview_phase_clone_blueprint', ARRAY['_phase.name']::text[]),
      ('preview_task_clone_blueprint', ARRAY['_phase_row.name', '_task_row.name']::text[])
    ) AS x(proname, expressions)
  LOOP
    SELECT pg_get_functiondef(p.oid)
    INTO STRICT original_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = explicit_row.proname;

    revised_def := original_def;

    FOREACH expr IN ARRAY explicit_row.expressions
    LOOP
      pattern := E'(?:public\\.)?btpm_decrypt\\s*\\(\\s*'
        || replace(expr, '.', E'\\.')
        || E'\\s*,\\s*[^)]*\\)';

      SELECT count(*)
      INTO hit_count
      FROM regexp_matches(revised_def, pattern, 'g');

      IF hit_count <> 1 THEN
        RAISE EXCEPTION
          'Structural-name contract expected exactly one decrypt for %.%, found %',
          explicit_row.proname,
          expr,
          hit_count;
      END IF;

      revised_def := regexp_replace(revised_def, pattern, expr, 'g');
      replacement_count := replacement_count + 1;
    END LOOP;

    EXECUTE revised_def;
    function_count := function_count + 1;
  END LOOP;

  IF replacement_count = 0 OR function_count = 0 THEN
    RAISE EXCEPTION 'Structural-name correction matched no functions';
  END IF;

  -- Fail closed: after the repair, no direct alias bound to a core structural
  -- table may still decrypt its name.
  WITH f AS (
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ), aliases AS (
    SELECT f.oid, f.def, (m)[2] AS alias_name
    FROM f
    CROSS JOIN LATERAL regexp_matches(
      f.def,
      E'(?i)(?:from|join)\\s+(?:public\\.)?(workspaces|programs|projects|phases|tasks)\\s+(?:as\\s+)?([a-zA-Z_][a-zA-Z0-9_]*)',
      'g'
    ) AS m
  )
  SELECT count(*)
  INTO remaining_count
  FROM aliases
  WHERE def ~ (
    E'(?:public\\.)?btpm_decrypt\\s*\\(\\s*'
    || alias_name
    || E'\\.name\\s*,'
  );

  IF remaining_count <> 0 THEN
    RAISE EXCEPTION
      'Structural-name correction left % catalog-bound name decrypts',
      remaining_count;
  END IF;
END
$repair$;
