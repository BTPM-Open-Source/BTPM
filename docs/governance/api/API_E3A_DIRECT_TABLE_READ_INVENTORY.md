# API-E.3A — Direct-Table-Read Containment Inventory (Frozen)

Status: **Frozen (inventory only, no runtime change).**
Phase: API-E.
Pre-step accepted SHA: `014a27f95f964787ec0dc32401fd51a4d8bc3da1`.

## 1. Purpose

This document freezes the exact set of `public` schema tables whose current
Row Level Security posture permits ordinary `authenticated` browser sessions
to `SELECT` rows directly through PostgREST, **and which therefore must
receive OAuth direct-read containment in API-E.3B**.

The frozen Category A allowlist below is the single source of truth for
API-E.3B and is mirrored byte-for-byte in the static contract test at
`supabase/functions/_shared/api-e-3a-direct-table-read-inventory_static_test.ts`.

This step is **inventory only**. It does **not** create, alter, or drop any
table, policy, function, trigger, grant, RLS setting, edge function, secret,
token, client registration, or data. No migration is applied by this step.

## 2. Method

1. Enumerated all `public` tables with `relrowsecurity = true` from the
   connected Supabase runtime catalog (`pg_class`).
2. Enumerated all `SELECT` policies on those tables from `pg_policies`,
   restricting to policies whose `roles` array contains `authenticated` or
   applies to `PUBLIC`.
3. Cross-checked against timestamp-ordered repository migrations under
   `supabase/migrations/` to confirm every classified table has a
   `CREATE TABLE public.<name>` statement, an
   `ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY` statement, and at
   least one `CREATE POLICY ... FOR SELECT ... TO authenticated` (or PUBLIC)
   statement in the repository baseline.
4. Classified each table into exactly one of three categories:
   - **A. API-sensitive BTPM business data.** Requires restrictive OAuth
     read containment in API-E.3B — direct PostgREST reads from an OAuth
     bearer session must be blocked, and reads must go through explicit
     future API wrappers.
   - **B. Authentication, membership, client-policy, or control metadata.**
     Not a PM business-read target; keeps its existing intended contract.
   - **C. Server-only / already browser-unreadable.** Already protected
     without additional API-E.3B policy.

Authority classification was derived from actual policies and grants and
from the table's role in the BTPM domain, **not** from UI routes or active
context.

Runtime-versus-migration discrepancies: **none observed**. Every Category A
table exists in migrations, has RLS enabled in both catalog and migrations,
and has at least one `authenticated` `SELECT` policy in both.

No production row counts, tenant identifiers, policy secrets, or user data
are recorded in this document.

## 3. Category A — Frozen Allowlist (62 tables)

The following alphabetically sorted set is the frozen Category A allowlist.
Every entry has RLS enabled and an effective `authenticated` `SELECT`
policy today, gated by a PM-authority predicate (project/workspace/org
membership or ownership). Under API-E.3B, direct PostgREST reads from a
session carrying an OAuth `client_id` claim must be blocked; reads must be
routed through explicit API wrappers established on the API-E.1 trusted
transaction-local context.

