-- ============================================================
-- Phase 4D.12G.2 — Legacy-Unreadable Residue Triage (READ-ONLY)
-- ============================================================
-- Focus: only the two 4D.12G.1 blocker fields:
--   * public.activity_events.metadata
--   * public.kpi_snapshots.string_value
--
-- Guarantees:
--   * READ-ONLY against product tables. No INSERT/UPDATE/DELETE/
--     MERGE/TRUNCATE against any public table.
--   * Only session-local pg_temp helpers/tables.
--   * Aggregate counts only. Never returns a value, ciphertext,
--     row id, decrypted text, Vault/key/secret detail, or SQLERRM.
--   * Uses public.btpm_decrypt_tenant_versioned as the sole decrypt
--     probe. Never uses legacy public.btpm_decrypt.
--   * Must be executed in a backend/service SQL context that is
--     allowed to EXECUTE public.btpm_decrypt_tenant_versioned
--     (per 4D.12F.2, anon/authenticated/PUBLIC are revoked).
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. Safe JSON-shape classifier. Returns a status string only.
--    Never returns the value, the parsed jsonb, or SQLERRM.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.btpm_4d12g2_json_class(_value text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  _trimmed text;
  _j       jsonb;
BEGIN
  _trimmed := btrim(coalesce(_value, ''));

  IF _trimmed = ''
     OR lower(_trimmed) IN ('null', '"null"')
     OR _trimmed IN ('{}', '[]', '""') THEN
    RETURN 'empty_or_sentinel_residue';
  END IF;

  BEGIN
    _j := _trimmed::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  IF jsonb_typeof(_j) IN ('object', 'array') THEN
    RETURN 'raw_json_object_or_array_residue';
  END IF;

  RETURN 'raw_json_scalar_residue';
END;
$$;

-- ----------------------------------------------------------------
-- 2. Safe base64 classifier. Returns a status string only.
--    Never returns bytes or SQLERRM.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.btpm_4d12g2_base64_class(_value text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  _stripped text;
  _bytes    bytea;
BEGIN
  IF _value IS NULL THEN RETURN 'not_base64_candidate'; END IF;

  -- Strip whitespace/newlines only for the decode probe.
  _stripped := regexp_replace(_value, '\s+', '', 'g');

  IF length(_stripped) < 8 THEN
    RETURN 'not_base64_candidate';
  END IF;

  -- Rough base64 alphabet check. Never emit _stripped itself.
  IF _stripped !~ '^[A-Za-z0-9+/=]+$' THEN
    RETURN 'not_base64_candidate';
  END IF;

  BEGIN
    _bytes := decode(_stripped, 'base64');
  EXCEPTION WHEN OTHERS THEN
    RETURN 'base64_candidate_decode_fail';
  END;

  IF _bytes IS NULL OR octet_length(_bytes) = 0 THEN
    RETURN 'base64_candidate_decode_fail';
  END IF;

  RETURN 'base64_candidate_decode_ok';
END;
$$;

-- ----------------------------------------------------------------
-- 3. Full unreadable-row classifier for a single value in the
--    context of its (tenant_id, organization_id).
--    Returns one status string only. Never returns value, ciphertext,
--    decrypted text, bytes, SQLERRM.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.btpm_4d12g2_classify_unreadable(
  _value           text,
  _tenant_id       uuid,
  _organization_id uuid
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  _plain text;
  _js    text;
  _b64   text;
BEGIN
  -- Context guards (should be zero occurrences per 4D.12G.1).
  IF _value IS NULL OR length(btrim(_value)) = 0 THEN
    RETURN 'null_or_empty';
  END IF;
  IF _tenant_id IS NULL THEN
    RETURN 'missing_tenant_context';
  END IF;
  IF _organization_id IS NULL THEN
    RETURN 'missing_organization_context';
  END IF;

  -- Strict decrypt probe. If it succeeds, the row is not actually
  -- unreadable and does not need classification.
  BEGIN
    _plain := public.btpm_decrypt_tenant_versioned(_value, _tenant_id, _organization_id);
  EXCEPTION WHEN OTHERS THEN
    _plain := NULL;
  END;

  IF _plain IS NOT NULL THEN
    RETURN 'decryptable_not_a_residue';
  END IF;

  -- JSON-shape classification.
  _js := pg_temp.btpm_4d12g2_json_class(_value);
  IF _js IS NOT NULL THEN
    RETURN _js;
  END IF;

  -- Base64 classification for values that don't look like JSON.
  _b64 := pg_temp.btpm_4d12g2_base64_class(_value);
  IF _b64 = 'base64_candidate_decode_ok' THEN
    -- The bytes decode but strict decrypt still failed above.
    RETURN 'base64_candidate_decode_success_but_pgp_fail';
  ELSIF _b64 = 'base64_candidate_decode_fail' THEN
    RETURN 'base64_candidate_decode_fail';
  END IF;

  -- Non-JSON, non-base64: treat as plaintext-like residue if printable.
  IF _value ~ '^[[:print:]\s]+$' THEN
    RETURN 'non_json_plaintext_like_residue';
  END IF;

  RETURN 'other_unknown_residue';
END;
$$;

-- ----------------------------------------------------------------
-- 4. Result accumulator (session-local).
-- ----------------------------------------------------------------
CREATE TEMP TABLE pg_temp._4d12g2_res (
  domain_area                                  text,
  table_name                                   text,
  column_name                                  text,
  total_rows                                   bigint,
  unreadable_rows                              bigint,
  empty_or_sentinel_residue                    bigint,
  raw_json_object_or_array_residue             bigint,
  raw_json_scalar_residue                      bigint,
  non_json_plaintext_like_residue              bigint,
  base64_candidate_decode_fail                 bigint,
  base64_candidate_decode_success_but_pgp_fail bigint,
  other_unknown_residue                        bigint,
  missing_tenant_context                       bigint,
  missing_organization_context                 bigint,
  decryptable_not_a_residue                    bigint,
  migration_blocker_after_triage               boolean
) ON COMMIT DROP;

-- ----------------------------------------------------------------
-- 5. activity_events.metadata.
--    Only rows whose strict decrypt returns NULL are classified.
--    We classify inside the same pass by calling the unreadable
--    classifier over ALL non-null values; total_rows counts all rows.
-- ----------------------------------------------------------------
WITH src AS (
  SELECT t.metadata AS v, o.tenant_id AS tid, t.organization_id AS oid
    FROM public.activity_events t
    LEFT JOIN public.organizations o ON o.id = t.organization_id
),
classified AS (
  SELECT pg_temp.btpm_4d12g2_classify_unreadable(v, tid, oid) AS st
    FROM src
)
INSERT INTO pg_temp._4d12g2_res
SELECT
  'audit',
  'activity_events',
  'metadata',
  COUNT(*),
  COUNT(*) FILTER (WHERE st NOT IN ('null_or_empty','decryptable_not_a_residue')),
  COUNT(*) FILTER (WHERE st = 'empty_or_sentinel_residue'),
  COUNT(*) FILTER (WHERE st = 'raw_json_object_or_array_residue'),
  COUNT(*) FILTER (WHERE st = 'raw_json_scalar_residue'),
  COUNT(*) FILTER (WHERE st = 'non_json_plaintext_like_residue'),
  COUNT(*) FILTER (WHERE st = 'base64_candidate_decode_fail'),
  COUNT(*) FILTER (WHERE st = 'base64_candidate_decode_success_but_pgp_fail'),
  COUNT(*) FILTER (WHERE st = 'other_unknown_residue'),
  COUNT(*) FILTER (WHERE st = 'missing_tenant_context'),
  COUNT(*) FILTER (WHERE st = 'missing_organization_context'),
  COUNT(*) FILTER (WHERE st = 'decryptable_not_a_residue'),
  (COUNT(*) FILTER (WHERE st IN (
     'base64_candidate_decode_success_but_pgp_fail',
     'other_unknown_residue',
     'missing_tenant_context',
     'missing_organization_context'
   )) > 0)
FROM classified;

-- ----------------------------------------------------------------
-- 6. kpi_snapshots.string_value.
-- ----------------------------------------------------------------
WITH src AS (
  SELECT t.string_value AS v, o.tenant_id AS tid, t.organization_id AS oid
    FROM public.kpi_snapshots t
    LEFT JOIN public.organizations o ON o.id = t.organization_id
),
classified AS (
  SELECT pg_temp.btpm_4d12g2_classify_unreadable(v, tid, oid) AS st
    FROM src
)
INSERT INTO pg_temp._4d12g2_res
SELECT
  'kpi',
  'kpi_snapshots',
  'string_value',
  COUNT(*),
  COUNT(*) FILTER (WHERE st NOT IN ('null_or_empty','decryptable_not_a_residue')),
  COUNT(*) FILTER (WHERE st = 'empty_or_sentinel_residue'),
  COUNT(*) FILTER (WHERE st = 'raw_json_object_or_array_residue'),
  COUNT(*) FILTER (WHERE st = 'raw_json_scalar_residue'),
  COUNT(*) FILTER (WHERE st = 'non_json_plaintext_like_residue'),
  COUNT(*) FILTER (WHERE st = 'base64_candidate_decode_fail'),
  COUNT(*) FILTER (WHERE st = 'base64_candidate_decode_success_but_pgp_fail'),
  COUNT(*) FILTER (WHERE st = 'other_unknown_residue'),
  COUNT(*) FILTER (WHERE st = 'missing_tenant_context'),
  COUNT(*) FILTER (WHERE st = 'missing_organization_context'),
  COUNT(*) FILTER (WHERE st = 'decryptable_not_a_residue'),
  (COUNT(*) FILTER (WHERE st IN (
     'base64_candidate_decode_success_but_pgp_fail',
     'other_unknown_residue',
     'missing_tenant_context',
     'missing_organization_context'
   )) > 0)
FROM classified;

-- ----------------------------------------------------------------
-- 7. Final aggregate report — counts only.
-- ----------------------------------------------------------------
SELECT
  domain_area,
  table_name,
  column_name,
  total_rows,
  unreadable_rows,
  empty_or_sentinel_residue,
  raw_json_object_or_array_residue,
  raw_json_scalar_residue,
  non_json_plaintext_like_residue,
  base64_candidate_decode_fail,
  base64_candidate_decode_success_but_pgp_fail,
  other_unknown_residue,
  missing_tenant_context,
  missing_organization_context,
  decryptable_not_a_residue,
  migration_blocker_after_triage
FROM pg_temp._4d12g2_res
ORDER BY domain_area, table_name, column_name;

COMMIT;

-- End of read-only triage.
