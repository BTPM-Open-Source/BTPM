-- Phase 4D.12J — Format-aware trigger hardening verification (read-only).
--
-- Backend/service SQL context. Aggregate/function-level output only.
-- No row values, no ciphertext, no key material, no Vault identifiers.

SELECT
  c.relname                                                             AS table_name,
  t.tgname                                                              AS trigger_name,
  p.proname                                                             AS function_name,
  position('btpm_encrypt_if_legacy(' in pg_get_functiondef(p.oid)) > 0  AS has_format_aware_call,
  position('btpmenc:'                in pg_get_functiondef(p.oid)) > 0  AS references_btpmenc_prefix,
  position('btpm_encrypt_tenant_versioned' in pg_get_functiondef(p.oid)) > 0
                                                                        AS uses_tenant_versioned_encrypt,
  (pg_get_functiondef(p.oid) ~ '\mbtpm_encrypt\s*\(')                   AS still_calls_legacy_encrypt_directly
FROM pg_trigger t
JOIN pg_class     c ON c.oid = t.tgrelid
JOIN pg_proc      p ON p.oid = t.tgfoid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
  AND (
       t.tgname LIKE 'trg_encrypt_%'
    OR t.tgname LIKE 'trg_adoption_%_encrypt'
    OR t.tgname LIKE 'trg_adoption_templates_encrypt'
    OR pg_get_functiondef(p.oid) LIKE '%btpm_encrypt(%'
    OR pg_get_functiondef(p.oid) LIKE '%btpm_encrypt_if_legacy(%'
  )
ORDER BY c.relname, t.tgname;