| # | Table | RLS | Effective authenticated/PUBLIC SELECT policy(s) | Authority predicate (from pg_policies.qual) | Why direct OAuth read must be blocked |
|---|-------|-----|-------------------------------------------------|---------------------------------------------|---------------------------------------|
| 1 | `activity_events` | on | `ae_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND (is_org_admin(org) OR (target_type IN {project,phase,task,risk,blocker,kpi_definition,governance_cadence,governance_record} AND can_read_project_by_target(target_type,target_id)) OR (target_type IN {invitation,user,project_template} AND workspace_id IS NOT NULL AND is_workspace_admin_or_higher(workspace_id)))` | Cross-project PM audit trail |
| 2 | `adoption_initiatives` | on | `adoption_initiatives_select` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id)` | PM adoption planning data |
| 3 | `adoption_object_links` | on | `adoption_object_links_select` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id)` | PM adoption planning links |
| 4 | `adoption_plans` | on | `adoption_plans_select` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id)` | PM adoption planning data |
| 5 | `adoption_template_initiatives` | on | `adoption_template_initiatives_select` (authenticated) | `is_active_user(auth.uid()) AND (is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id))` | PM adoption template data |
| 6 | `adoption_template_tasks` | on | `adoption_template_tasks_select` (authenticated) | `is_active_user(auth.uid()) AND (is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id))` | PM adoption template data |
| 7 | `adoption_templates` | on | `adoption_templates_select` (authenticated) | `is_active_user(auth.uid()) AND (is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id))` | PM adoption template data |
| 8 | `backlog_items` | on | `bi_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND can_read_project(auth.uid(), project_id)` | Agile backlog PM data |
| 9 | `blockers` | on | `blk_select_scoped` (authenticated); `blk_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND can_read_project_by_target(auth.uid(), target_type, target_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | PM blocker data |
| 10 | `board_workflow_states` | on | `bws_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND can_read_project(auth.uid(), project_id)` | PM board configuration |
| 11 | `comments` | on | `cmt_select_ws` (authenticated); `cmt_select_demo_org` (authenticated) | ws: `is_active_user(auth.uid()) AND can_read_project_by_target(auth.uid(), target_type, target_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | PM generic comments |
| 12 | `decision_case_ai_run_files` | on | `dcarf_select_project_authorized` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id)` | Decision case artifacts |
| 13 | `decision_case_ai_runs` | on | `dcar_select_project_authorized` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id)` | Decision case artifacts |
| 14 | `dependencies` | on | `dep_select_scoped` (authenticated); `dep_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND can_read_project_by_target(auth.uid(), target_type, target_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | PM dependency graph |
| 15 | `entity_object_links` | on | `eol_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND (is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id))` | PM entity linking |
| 16 | `entity_user_links` | on | `eul_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND (is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id))` | PM stakeholder/accountability |
| 17 | `execution_updates` | on | `eu_select_ws` (authenticated); `eu_select_demo_org` (authenticated) | ws: `is_active_user(auth.uid()) AND can_read_project_by_target(auth.uid(), target_type, target_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | Dated execution update logs |
| 18 | `generated_operational_documents` | on | `god_select_scoped` (authenticated); `god_select_workspace_scoped` (public) | scoped: `is_active_user(auth.uid()) AND can_read_project(auth.uid(), project_id)`; workspace-scoped: `is_active_user(auth.uid()) AND project_id IS NULL AND workspace_id IS NOT NULL AND is_workspace_member(auth.uid(), workspace_id)` | PM generated docs |
| 19 | `governance_cadences` | on | `gc_select_project_authorized` (authenticated) | inline: `can_read_project(auth.uid(), project_id)` | Governance PM data |
| 20 | `governance_record_brief_versions` | on | `gbv_select_project_authorized` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id)` | Governance PM brief versions |
| 21 | `governance_record_btpm_context_links` | on | `gbcl_select_project_authorized` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id) AND has_project_access(auth.uid(), source_project_id)` | Cross-project governance context |
| 22 | `governance_record_copilot_data_packages` | on | `gcdp_select_project_and_sources_authorized` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id) AND NOT EXISTS (SELECT 1 FROM unnest(source_project_ids) sp(id) WHERE NOT has_project_access(auth.uid(), sp.id))` | Governance copilot data packages |
| 23 | `governance_record_cross_project_links` | on | `gcpl_select_project_authorized` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id) AND has_project_access(auth.uid(), linked_project_id)` | Cross-project governance links |
| 24 | `governance_record_decision_outcomes` | on | `gdo_select_project_authorized` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id)` | Governance decision outcomes |
| 25 | `governance_record_decisions` | on | `grd_select_project_authorized` (authenticated) | inline: `can_read_project(auth.uid(), project_id)` | Governance decisions |
| 26 | `governance_record_evidence_files` | on | `gref_select_project_authorized` (authenticated) | inline: `is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id)` | Governance evidence files |
| 27 | `governance_record_evidence_references` | on | `gre_select_project_authorized` (authenticated) | inline: `is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id)` | Governance evidence references |
| 28 | `governance_record_links` | on | `grl_select_project_authorized` (authenticated) | inline: `can_read_project(auth.uid(), project_id)` | Governance record links |
| 29 | `governance_record_stakeholder_packages` | on | `gsp_select_project_authorized` (authenticated) | `is_active_user(auth.uid()) AND has_project_access(auth.uid(), project_id)` | Governance stakeholder packages |
| 30 | `governance_records` | on | `gr_select_project_authorized` (authenticated) | inline: `can_read_project(auth.uid(), project_id)` | Governance PM records |
| 31 | `kpi_app_external_kpis` | on | `kpi_app_ext_select_org_member` (authenticated) | `is_active_user(auth.uid()) AND organization_id = get_user_org_id(auth.uid()) AND (is_org_member(auth.uid(), organization_id) OR is_org_admin(auth.uid(), organization_id))` | KPI external app data |
| 32 | `kpi_app_mappings` | on | `kpi_app_map_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND can_read_project(auth.uid(), project_id)` | KPI app mappings |
| 33 | `kpi_definitions` | on | `kpi_def_select_scoped` (authenticated); `kpi_def_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND can_read_project_by_target(auth.uid(), target_type, target_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | KPI definition PM data |
| 34 | `kpi_schedule_policies` | on | `ksp_select_admin` (authenticated) | `is_active_user(auth.uid()) AND (is_org_admin(auth.uid(), organization_id) OR is_workspace_admin_or_higher(auth.uid(), workspace_id))` | KPI schedule policies |
| 35 | `kpi_snapshots` | on | `kpi_snap_select_scoped` (authenticated); `kpi_snap_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND can_read_project(auth.uid(), project_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | KPI PM snapshots |
| 36 | `kpi_updates` | on | `kpi_upd_select_scoped` (authenticated); `kpi_upd_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND has_project_access_by_kpi_def(auth.uid(), kpi_definition_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | KPI PM updates |
| 37 | `phases` | on | `ph_select_scoped` (authenticated); `ph_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND can_read_project(auth.uid(), project_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | Core PM Phase entity |
| 38 | `portfolio_item_team_members` | on | `portfolio_item_team_members_admin_select` (authenticated) | `is_active_user(auth.uid()) AND is_org_admin(auth.uid(), organization_id)` | Portfolio team assignments |
| 39 | `portfolio_items` | on | `portfolio_items_admin_select` (authenticated) | `is_active_user(auth.uid()) AND is_org_admin(auth.uid(), organization_id)` | Portfolio PM data |
| 40 | `programs` | on | `prg_select_scoped` (authenticated); `prg_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND (is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id))`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | Core PM Program entity |
| 41 | `project_benefits` | on | `pben_select_project_access` (authenticated) | inline: `has_project_access(auth.uid(), project_id)` | PM benefits data |
| 42 | `project_closure_summaries` | on | `pclos_select_project_access` (authenticated) | inline: `has_project_access(auth.uid(), project_id)` | PM closure data |
| 43 | `project_lessons_learned_documents` | on | `pll_select_project_access` (authenticated) | inline: `has_project_access(auth.uid(), project_id)` | PM lessons learned |
| 44 | `project_people_preset_members` | on | `ppp_members_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND EXISTS (SELECT 1 FROM project_people_presets p WHERE p.id = preset_id AND (is_workspace_member(auth.uid(), p.workspace_id) OR is_org_admin(auth.uid(), p.organization_id)))` | PM people preset membership |
| 45 | `project_people_presets` | on | `ppp_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND (is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id))` | PM people preset |
| 46 | `project_stakeholders` | on | `pst_select_scoped` (authenticated); `pst_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND (is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id))`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | PM stakeholder data |
| 47 | `project_team_members` | on | `ptm_select_scoped` (authenticated); `ptm_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND can_read_project(auth.uid(), project_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | PM team membership |
| 48 | `project_templates` | on | `pt_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND (is_workspace_member(auth.uid(), workspace_id) OR is_org_admin(auth.uid(), organization_id))` | PM templates |
| 49 | `projects` | on | `prj_select_scoped` (authenticated); `prj_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND can_read_project(auth.uid(), id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | Core PM Project entity |
| 50 | `raci_assignments` | on | `raci_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND can_read_project_by_target(auth.uid(), target_type, target_id)` | RACI PM data |
| 51 | `risks` | on | `rsk_select_scoped` (authenticated); `rsk_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND can_read_project_by_target(auth.uid(), target_type, target_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | PM risk data |
| 52 | `roadmap_story_ai_run_files` | on | `Owner reads story-pack AI run files` (authenticated) | inline: `is_story_pack_owner(auth.uid(), story_pack_id)` | Roadmap story-pack AI artifacts |
| 53 | `roadmap_story_ai_runs` | on | `story_pack_ai_runs_owner_select` (authenticated) | `is_story_pack_owner(auth.uid(), story_pack_id) AND is_active_user(auth.uid())` | Roadmap story-pack AI runs |
| 54 | `roadmap_story_pack_external_files` | on | `story_pack_ext_files_owner_select` (authenticated) | `is_story_pack_owner(auth.uid(), story_pack_id) AND is_active_user(auth.uid())` | Roadmap external files |
| 55 | `roadmap_story_pack_notes` | on | `story_pack_notes_owner_select` (authenticated) | `is_story_pack_owner(auth.uid(), story_pack_id) AND is_active_user(auth.uid())` | Roadmap notes |
| 56 | `roadmap_story_pack_sources` | on | `story_pack_sources_owner_select` (authenticated) | `is_story_pack_owner(auth.uid(), story_pack_id) AND is_active_user(auth.uid())` | Roadmap sources |
| 57 | `roadmap_story_pack_versions` | on | `story_pack_versions_owner_select` (authenticated) | `is_story_pack_owner(auth.uid(), story_pack_id) AND is_active_user(auth.uid())` | Roadmap versions |
| 58 | `roadmap_story_packs` | on | `story_packs_owner_select` (authenticated) | inline: `created_by = auth.uid() AND is_active_user(auth.uid())` | Roadmap story packs |
| 59 | `sharepoint_project_bindings` | on | `spb_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND can_read_project(auth.uid(), project_id)` | PM external file bindings |
| 60 | `sprints` | on | `spr_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND can_read_project(auth.uid(), project_id)` | Agile sprints PM data |
| 61 | `task_assignments` | on | `ta_select_scoped` (authenticated) | `is_active_user(auth.uid()) AND can_read_project_by_target(auth.uid(), 'task', task_id)` | PM assignment data |
| 62 | `tasks` | on | `tsk_select_scoped` (authenticated); `tsk_select_demo_org` (authenticated) | scoped: `is_active_user(auth.uid()) AND can_read_project(auth.uid(), project_id)`; demo: `is_active_user(auth.uid()) AND is_demo_workspace(workspace_id) AND organization_id = get_user_org_id(auth.uid())` | Core PM Task entity |

### Category A allowlist (canonical machine-readable form)

The following block is parsed by the API-E.3A static contract test. It
must remain exactly the same set (alphabetical order, one per line, plain
backticked names, no extra decoration):

<!-- BEGIN API-E.3A CATEGORY A ALLOWLIST -->
- `activity_events`
- `adoption_initiatives`
- `adoption_object_links`
- `adoption_plans`
- `adoption_template_initiatives`
- `adoption_template_tasks`
- `adoption_templates`
- `backlog_items`
- `blockers`
- `board_workflow_states`
- `comments`
- `decision_case_ai_run_files`
- `decision_case_ai_runs`
- `dependencies`
- `entity_object_links`
- `entity_user_links`
- `execution_updates`
- `generated_operational_documents`
- `governance_cadences`
- `governance_record_brief_versions`
- `governance_record_btpm_context_links`
- `governance_record_copilot_data_packages`
- `governance_record_cross_project_links`
- `governance_record_decision_outcomes`
- `governance_record_decisions`
- `governance_record_evidence_files`
- `governance_record_evidence_references`
- `governance_record_links`
- `governance_record_stakeholder_packages`
- `governance_records`
- `kpi_app_external_kpis`
- `kpi_app_mappings`
- `kpi_definitions`
- `kpi_schedule_policies`
- `kpi_snapshots`
- `kpi_updates`
- `phases`
- `portfolio_item_team_members`
- `portfolio_items`
- `programs`
- `project_benefits`
- `project_closure_summaries`
- `project_lessons_learned_documents`
- `project_people_preset_members`
- `project_people_presets`
- `project_stakeholders`
- `project_team_members`
- `project_templates`
- `projects`
- `raci_assignments`
- `risks`
- `roadmap_story_ai_run_files`
- `roadmap_story_ai_runs`
- `roadmap_story_pack_external_files`
- `roadmap_story_pack_notes`
- `roadmap_story_pack_sources`
- `roadmap_story_pack_versions`
- `roadmap_story_packs`
- `sharepoint_project_bindings`
- `sprints`
- `task_assignments`
- `tasks`
<!-- END API-E.3A CATEGORY A ALLOWLIST -->

## 4. Category B — Authentication, membership, client-policy, control (excluded)

These tables are excluded from API-E.3B direct-read containment because
they are **not** PM business-read targets. They remain under their existing
intended contract (user-scoped, org-admin-scoped, or self-scoped reads),
and any future OAuth exposure of them will be handled by separate steps in
the API-C / API-D / control-plane phases, not by API-E.3B.

| Table | Reason for exclusion |
|-------|----------------------|
| `ai_feature_settings`, `ai_instruction_templates`, `ai_model_registry`, `tenant_ai_provider_settings` | AI configuration / control-plane metadata |
| `ai_help_conversations`, `ai_help_messages`, `ai_help_message_feedback` | User-owned assistant chat, self-scoped |
| `invitations` | Membership/invitation control metadata |
| `knowledge_articles`, `knowledge_article_ai_metadata`, `knowledge_categories` | Knowledge-base content, not per-project PM operational data |
| `notification_outbox` | User-scoped notification metadata |
| `organizations`, `organization_memberships`, `organization_secret_overrides` | Tenant / org control metadata |
| `platform_super_admins` | Platform control metadata |
| `powerbi_data_scope_rules` | Reporting-scope control metadata |
| `profiles`, `user_active_context_preferences`, `user_roles`, `user_saved_views` | User / authorization metadata |
| `sharepoint_org_site_connections`, `sharepoint_workspace_bindings` | Org/workspace integration configuration |
| `tenant_export_packages`, `tenant_integrations`, `tenant_memberships`, `tenant_secret_access_audit` | Tenant control / audit metadata |
| `workspaces`, `workspace_memberships` | Workspace control metadata |

## 5. Category C — Server-only / already browser-unreadable (excluded)

These tables have no effective browser-reachable read path today (either no
`SELECT` policy for `authenticated`, or an owner-only policy that never
matches a browser session by design), and therefore need no additional
API-E.3B policy. Reads are performed by trusted server jobs, edge
functions, or admin flows.

| Table | Reason for exclusion |
|-------|----------------------|
| `btpm_import_batches` | Admin Import surface (separately governed under PMG §2.10 / API-E.2C); not a browser-readable PM business-data target |
| `email_payload_snapshots`, `outbound_email_events` | Server-managed email pipeline |
| `kpi_app_scheduler_runs`, `kpi_app_scheduler_run_items`, `kpi_app_submission_attempts`, `kpi_app_submission_outbox` | KPI submission scheduler/outbox, server-only |
| `kpi_snapshot_capture_runs`, `kpi_snapshot_capture_run_items` | Snapshot capture scheduler, server-only |
| `platform_background_jobs`, `tenant_background_jobs`, `tenant_scheduler_runs` | Background job control |
| `tenant_import_temp_objects`, `tenant_storage_objects` | Server-managed storage / import staging |

The following API-C / API-D control tables are **explicitly out of scope**
for API-E.3B and are not enumerated as Category A or B here because they
are governed by their own phase contracts:

`api_clients`, `api_client_policy_versions`,
`api_organization_client_enablements`, `api_workspace_client_enablements`,
`api_user_policy_acknowledgements`, `api_capability_grants`,
`api_consent_audit_events`.

Auth-schema, storage-schema, realtime, vault, and Supabase-reserved tables
are outside the `public` schema and are not inventoried here.

## 6. Runtime-vs-migration discrepancies

None observed. All 62 Category A tables exist in migrations with
`ENABLE ROW LEVEL SECURITY` and at least one authenticated `SELECT`
policy, and match the runtime catalog.

## 7. No runtime change

This step introduces:

- No new migration.
- No new or altered RLS policy.
- No new or altered function, trigger, grant, or role.
- No new or altered edge function, secret, token, or client registration.
- No data change.

API-E.3B is the next step that will introduce restrictive OAuth read
containment on the Category A allowlist above.
