-- ============================================================
-- Phase 4D.12G — Encrypted Field Inventory & Migration Dry Run
-- READ-ONLY. Aggregate counts only. No decrypted plaintext,
-- no ciphertext samples, no record IDs, no key material,
-- no Vault names, no fingerprints/digests/raw metadata output.
-- ============================================================
--
-- Requirements:
--   * Must be executed in a backend/service SQL context that is
--     allowed to EXECUTE public.btpm_decrypt_tenant_versioned
--     (SECURITY DEFINER path). It will not classify decryptability
--     under the Supabase read-only role (which has EXECUTE revoked).
--   * Does NOT write to any product table.
--   * Uses only session-local pg_temp objects (function + table),
--     which vanish at session end.
--   * Uses public.btpm_decrypt_tenant_versioned as the sole decrypt
--     probe. Never uses legacy public.btpm_decrypt.
--   * Passes _organization_id for every legacy bare-ciphertext probe.
--   * Rows missing tenant/organization context are counted separately;
--     decrypt is not attempted for them.
--   * Any exception from the decrypt helper is caught and classified,
--     never re-raised, and never printed with SQLERRM.
--
-- Output: aggregate counts per (table, column) plus migration flags.
-- ============================================================

BEGIN;

-- ----------------------------------------------------------------
-- 1. Safe session-local classification helper.
--    Returns a status string only. Never returns plaintext, ciphertext,
--    or SQLERRM. Fails closed on any decrypt failure.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.btpm_4d12g_classify(
  _ciphertext      text,
  _tenant_id       uuid,
  _organization_id uuid
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  _is_versioned boolean;
  _plain        text;
BEGIN
  IF _ciphertext IS NULL OR length(btrim(_ciphertext)) = 0 THEN
    RETURN 'null_or_empty';
  END IF;

  _is_versioned := left(_ciphertext, 8) = 'btpmenc:';

  IF _tenant_id IS NULL THEN
    RETURN 'missing_tenant_context';
  END IF;

  IF NOT _is_versioned AND _organization_id IS NULL THEN
    RETURN 'missing_organization_context';
  END IF;

  -- Versioned payload must match the strict btpmenc:v1:t:<n>:<b64> shape.
  -- Any other btpmenc:* payload is unsupported/malformed and must not be
  -- treated as legacy. We still call the helper so its own fail-closed
  -- logic governs the outcome, and we only report the classification we
  -- observe.
  BEGIN
    _plain := public.btpm_decrypt_tenant_versioned(_ciphertext, _tenant_id, _organization_id);
  EXCEPTION WHEN OTHERS THEN
    IF _is_versioned THEN
      RETURN 'unsupported_or_malformed_versioned';
    ELSE
      RETURN 'legacy_unreadable';
    END IF;
  END;

  IF _plain IS NULL THEN
    IF _is_versioned THEN
      RETURN 'tenant_versioned_unreadable';
    ELSE
      RETURN 'legacy_unreadable';
    END IF;
  END IF;

  -- Do NOT return _plain. Only return classification.
  IF _is_versioned THEN
    RETURN 'tenant_versioned_decryptable';
  END IF;

  RETURN 'legacy_decryptable';
END;
$$;

-- ----------------------------------------------------------------
-- 2. Registry of encrypted fields discovered from schema triggers
--    (BEFORE INSERT/UPDATE triggers that call btpm_encrypt).
--    Domain / tenant / organization resolvers are recorded as static
--    strings (never as raw values). No key names, no Vault names.
-- ----------------------------------------------------------------
CREATE TEMP TABLE pg_temp._4d12g_registry (
  domain_area              text NOT NULL,
  table_name               text NOT NULL,
  column_name              text NOT NULL,
  tenant_source            text NOT NULL, -- 'organizations.tenant_id via t.organization_id' | 'outbox.organization_id -> organizations.tenant_id'
  organization_source      text NOT NULL, -- 't.organization_id' | 'outbox.organization_id'
  notes                    text
) ON COMMIT DROP;

INSERT INTO pg_temp._4d12g_registry (domain_area, table_name, column_name, tenant_source, organization_source, notes) VALUES
 -- Core BTPM hierarchy
 ('workspaces',     'workspaces',    'description',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('programs',       'programs',      'description',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'description',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'charter',      'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'goals',        'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'scope_in',     'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'scope_out',    'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'business_case','organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'success_criteria',    'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'completion_criteria', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'budget_narrative',    'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'assumptions',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('projects',       'projects',      'constraints',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('phases',         'phases',        'description',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('tasks',          'tasks',         'description',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),

 -- Agile substrate
 ('agile',          'backlog_items',        'description', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('agile',          'sprints',              'goal',        'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('agile',          'board_workflow_states','name',        'organizations.tenant_id via t.organization_id','t.organization_id',NULL),

 -- Collaboration substrate
 ('collaboration',  'comments',          'body',    'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('collaboration',  'execution_updates', 'summary', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('audit',          'activity_events',   'metadata','organizations.tenant_id via t.organization_id','t.organization_id','stored as text ciphertext (was jsonb)'),

 -- Risk / blocker
 ('risks',          'blockers', 'description',     'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('risks',          'risks',    'description',     'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('risks',          'risks',    'mitigation_plan', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),

 -- Team
 ('team',           'project_team_members', 'role_label', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('team',           'profiles',             'display_name','organizations.tenant_id via t.organization_id','t.organization_id','only rows with organization_id set are encrypted'),
 ('team',           'profiles',             'avatar_url',  'organizations.tenant_id via t.organization_id','t.organization_id','only rows with organization_id set are encrypted'),

 -- KPI
 ('kpi',            'kpi_definitions', 'description',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('kpi',            'kpi_updates',     'note',         'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('kpi',            'kpi_snapshots',   'string_value', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('kpi',            'kpi_snapshots',   'comment',      'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('kpi',            'kpi_snapshots',   'action_plan',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),

 -- KPI app integration
 ('kpi_app',        'kpi_app_submission_outbox', 'source_string_value',        'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('kpi_app',        'kpi_app_submission_outbox', 'source_comment',             'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('kpi_app',        'kpi_app_submission_outbox', 'source_action_plan',         'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('kpi_app',        'kpi_app_submission_outbox', 'last_upstream_body_summary', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('kpi_app',        'kpi_app_submission_outbox', 'last_error_message',         'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('kpi_app',        'kpi_app_submission_attempts', 'upstream_body_summary',    'outbox.organization_id -> organizations.tenant_id','outbox.organization_id',NULL),
 ('kpi_app',        'kpi_app_submission_attempts', 'error_message',            'outbox.organization_id -> organizations.tenant_id','outbox.organization_id',NULL),

 -- Portfolio / benefits
 ('portfolio',      'portfolio_items', 'name',        'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('portfolio',      'portfolio_items', 'code',        'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('portfolio',      'portfolio_items', 'description', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('portfolio',      'project_benefits','metric_name', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('portfolio',      'project_benefits','description', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('portfolio',      'project_benefits','custom_benefit_type_label','organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('portfolio',      'project_benefits','evidence_note','organizations.tenant_id via t.organization_id','t.organization_id',NULL),

 -- Closure / lessons learned
 ('closure',        'project_closure_summaries','outcome_summary_encrypted',     'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('closure',        'project_closure_summaries','benefits_summary_encrypted',    'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('closure',        'project_closure_summaries','achievements_summary_encrypted','organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('closure',        'project_closure_summaries','open_items_summary_encrypted',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('closure',        'project_closure_summaries','transition_notes_encrypted',    'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('closure',        'project_lessons_learned_documents','document_name_encrypted',       'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('closure',        'project_lessons_learned_documents','sharepoint_web_url_encrypted',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('closure',        'project_lessons_learned_documents','sharepoint_drive_id_encrypted', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('closure',        'project_lessons_learned_documents','sharepoint_item_id_encrypted',  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),

 -- Knowledge
 ('knowledge',      'knowledge_articles','title',           'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('knowledge',      'knowledge_articles','summary',         'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('knowledge',      'knowledge_articles','body',            'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('knowledge',      'knowledge_articles','tooltip_excerpt', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('knowledge',      'knowledge_categories','description',   'organizations.tenant_id via t.organization_id','t.organization_id',NULL),

 -- AI help / instructions
 ('ai',             'ai_help_conversations',   'title',         'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('ai',             'ai_help_conversations',   'context_label', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('ai',             'ai_help_messages',        'content',       'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('ai',             'ai_help_messages',        'context_label', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('ai',             'ai_help_message_feedback','comment',       'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('ai',             'ai_instruction_templates','instruction_text','organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('ai',             'ai_instruction_templates','notes',           'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('ai',             'decision_case_ai_runs',   'error_message', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),

 -- Governance records and related tables
 ('governance',     'governance_records',                    'event_name',                    'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_records',                    'summary',                       'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_records',                    'decisions_summary',             'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_records',                    'external_reference_url',        'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_records',                    'sharepoint_evidence_reference', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_records',                    'decision_question',             'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_cadences',                   'event_name',                    'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_cadences',                   'expected_evidence_type',        'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_decisions',           'decision_text',                 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_btpm_context_links',  'context_reason',                'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_cross_project_links', 'relationship_reason',           'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_references', 'title',                         'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_references', 'external_url',                  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_references', 'summary',                       'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'site_id',                       'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'drive_id',                      'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'item_id',                       'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'file_name',                     'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'evidence_title',                'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'file_extension',                'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'mime_type',                     'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'etag',                          'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'ctag',                          'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'parent_path',                   'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'sharepoint_web_url',            'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_evidence_files',      'evidence_summary',              'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_brief_versions',      'raw_copilot_output',            'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_brief_versions',      'edited_brief_text',             'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_brief_versions',      'executive_intro_text',          'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_brief_versions',      'options_summary',               'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_brief_versions',      'recommendation_text',           'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_brief_versions',      'guardrails_text',               'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_brief_versions',      'residual_risks_text',           'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_brief_versions',      'requested_decision_text',       'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_brief_versions',      'open_questions_text',           'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_copilot_data_packages','package_filename',             'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_copilot_data_packages','package_json',                 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_copilot_data_packages','bundle_filename',              'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_decision_outcomes',   'final_decision_text',           'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_decision_outcomes',   'decided_by_text',               'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_decision_outcomes',   'approval_forum',                'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_decision_outcomes',   'decision_rationale',            'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_decision_outcomes',   'conditions_guardrails',         'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_decision_outcomes',   'residual_risks',                'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_decision_outcomes',   'follow_up_actions',             'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_decision_outcomes',   'signoff_evidence_url',          'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_decision_outcomes',   'closure_note',                  'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','audience_text',                 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','package_title',                 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','executive_summary',             'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','decision_question_text',        'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','background_context',            'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','options_summary',               'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','recommendation_text',           'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','decision_ask_text',             'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','evidence_summary',              'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','guardrails_text',               'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','residual_risks_text',           'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','next_steps_text',               'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','distribution_note',             'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('governance',     'governance_record_stakeholder_packages','distribution_evidence_url',     'organizations.tenant_id via t.organization_id','t.organization_id',NULL),

 -- Notifications / email payloads
 ('notifications',  'notification_outbox',     'payload', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL),
 ('notifications',  'email_payload_snapshots', 'payload', 'organizations.tenant_id via t.organization_id','t.organization_id',NULL);

-- ----------------------------------------------------------------
-- 3. Result accumulator.
-- ----------------------------------------------------------------
CREATE TEMP TABLE pg_temp._4d12g_results (
  domain_area                        text,
  table_name                         text,
  column_name                        text,
  total_rows                         bigint,
  null_or_empty                      bigint,
  tenant_versioned_candidate         bigint,
  tenant_versioned_decryptable       bigint,
  tenant_versioned_unreadable        bigint,
  legacy_candidate                   bigint,
  legacy_decryptable                 bigint,
  legacy_unreadable                  bigint,
  missing_tenant_context             bigint,
  missing_organization_context       bigint,
  unsupported_or_malformed_versioned bigint,
  invalid_or_unclassified            bigint,
  migration_ready                    boolean,
  migration_blocker                  boolean,
  notes                              text
) ON COMMIT DROP;

-- ----------------------------------------------------------------
-- 4. Classify each registered (table, column) via dynamic SQL.
--    Uses organizations join for tenant/org resolution, and a
--    special-case join through kpi_app_submission_outbox for the
--    kpi_app_submission_attempts rows.
--    Only aggregate counts are stored — no row-level values.
-- ----------------------------------------------------------------
DO $do$
DECLARE
  r      record;
  sql    text;
  join_c text;
  tid    text;
  oid    text;
  col    text;
BEGIN
  FOR r IN SELECT * FROM pg_temp._4d12g_registry LOOP
    IF r.table_name = 'kpi_app_submission_attempts' THEN
      join_c := 'LEFT JOIN public.kpi_app_submission_outbox ob ON ob.id = t.outbox_id
                 LEFT JOIN public.organizations o ON o.id = ob.organization_id';
      tid    := 'o.tenant_id';
      oid    := 'ob.organization_id';
    ELSE
      join_c := 'LEFT JOIN public.organizations o ON o.id = t.organization_id';
      tid    := 'o.tenant_id';
      oid    := 't.organization_id';
    END IF;

    col := quote_ident(r.column_name);

    sql := format($f$
      WITH classified AS (
        SELECT pg_temp.btpm_4d12g_classify(t.%1$s, %2$s, %3$s) AS status
        FROM public.%4$I t
        %5$s
      )
      INSERT INTO pg_temp._4d12g_results (
        domain_area, table_name, column_name,
        total_rows, null_or_empty,
        tenant_versioned_candidate, tenant_versioned_decryptable, tenant_versioned_unreadable,
        legacy_candidate, legacy_decryptable, legacy_unreadable,
        missing_tenant_context, missing_organization_context,
        unsupported_or_malformed_versioned, invalid_or_unclassified,
        migration_ready, migration_blocker, notes
      )
      SELECT
        %6$L, %7$L, %8$L,
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'null_or_empty'),
        COUNT(*) FILTER (WHERE status IN ('tenant_versioned_decryptable','tenant_versioned_unreadable')),
        COUNT(*) FILTER (WHERE status = 'tenant_versioned_decryptable'),
        COUNT(*) FILTER (WHERE status = 'tenant_versioned_unreadable'),
        COUNT(*) FILTER (WHERE status IN ('legacy_decryptable','legacy_unreadable')),
        COUNT(*) FILTER (WHERE status = 'legacy_decryptable'),
        COUNT(*) FILTER (WHERE status = 'legacy_unreadable'),
        COUNT(*) FILTER (WHERE status = 'missing_tenant_context'),
        COUNT(*) FILTER (WHERE status = 'missing_organization_context'),
        COUNT(*) FILTER (WHERE status = 'unsupported_or_malformed_versioned'),
        COUNT(*) FILTER (WHERE status NOT IN (
          'null_or_empty',
          'tenant_versioned_decryptable','tenant_versioned_unreadable',
          'legacy_decryptable','legacy_unreadable',
          'missing_tenant_context','missing_organization_context',
          'unsupported_or_malformed_versioned'
        )),
        -- migration_ready: every non-null value is decryptable via the strict path
        (COUNT(*) FILTER (WHERE status NOT IN (
          'null_or_empty','legacy_decryptable','tenant_versioned_decryptable'
        )) = 0),
        -- migration_blocker: any unreadable / missing-context / malformed / unclassified
        (COUNT(*) FILTER (WHERE status IN (
          'tenant_versioned_unreadable','legacy_unreadable',
          'missing_tenant_context','missing_organization_context',
          'unsupported_or_malformed_versioned'
        )) > 0
        OR COUNT(*) FILTER (WHERE status NOT IN (
          'null_or_empty',
          'tenant_versioned_decryptable','tenant_versioned_unreadable',
          'legacy_decryptable','legacy_unreadable',
          'missing_tenant_context','missing_organization_context',
          'unsupported_or_malformed_versioned'
        )) > 0),
        %9$L
      FROM classified;
    $f$, col, tid, oid, r.table_name, join_c,
        r.domain_area, r.table_name, r.column_name, COALESCE(r.notes,''));

    EXECUTE sql;
  END LOOP;
END
$do$;

-- ----------------------------------------------------------------
-- 5. Final aggregate report — counts only.
-- ----------------------------------------------------------------
SELECT
  domain_area,
  table_name,
  column_name,
  total_rows,
  null_or_empty,
  tenant_versioned_candidate,
  tenant_versioned_decryptable,
  tenant_versioned_unreadable,
  legacy_candidate,
  legacy_decryptable,
  legacy_unreadable,
  missing_tenant_context,
  missing_organization_context,
  unsupported_or_malformed_versioned,
  invalid_or_unclassified,
  migration_ready,
  migration_blocker,
  notes
FROM pg_temp._4d12g_results
ORDER BY domain_area, table_name, column_name;

COMMIT;

-- End of read-only dry-run.
