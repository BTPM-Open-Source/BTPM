-- Phase 4D.12G.3 — Post-remediation aggregate verification
--
-- Backend/service SQL context (must be allowed to EXECUTE
-- btpm_decrypt_tenant_versioned). Aggregate-only. No values, IDs,
-- ciphertext, or key material are read or emitted.
--
-- Expected after Phase 4D.12G.3 remediation:
--   activity_events.metadata: unread=0
--   kpi_snapshots.string_value: unread=0
--
-- Emits results via RAISE EXCEPTION so the surrounding SQL runner
-- surfaces them without persisting any workspace tables.

DO $$
DECLARE
  ae_null   bigint;
  ae_unread bigint;
  ae_dec    bigint;
  ae_total  bigint;
  ks_null   bigint;
  ks_unread bigint;
  ks_dec    bigint;
  ks_total  bigint;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE ae.metadata IS NULL),
    COUNT(*) FILTER (WHERE ae.metadata IS NOT NULL
                     AND public.btpm_decrypt_tenant_versioned(
                           ae.metadata, o.tenant_id, ae.organization_id) IS NULL),
    COUNT(*) FILTER (WHERE ae.metadata IS NOT NULL
                     AND public.btpm_decrypt_tenant_versioned(
                           ae.metadata, o.tenant_id, ae.organization_id) IS NOT NULL),
    COUNT(*)
  INTO ae_null, ae_unread, ae_dec, ae_total
  FROM public.activity_events ae
  LEFT JOIN public.organizations o ON o.id = ae.organization_id;

  SELECT
    COUNT(*) FILTER (WHERE ks.string_value IS NULL),
    COUNT(*) FILTER (WHERE ks.string_value IS NOT NULL
                     AND public.btpm_decrypt_tenant_versioned(
                           ks.string_value, o.tenant_id, ks.organization_id) IS NULL),
    COUNT(*) FILTER (WHERE ks.string_value IS NOT NULL
                     AND public.btpm_decrypt_tenant_versioned(
                           ks.string_value, o.tenant_id, ks.organization_id) IS NOT NULL),
    COUNT(*)
  INTO ks_null, ks_unread, ks_dec, ks_total
  FROM public.kpi_snapshots ks
  LEFT JOIN public.organizations o ON o.id = ks.organization_id;

  RAISE EXCEPTION
    '4D12G3_RESULT ae{null=% unread=% dec=% total=%} ks{null=% unread=% dec=% total=%}',
    ae_null, ae_unread, ae_dec, ae_total,
    ks_null, ks_unread, ks_dec, ks_total;
END $$;
