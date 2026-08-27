# API-E.4A Remaining Direct-Bypass Inventory (C5, corrected by C2)

Correction marker: **C5** — user-authorized fifth correction, refined by
**API-E.C2** (length-preserving SQL lexical masking + unified coordinate
system for every analyzer-recorded position).

## Scope of this document (API-E.R1)

**This inventory and its analyzer are advisory audit evidence only.**

- The `requires_db_gate` bucket means the static analyzer, under its
  conservative lexical model, did not mechanically prove containment
  for the listed signatures. The count MUST NOT be interpreted as a
  count of proven vulnerabilities.
- Parser completeness is **not** an API-E completion criterion.
- API-E completion remains governed by the approved
  API-E.1–API-E.5 deliverables (trusted execution context, shared
  gates, direct-table-read containment, private-helper privilege
  contract, and their runtime behavior).
- No additional SQL, PL/pgSQL, `CASE`, branch, or expression-parser
  development is authorized by this document.
- Historical SHAs that appear below (`11e1a851…`, `f0e83308…`) are
  retained only as historical narrative; they are **not** current
  acceptance invariants.

## 1. Universe

- Full definition corpus: `docs/governance/api/evidence/API_E4A_RUNTIME_SURFACE_SNAPSHOT.json`
- Schema version: 3
- Universe count (in-scope `SECURITY DEFINER` functions in `public`, `EXECUTE` granted to `authenticated`): **564**


Universe query meaning (reproducible from the snapshot):
```
{
  "schema": "public",
  "prokind": "f",
  "excludes_result": "trigger",
  "effective_execute": "authenticated",
  "signature_form": "proname || '(' || pg_get_function_identity_arguments(oid) || ')'"
}
```

## 2. Approved gates and control-plane exact signatures

Approved gates (base names):
```
is_active_user
is_org_admin
_assert_admin
_assert_pm_or_admin
_assert_tenant_admin_caller
_assert_tenant_admin_or_super
```

Control-plane exact signatures (auth-adjacent consent commands; classified `out_of_scope_control_plane`):
```
acknowledge_api_d_policy(_client_key text, _correlation_id text)
get_api_d_consent_context(_client_key text)
revoke_api_d_policy(_client_key text, _correlation_id text)
```

## 3. Recomputed C5 counts

| Bucket | Count |
|---|---|
| `contained` | 26 |
| `requires_db_gate` | 519 |
| `out_of_scope_control_plane` | 3 |
| `helper_no_business_surface` | 16 |

The static analyzer in
`supabase/functions/_shared/api-e-4a-remaining-direct-bypass-inventory_static_test.ts`
independently re-derives every classification from the raw definition
text stored in the snapshot, so both the per-signature classification
and each per-bucket count are byte-reproducible from the committed
evidence alone.

### C2 methodology (length-preserving lexical masking + unified coordinates)

Before any executable-code detector runs, the analyzer applies a
deterministic single-pass SQL lexical masker to the extracted function
body. The masker replaces the content of the following lexical states
with SPACE characters while preserving JavaScript string length exactly
and preserving every `\n` and `\r`:

- `--` line comments through the character before the terminating newline;
- nested `/* ... */` block comments;
- ordinary single-quoted strings including `''` doubled-quote escapes;
- `E'...'` / `e'...'` strings including backslash escapes;
- dollar-quoted strings using `$$...$$` or tagged `$tag$...$tag$`.

An unterminated comment or literal is conservatively masked through end
of input so that stray unclosed constructs cannot leak executable signal.

Tokens that occur only inside comments or masked literals contribute no
analyzer signal (no gate, no guard, no business op, no dynamic SQL, no
public relation, no public-function call). The unmodified raw
definition is still used only for evidence excerpts such as
`proof_context`.

All recorded positions — approved gate occurrences, assertion guards,
rejecting boolean guards, business operations, public-function call
sites, unresolved ambiguities, and first-operation positions — are
zero-based **character** offsets in the complete original raw function
definition. The extracted-body offset is added exactly once to every
body-local match; no position is byte-offset-based. Gate-before-operation
comparison therefore compares positions from a single unified coordinate
system.

### Classification rules (conservative)

For every signature:

1. If in the control-plane exact set → `out_of_scope_control_plane`.
2. Else, if the function has any business surface (any
   `INSERT/UPDATE/DELETE/SELECT ... FROM/RETURN QUERY/EXECUTE` or any
   `public.<relation>` reference, in **executable** text only):
   - Collect **guard positions** = positions of `_assert_*` calls, of
     `IF NOT is_active_user(...)`/`IF NOT is_org_admin(...)` rejecting
     boolean guards, and of calls that uniquely resolve to a callee
     already classified `contained`.
   - If any guard position precedes the first business-op position →
     `contained`; else `requires_db_gate`.
3. Else (no business surface):
   - If it contains dynamic SQL or unresolved overload ambiguity →
     `requires_db_gate`.
   - Else, if all resolved callees are `helper_no_business_surface` or
     `out_of_scope_control_plane` → `helper_no_business_surface`.
   - Else → `requires_db_gate`.

The rule is applied iteratively to a fixed point so that
helper-of-helper and guard-of-guard resolutions stabilise. Any
signature that cannot be classified after the fixed point is
conservatively demoted to `requires_db_gate`.

## 4. Baseline reconciliation vs accepted `f0e83308` (historical narrative — not a current acceptance invariant)

Baseline accepted counts (from the markdown at `f0e83308`):

| Bucket | Baseline count |
|---|---|
| `contained` | 439 |
| `requires_db_gate` | 49 |
| `out_of_scope_control_plane` | 3 |
| `helper_no_business_surface` | 73 |

Signature-level delta (recomputed by the static test at run time from
`git show f0e83308:docs/governance/api/API_E4A_REMAINING_DIRECT_BYPASS_INVENTORY.md`):

- `added` (present now, absent in baseline): **0**
- `removed` (present in baseline, absent now): **0**
- Non-trivial transitions (baseline → current bucket, per exact signature):
  - `contained -> requires_db_gate`: 413
  - `requires_db_gate -> requires_db_gate`: 49 (bucket-stable)
  - `helper_no_business_surface -> requires_db_gate`: 57
  - `helper_no_business_surface -> helper_no_business_surface`: 16 (bucket-stable)
  - `out_of_scope_control_plane -> out_of_scope_control_plane`: 3 (bucket-stable)
  - `contained -> contained`: 26 (bucket-stable)

The transitions are a direct consequence of the C5 analyzer being
strictly conservative and, under C2, of every executable-code detector
running against the length-preservingly masked body with unified
absolute-offset coordinates. For a `SECURITY DEFINER` function to
remain `contained`, an approved guard occurrence (assertion, rejecting
boolean, or a uniquely-resolved call to another already-`contained`
callee) MUST lexically precede the first business operation in its body
in that single unified coordinate system. Previously `contained`
signatures that only referenced a gate name *after* their first business
op, that relied on dynamic SQL / ambiguous overloads, or whose apparent
guard occurred only inside a comment or literal, are demoted to
`requires_db_gate` here — never silently. Under C2 one additional
signature (`admin_remove_workspace_access(...)`) is demoted from
`contained` to `requires_db_gate` because its guard call previously
appeared to precede the first business op only under mixed-coordinate
comparison; under unified absolute offsets it does not. One additional
signature (`_btpm_adoption_template_v1()`) is promoted from
`requires_db_gate` to `helper_no_business_surface` because its only
apparent business surface came from tokens inside a masked literal.

## 5. Prescribed overload evidence

The C5 static test asserts every one of the following prescribed base
names is present in the universe with at least one exact signature and
that each signature's classification is one of the four buckets above,
carrying a non-empty `classification_reason` field in the snapshot.

- **PMG-31 canonical operations** (all overloads must appear and be
  explicitly classified):
```
append_execution_update
append_kpi_update
apply_backlog_item_create
apply_backlog_item_update
apply_governance_record_create
apply_governance_record_update
apply_kpi_definition_create
apply_kpi_definition_update
apply_phase_create
apply_phase_update
apply_program_create
apply_program_update
apply_project_create_blank
apply_project_raci_add
apply_project_raci_remove
apply_project_status_transition
apply_project_team_member_add
apply_project_team_member_remove
apply_project_team_member_role_update
apply_project_update
apply_sprint_create
apply_sprint_update
apply_task_assignee_set
apply_task_create
apply_task_execution_change
apply_task_update
create_dependency
remove_dependency
reorder_backlog_items
reorder_phases
reorder_tasks
```

- **Admin import canonical**:
```
commit_btpm_import_v1_core
```

- **Risk / Blocker canonical**:
```
create_blocker_with_links
create_risk_with_links
update_blocker_with_links
update_risk_with_links
list_decrypted_blockers
list_decrypted_risks
list_project_all_blockers
list_project_all_risks
```

Every prescribed base name resolves to at least one exact overload in
the current universe (asserted by test
`API-E.4A-C5: prescribed PMG-31/Admin/Risk-Blocker base names all present`).
Under the C5 conservative analyzer these callable surfaces classify as
`requires_db_gate` because their first business operation (usually a
profile / tenant / active-user lookup) precedes the enforcing gate call,
which is exactly the trusted-execution posture API-E is designed to
require.

## 6. Recomputable buckets

Universe (DB) — every exact signature is emitted below; ordering is
lexicographic and stable so a re-run of the analyzer is
byte-comparable.

```db-contained
admin_list_tenant_integrations(_tenant_id uuid)
admin_upsert_tenant_integration(_tenant_id uuid, _kind tenant_integration_kind, _name text, _config jsonb, _is_enabled boolean, _status tenant_integration_status, _reason text)
get_decrypted_profile(_user_id uuid)
get_decrypted_program(_program_id uuid)
get_kpi_app_mapping_admin(_mapping_id uuid)
get_kpi_app_outbox_admin(_outbox_id uuid)
get_kpi_app_payload_source(_outbox_id uuid)
get_kpi_snapshot_decrypted_for_mapping(_mapping_id uuid, _snapshot_id uuid)
list_decrypted_activity_events(_target_type text, _target_id uuid)
list_decrypted_blockers(_target_type text, _target_id uuid)
list_decrypted_execution_updates(_target_type text, _target_id uuid)
list_decrypted_program_projects(_program_id uuid)
list_decrypted_workspace_programs(_workspace_id uuid)
log_activity_event(_organization_id uuid, _actor_id uuid, _event_type text, _target_type text, _target_id uuid, _metadata jsonb, _workspace_id uuid)
prepare_kpi_app_report_now_select(_mapping_id uuid, _reporting_period_start date, _reporting_period_end date)
tenant_admin_assign_tenant_admin(_tenant_id uuid, _target_user_id uuid, _reason text)
tenant_admin_get_ai_provider_setting(_tenant_id uuid)
tenant_admin_get_operations_summary(_tenant_id uuid)
tenant_admin_get_overview(_tenant_id uuid)
tenant_admin_list_members(_tenant_id uuid)
tenant_admin_list_organizations(_tenant_id uuid)
tenant_admin_list_tenant_admin_candidates(_tenant_id uuid, _query text)
tenant_admin_list_tenant_admins(_tenant_id uuid)
tenant_admin_list_tenant_authority_audit(_tenant_id uuid, _limit integer)
tenant_admin_remove_tenant_admin(_tenant_id uuid, _target_user_id uuid, _reason text)
tenant_admin_set_ai_provider(_tenant_id uuid, _provider text, _reason text)
```

```db-requires-db-gate
_adoption_template_validate_and_load(_template_id uuid, _organization_id uuid, _workspace_id uuid, _payload jsonb)
_apply_phase_extension_internal(_phase_id uuid, _new_start date, _new_end date, _trigger_id uuid, _trigger_kind text)
_apply_project_extension_internal(_project_id uuid, _new_start date, _new_end date, _trigger_id uuid, _trigger_kind text)
_assert_admin(_workspace_id uuid, _organization_id uuid)
_assert_job_payload_no_secret_keys(_payload jsonb)
_assert_pm_or_admin(_workspace_id uuid, _organization_id uuid)
_assert_tenant_admin_caller(_tenant_id uuid)
_assert_tenant_admin_or_super(_tenant_id uuid, _reason text)
_clone_anchor_for_phase(_phase_id uuid)
_clone_anchor_for_project(_project_id uuid)
_clone_anchor_for_task(_task_id uuid)
_compute_project_effective_window(_bp jsonb, _anchor date)
_gov_assert_project_read(_project_id uuid)
_gov_assert_project_write(_project_id uuid)
_gov_report_assert_scope(_organization_id uuid, _workspace_id uuid)
_kc_ai_meta_decrypt_array(_cipher text, _org uuid)
_kc_ai_meta_decrypt_jsonb(_cipher text, _org uuid)
_kc_ai_meta_encrypt_array(_arr text[], _org uuid)
_kc_ai_meta_encrypt_jsonb(_value jsonb, _org uuid)
_log_entity_material_update(_owner_type text, _owner_id uuid, _organization_id uuid, _workspace_id uuid, _anchor_type text, _anchor_id uuid, _scalar_diff jsonb, _old_user_ids uuid[], _new_user_ids uuid[], _old_object_keys text[], _new_object_keys text[], _old_user_labels jsonb, _new_user_labels jsonb, _old_object_labels jsonb, _new_object_labels jsonb, _entity_title text)
_project_id_from_target(_target_type text, _target_id uuid)
_provision_default_tenant_integrations(_tenant_id uuid)
_recompute_phase_actuals(_phase_id uuid)
_recompute_phase_completion(_phase_id uuid)
_recompute_project_actuals(_project_id uuid)
_snapshot_baseline(_project_id uuid)
_validate_object_links(_links jsonb, _workspace_id uuid, _organization_id uuid)
_validate_user_links(_links jsonb, _workspace_id uuid)
_validate_user_links(_links jsonb, _workspace_id uuid, _project_id uuid)
accept_invitation(_token uuid)
accept_pending_invitation_for_user(_user_id uuid, _invitation_id uuid)
activate_ai_instruction_template(_id uuid)
add_adoption_template_tasks_to_existing_plan(_project_id uuid, _template_id uuid, _template_key text, _selected_task_keys text[])
add_project_people_preset_member(_preset_id uuid, _expected_preset_updated_at timestamp with time zone, _member_kind text, _stakeholder_type text, _user_id uuid, _external_name text, _canonical_role_key text, _role_label text, _correlation_id text, _idempotency_key text)
add_project_stakeholder(_project_id uuid, _stakeholder_type text, _user_id uuid, _external_name text, _role_label text, _notes text, _start_date date)
add_roadmap_story_pack_external_file(_story_pack_id uuid, _drive_id text, _item_id text, _display_name text, _web_url text, _user_note text, _mime_type text, _size_bytes bigint, _include_in_story boolean, _provider text)
add_roadmap_story_pack_note(_story_pack_id uuid, _body text, _label text, _include_in_story boolean, _sort_order integer)
adjust_governance_cadence_next_expected_date(_cadence_id uuid, _next_expected_date date)
admin_add_portfolio_team_member(_portfolio_item_id uuid, _user_id uuid, _role text)
admin_add_workspace_access(_organization_id uuid, _target_user_id uuid, _workspace_id uuid, _role app_role)
admin_archive_portfolio_item(_portfolio_item_id uuid, _is_archived boolean)
admin_assign_projects_to_portfolio(_portfolio_item_id uuid, _project_ids uuid[])
admin_change_workspace_role(_organization_id uuid, _target_user_id uuid, _workspace_id uuid, _new_role app_role)
admin_create_invitation(_organization_id uuid, _email text, _workspace_id uuid, _role app_role)
admin_create_portfolio_item(_organization_id uuid, _name text, _code text, _description text, _lifecycle_state text, _owner_id uuid, _strategic_priority text)
admin_deactivate_user(_organization_id uuid, _target_user_id uuid)
admin_delete_invitation(_organization_id uuid, _invitation_id uuid)
admin_delete_knowledge_article_ai_metadata(_article_id uuid)
admin_delete_user(_organization_id uuid, _target_user_id uuid)
admin_get_knowledge_article_ai_metadata(_article_id uuid)
admin_list_btpm_import_batches(_organization_id uuid)
admin_list_invitations(_organization_id uuid)
admin_list_org_workspaces(_organization_id uuid)
admin_list_portfolio_items(_organization_id uuid, _include_archived boolean)
admin_list_portfolio_project_assignment_candidates(_portfolio_item_id uuid, _workspace_ids uuid[], _search text, _include_archived boolean)
admin_list_portfolio_team_members(_portfolio_item_id uuid)
admin_list_project_move_candidates(_organization_id uuid)
admin_move_project_workspace(_organization_id uuid, _project_id uuid, _target_workspace_id uuid, _target_program_id uuid, _confirm_program_clear boolean)
admin_preview_project_workspace_move(_organization_id uuid, _project_id uuid, _target_workspace_id uuid, _target_program_id uuid)
admin_reactivate_user(_organization_id uuid, _target_user_id uuid)
admin_remove_portfolio_team_member(_team_member_id uuid)
admin_remove_projects_from_portfolio(_portfolio_item_id uuid, _project_ids uuid[])
admin_remove_workspace_access(_organization_id uuid, _target_user_id uuid, _workspace_id uuid)
admin_resend_invitation(_organization_id uuid, _invitation_id uuid)
admin_revoke_invitation(_organization_id uuid, _invitation_id uuid)
admin_set_org_admin(_organization_id uuid, _target_user_id uuid, _is_admin boolean)
admin_test_tenant_integration_metadata(_integration_id uuid, _reason text)
admin_update_portfolio_item(_portfolio_item_id uuid, _name text, _code text, _description text, _lifecycle_state text, _owner_id uuid, _strategic_priority text)
admin_update_portfolio_team_member_role(_team_member_id uuid, _role text)
admin_upsert_knowledge_article_ai_metadata(_article_id uuid, _ai_flow text, _feature_area text[], _route_patterns text[], _user_intents text[], _audience text[], _synonyms text[], _freshness_label text, _related_feature_flags text[], _question_examples text[], _answer_rules text[], _forbidden_claims text[])
admin_upsert_knowledge_article_ai_metadata(_article_id uuid, _ai_flow text, _feature_area text[], _route_patterns text[], _user_intents text[], _audience text[], _synonyms text[], _freshness_label text, _related_feature_flags text[], _question_examples text[], _answer_rules text[], _forbidden_claims text[], _workflow_metadata jsonb)
adoption_resolve_object_project(_object_type text, _object_id uuid)
ai_guide_v2_admin_get_chunk_summary(p_organization_id uuid)
ai_guide_v2_admin_reindex_knowledge(p_scope text, p_article_id uuid, p_force boolean)
ai_guide_v2_list_index_status(p_organization_id uuid)
ai_guide_v2_match_knowledge_chunks(query_embedding extensions.vector, p_organization_id uuid, p_user_id uuid, p_route text, p_feature_area text[], p_intent_type text, p_workflow_id text, p_match_count integer, p_min_similarity numeric)
ai_help_admin_list_history_feedback(_date_from timestamp with time zone, _date_to timestamp with time zone, _user_id uuid, _rating text, _reason_code text, _context_route text, _search text, _limit integer)
ai_help_append_message(_conversation_id uuid, _role text, _content text, _context_route text, _context_label text, _source_article_ids uuid[])
ai_help_archive_conversation(_conversation_id uuid)
ai_help_create_conversation(_context_route text, _context_label text, _title text)
ai_help_list_conversations(_include_archived boolean)
ai_help_list_messages(_conversation_id uuid)
ai_help_list_my_feedback_for_conversation(_conversation_id uuid)
ai_help_update_conversation_title(_conversation_id uuid, _title text)
ai_help_upsert_message_feedback(_assistant_message_id uuid, _rating text, _reason_code text, _comment text)
append_execution_update(_target_type text, _target_id uuid, _summary text, _update_date date, _status_label text, _correlation_id text, _idempotency_key text)
append_kpi_update(_kpi_definition_id uuid, _value numeric, _update_date date, _note text, _correlation_id text, _idempotency_key text)
apply_backlog_item_create(_project_id uuid, _title text, _description text, _priority text, _phase_id uuid, _sprint_id uuid, _workflow_state_id uuid, _correlation_id text, _idempotency_key text)
apply_backlog_item_update(_backlog_item_id uuid, _expected_updated_at timestamp with time zone, _set_title boolean, _title text, _set_description boolean, _description text, _set_priority boolean, _priority text, _set_phase_id boolean, _phase_id uuid, _set_sprint_id boolean, _sprint_id uuid, _set_workflow_state_id boolean, _workflow_state_id uuid, _correlation_id text, _idempotency_key text)
apply_governance_record_create(_project_id uuid, _event_type text, _actual_date_held date, _cadence_id uuid, _event_name text, _expected_date_snapshot date, _summary text, _decisions_summary text, _external_reference_url text, _sharepoint_evidence_reference text, _record_kind text, _decision_stage text, _decision_question text, _decision_owner_stakeholder_id uuid, _target_decision_date date, _decisions jsonb, _links jsonb, _correlation_id text, _idempotency_key text)
apply_governance_record_update(_record_id uuid, _expected_updated_at timestamp with time zone, _event_type text, _actual_date_held date, _cadence_id uuid, _event_name text, _expected_date_snapshot date, _summary text, _decisions_summary text, _external_reference_url text, _sharepoint_evidence_reference text, _clear_cadence boolean, _clear_event_name boolean, _clear_expected_date_snapshot boolean, _clear_summary boolean, _clear_decisions_summary boolean, _clear_external_reference_url boolean, _clear_sharepoint_evidence_reference boolean, _decision_stage text, _decision_question text, _decision_owner_stakeholder_id uuid, _target_decision_date date, _clear_decision_question boolean, _clear_decision_owner_stakeholder_id boolean, _clear_target_decision_date boolean, _decisions jsonb, _links jsonb, _correlation_id text, _idempotency_key text)
apply_kpi_definition_create(_project_id uuid, _name text, _description text, _unit text, _target_value numeric, _target_direction kpi_target_direction, _source_mode text, _value_type text, _cadence text, _calculation_key text, _formula_version integer, _completion_method text, _comment_required boolean, _action_plan_required boolean, _auto_snapshot_enabled boolean, _correlation_id text, _idempotency_key text)
apply_kpi_definition_update(_kpi_definition_id uuid, _expected_updated_at timestamp with time zone, _name text, _description text, _unit text, _target_value numeric, _target_direction kpi_target_direction, _source_mode text, _value_type text, _cadence text, _calculation_key text, _formula_version integer, _completion_method text, _comment_required boolean, _action_plan_required boolean, _auto_snapshot_enabled boolean, _set_name boolean, _set_description boolean, _set_unit boolean, _set_target_value boolean, _set_target_direction boolean, _set_source_mode boolean, _set_value_type boolean, _set_cadence boolean, _set_calculation_key boolean, _set_formula_version boolean, _set_completion_method boolean, _set_comment_required boolean, _set_action_plan_required boolean, _set_auto_snapshot_enabled boolean, _correlation_id text, _idempotency_key text)
apply_phase_create(_project_id uuid, _name text, _description text, _status pm_status, _phase_type phase_type, _start_date date, _target_end_date date, _sort_order integer, _correlation_id text, _idempotency_key text)
apply_phase_planning_change(_phase_id uuid, _new_start date, _new_end date, _confirm_parent_extension boolean)
apply_phase_timeline_action(_phase_id uuid, _action text, _new_start date, _new_end date, _confirm_project_extension boolean)
apply_phase_update(_phase_id uuid, _expected_updated_at timestamp with time zone, _name text, _description text, _status pm_status, _phase_type phase_type, _correlation_id text, _idempotency_key text)
apply_program_create(_name text, _workspace_id uuid, _description text, _correlation_id text, _idempotency_key text)
apply_program_update(_program_id uuid, _expected_updated_at timestamp with time zone, _name text, _status pm_status, _description text, _set_description boolean, _correlation_id text, _idempotency_key text)
apply_project_binding_validation(_binding_id uuid, _status text, _folder_item_id text, _resolved_site_id text, _resolved_site_web_url text, _resolved_library_id_or_drive_id text, _resolved_library_web_url text, _validation_code text, _validation_note text)
apply_project_create_blank(_name text, _workspace_id uuid, _program_id uuid, _delivery_model project_delivery_model, _correlation_id text, _idempotency_key text)
apply_project_people_preset(_preset_id uuid, _project_id uuid, _correlation_id text, _idempotency_key text)
apply_project_planning_change(_project_id uuid, _new_start date, _new_end date)
apply_project_raci_add(_project_id uuid, _raci_role text, _stakeholder_id uuid, _user_id uuid, _correlation_id text, _idempotency_key text)
apply_project_raci_remove(_assignment_id uuid, _correlation_id text, _idempotency_key text)
apply_project_status_transition(_project_id uuid, _expected_updated_at timestamp with time zone, _target_status pm_status, _confirm_warnings boolean, _correlation_id text, _idempotency_key text)
apply_project_team_member_add(_project_id uuid, _user_id uuid, _role_label text, _canonical_role_key text, _correlation_id text, _idempotency_key text)
apply_project_team_member_remove(_member_id uuid, _expected_updated_at timestamp with time zone, _correlation_id text, _idempotency_key text)
apply_project_team_member_role_update(_member_id uuid, _role_label text, _canonical_role_key text, _expected_updated_at timestamp with time zone, _correlation_id text, _idempotency_key text)
apply_project_update(_project_id uuid, _expected_updated_at timestamp with time zone, _name text, _priority pm_priority, _description text, _charter text, _goals text, _scope_in text, _scope_out text, _business_case text, _success_criteria text, _completion_criteria text, _budget_narrative text, _assumptions text, _constraints text, _program_id uuid, _delivery_model project_delivery_model, _set_name boolean, _set_priority boolean, _set_description boolean, _set_charter boolean, _set_goals boolean, _set_scope_in boolean, _set_scope_out boolean, _set_business_case boolean, _set_success_criteria boolean, _set_completion_criteria boolean, _set_budget_narrative boolean, _set_assumptions boolean, _set_constraints boolean, _set_program_id boolean, _set_delivery_model boolean, _correlation_id text, _idempotency_key text)
apply_sprint_create(_project_id uuid, _name text, _goal text, _status text, _start_date date, _end_date date, _correlation_id text, _idempotency_key text)
apply_sprint_update(_sprint_id uuid, _expected_updated_at timestamp with time zone, _set_name boolean, _name text, _set_goal boolean, _goal text, _set_status boolean, _status text, _set_start_date boolean, _start_date date, _set_end_date boolean, _end_date date, _correlation_id text, _idempotency_key text)
apply_task_assignee_set(_task_id uuid, _assignee_id uuid, _correlation_id text, _idempotency_key text)
apply_task_create(_phase_id uuid, _name text, _description text, _status pm_status, _priority pm_priority, _task_type task_type, _start_date date, _due_date date, _estimated_hours numeric, _sort_order integer, _correlation_id text, _idempotency_key text)
apply_task_execution_change(_task_id uuid, _expected_updated_at timestamp with time zone, _set_actual_start boolean, _actual_start_date date, _set_actual_end boolean, _actual_end_date date, _status pm_status, _correlation_id text, _idempotency_key text)
apply_task_planning_change(_task_id uuid, _new_start date, _new_due date, _confirm_parent_extension boolean)
apply_task_stakeholder_roles_set(_task_id uuid, _expected_updated_at timestamp with time zone, _requester_stakeholder_id uuid, _executor_stakeholder_ids uuid[], _correlation_id text, _idempotency_key text)
apply_task_update(_task_id uuid, _expected_updated_at timestamp with time zone, _name text, _description text, _status pm_status, _priority pm_priority, _task_type task_type, _estimated_hours numeric, _correlation_id text, _idempotency_key text)
apply_workspace_binding_validation(_binding_id uuid, _status text, _site_id text, _library_id_or_drive_id text, _site_label_or_name text, _library_label_or_name text, _validation_code text, _validation_note text)
approve_project_baseline(_project_id uuid)
archive_adoption_initiative(_initiative_id uuid)
archive_adoption_template(_template_id uuid)
archive_ai_instruction_template(_id uuid)
archive_backlog_item(_id uuid)
archive_board_workflow_state(_id uuid)
archive_governance_cadence(_cadence_id uuid)
archive_governance_record(_record_id uuid)
archive_governance_record_btpm_context_link(_context_link_id uuid)
archive_governance_record_cross_project_link(_cross_project_link_id uuid)
archive_governance_record_evidence_file(_evidence_file_id uuid)
archive_governance_record_evidence_reference(_evidence_id uuid)
archive_kpi_definition(_id uuid)
archive_phase(_id uuid)
archive_program(_id uuid)
archive_project(_id uuid)
archive_project_benefit(_benefit_id uuid)
archive_project_people_preset(_preset_id uuid, _expected_updated_at timestamp with time zone, _correlation_id text, _idempotency_key text)
archive_project_template(_id uuid)
archive_roadmap_story_pack(_story_pack_id uuid)
archive_roadmap_story_presentation_version(_version_id uuid)
archive_sprint(_id uuid)
archive_task(_id uuid)
assert_environment_action_allowed(_organization_id uuid, _action text, _reason text)
assign_project_portfolio(_project_id uuid, _portfolio_item_id uuid)
attach_roadmap_story_run_source_snapshot(_run_id uuid, _source_snapshot_json text)
auto_accept_pending_invitations(_user_id uuid)
bootstrap_organization(_name text, _slug text)
bootstrap_organization_for_tenant(_tenant_id uuid, _name text, _slug text, _organization_kind organization_kind, _environment_role environment_role)
btpm_check_entity_schedule(_type text, _id uuid, _new_start date, _new_end date)
btpm_get_entity_dates(_type text, _id uuid)
bulk_set_powerbi_workspace_scope(_organization_id uuid, _workspace_ids uuid[], _scope_mode text, _reason text)
can_capture_kpi_snapshot(_kpi_definition_id uuid)
can_read_demo_or_member(_user_id uuid, _workspace_id uuid)
can_read_profile(_target_user_id uuid)
can_read_project(_user_id uuid, _project_id uuid)
can_read_project_by_target(_user_id uuid, _target_type text, _target_id uuid)
can_read_project_or_demo(_user_id uuid, _project_id uuid)
can_view_roadmap_story_presentation_version(_version_id uuid, _user_id uuid)
can_write_demo(_user_id uuid, _workspace_id uuid)
claim_next_tenant_background_job(_tenant_id uuid, _job_types text[])
clone_phase_in_project(_phase_id uuid, _new_phase_name text, _phase_start_date date, _confirm_widening boolean)
clone_task_in_phase(_task_id uuid, _new_task_name text, _task_start_date date, _confirm_widening boolean)
close_governance_decision_case(_record_id uuid, _closure_note text)
commit_btpm_import_v1_core(_organization_id uuid, _workspace_id uuid, _dry_run_batch_id uuid, _payload jsonb, _payload_hash text)
complete_roadmap_story_generation_run(_run_id uuid, _story_json text, _source_snapshot_json text, _source_manifest jsonb, _model_metadata jsonb, _prompt_tokens integer, _completion_tokens integer, _total_tokens integer, _raw_output_text text)
complete_roadmap_story_presentation_run(_run_id uuid, _raw_output_text text, _parsed_blueprint_json text, _validation_json text, _is_valid boolean, _model_metadata jsonb, _prompt_tokens integer, _completion_tokens integer, _total_tokens integer)
complete_tenant_background_job(_job_id uuid, _result jsonb)
complete_tenant_scheduler_run(_run_id uuid, _status text, _jobs_enqueued integer, _error text)
create_adoption_initiative(_adoption_plan_id uuid, _name text, _readiness_area adoption_readiness_area, _owner_id uuid, _status adoption_initiative_status, _priority pm_priority, _target_date date, _summary text, _sort_order integer)
create_adoption_template_from_payload(_workspace_id uuid, _name text, _description text, _payload jsonb)
create_ai_instruction_template_version(_feature_key text, _title text, _instruction_text text, _notes text)
create_blank_project(_name text, _workspace_id uuid, _program_id uuid, _delivery_model project_delivery_model)
create_blocker_with_links(_title text, _description text, _severity text, _target_type text, _target_id uuid, _organization_id uuid, _workspace_id uuid, _user_links jsonb, _object_links jsonb)
create_blocker_with_links(_title text, _description text, _severity text, _target_type text, _target_id uuid, _organization_id uuid, _workspace_id uuid, _user_links jsonb, _object_links jsonb, _status text)
create_comment_with_references(_body text, _target_type text, _target_id uuid, _organization_id uuid, _workspace_id uuid, _references jsonb)
create_dependency(_source_type text, _source_id uuid, _target_type text, _target_id uuid, _correlation_id text, _idempotency_key text)
create_governance_cadence(_project_id uuid, _event_type text, _frequency_type text, _event_name text, _owner_id uuid, _next_expected_date date, _expected_evidence_type text)
create_governance_cadence(_project_id uuid, _event_type text, _frequency_type text, _event_name text, _owner_id uuid, _next_expected_date date, _expected_evidence_type text, _owner_stakeholder_id uuid)
create_governance_record_brief_version(_record_id uuid, _source_type text, _raw_copilot_output text, _edited_brief_text text, _executive_intro_text text, _options_summary text, _recommendation_text text, _guardrails_text text, _residual_risks_text text, _requested_decision_text text, _make_current boolean)
create_governance_record_btpm_context_link(_record_id uuid, _source_project_id uuid, _object_type text, _object_id uuid, _relationship_type text, _context_reason text, _relevance_level text, _included_in_package boolean)
create_governance_record_cross_project_link(_record_id uuid, _linked_project_id uuid, _relationship_type text, _relationship_reason text, _source_dependency_id uuid, _included_in_package boolean)
create_governance_record_evidence_reference(_record_id uuid, _evidence_type text, _title text, _external_url text, _summary text, _evidence_date date, _owner_stakeholder_id uuid, _relevance_level text, _included_in_package boolean)
create_governance_record_stakeholder_package(_record_id uuid, _package_title text, _package_status text, _audience_text text, _executive_summary text, _decision_question_text text, _background_context text, _options_summary text, _recommendation_text text, _decision_ask_text text, _evidence_summary text, _guardrails_text text, _residual_risks_text text, _next_steps_text text, _distribution_note text, _distribution_evidence_url text, _make_current boolean)
create_project_adoption_plan(_project_id uuid, _objective text, _adoption_owner_id uuid, _impacted_audience_summary text, _approach_summary text, _readiness_status adoption_readiness_status, _created_from_template boolean)
create_project_benefit(_project_id uuid, _benefit_type text, _metric_name text, _unit_of_measure text, _target_value numeric, _realization_status text, _custom_benefit_type_label text, _description text, _baseline_value numeric, _actual_value numeric, _benefit_owner_id uuid, _expected_realization_date date, _actual_realization_date date, _evidence_note text)
create_risk_with_links(_title text, _description text, _mitigation_plan text, _likelihood text, _impact text, _status text, _target_type text, _target_id uuid, _organization_id uuid, _workspace_id uuid, _user_links jsonb, _object_links jsonb)
create_roadmap_story_pack(_title text, _guidance text, _audience text, _focus text, _primary_workspace_id uuid, _program_id uuid, _scope_config jsonb, _source_config jsonb)
create_workspace(_name text, _description text)
create_workspace_in_organization(_organization_id uuid, _name text, _description text)
deactivate_workspace(_workspace_id uuid)
delete_roadmap_story_pack_note(_note_id uuid)
delete_user_saved_view(_id uuid)
disable_sharepoint_project_binding(_binding_id uuid)
disable_sharepoint_workspace_binding(_binding_id uuid)
enqueue_tenant_background_job(_tenant_id uuid, _job_type text, _payload jsonb, _organization_id uuid, _workspace_id uuid, _priority integer, _idempotency_key text, _max_attempts integer, _not_before timestamp with time zone, _run_as_user_id uuid)
ensure_user_profile()
fail_roadmap_story_generation_run(_run_id uuid, _error_text text)
fail_roadmap_story_presentation_run(_run_id uuid, _error_text text)
fail_tenant_background_job(_job_id uuid, _error text, _dead_letter boolean)
generate_project_adoption_plan_from_saved_template(_project_id uuid, _template_id uuid, _template_key text, _phase_name text, _phase_start_date date, _phase_end_date date, _selection jsonb)
generate_project_adoption_plan_from_template(_project_id uuid, _create_phase boolean, _phase_name text, _selection jsonb, _phase_start_date date, _phase_end_date date)
get_accessible_roadmap_story_published_versions(_query text, _limit integer)
get_active_ai_instruction_template(_feature_key text)
get_admin_user_detail(_organization_id uuid, _user_id uuid)
get_ai_feature_settings()
get_comment_mention_email_status(_target_type text, _target_id uuid)
get_decrypted_knowledge_article(_id uuid)
get_decrypted_phase(_phase_id uuid)
get_decrypted_project(_project_id uuid)
get_decrypted_project_closure_summary(_project_id uuid)
get_decrypted_project_lessons_learned_document(_project_id uuid)
get_decrypted_task(_task_id uuid)
get_decrypted_workspace(_workspace_id uuid)
get_environment_safety_profile(_organization_id uuid)
get_governance_decision_case_project_summary(_record_id uuid)
get_governance_record_decision_outcome(_record_id uuid)
get_governance_record_detail(_record_id uuid)
get_latest_manual_kpi_value(_kpi_definition_id uuid)
get_latest_roadmap_story_pack_version_content(_story_pack_id uuid)
get_latest_roadmap_story_presentation_blueprint(_story_pack_id uuid)
get_my_active_context()
get_my_admin_access_summary()
get_org_user_display_name(_user_id uuid)
get_org_users_list(_organization_id uuid)
get_organization_tenant_id(_organization_id uuid)
get_portfolio_benefits_realization(_workspace_ids uuid[], _program_ids uuid[], _project_ids uuid[], _project_statuses text[], _project_manager_ids uuid[], _benefit_types text[], _realization_statuses text[], _expected_from date, _expected_to date, _include_archived boolean, _portfolio_item_ids uuid[], _include_no_portfolio boolean)
get_portfolio_item_project_membership_summary(_portfolio_item_id uuid, _include_archived_projects boolean)
get_powerbi_data_scope(_organization_id uuid)
get_powerbi_effective_scope(_organization_id uuid)
get_project_governance_summary(_project_id uuid)
get_project_people_preset(_preset_id uuid)
get_project_template_detail(_template_id uuid)
get_roadmap_story_pack_ai_run_status(_run_id uuid)
get_roadmap_story_pack_config(_story_pack_id uuid)
get_roadmap_story_pack_version_debug(_version_id uuid)
get_roadmap_story_pack_visual_settings(_story_pack_id uuid)
get_roadmap_story_presentation_debug(_run_id uuid)
get_roadmap_story_presentation_run_status(_run_id uuid)
get_roadmap_story_presentation_version_access_scope(_version_id uuid)
get_roadmap_story_presentation_version_for_view(_version_id uuid)
get_roadmap_story_presentation_versions(_story_pack_id uuid)
get_sharepoint_org_site(_organization_id uuid)
get_sharepoint_project_binding(_project_id uuid)
get_sharepoint_workspace_binding(_workspace_id uuid)
get_team_work_overview(_workspace_id uuid, _program_id uuid, _project_id uuid, _assignee_id uuid, _time_window text, _include_completed boolean, _workspace_ids uuid[], _portfolio_item_ids uuid[])
get_tenant_protected_download_context(_storage_object_id uuid)
get_user_org_id(_user_id uuid)
hard_delete_backlog_item(_id uuid)
hard_delete_board_workflow_state(_id uuid)
hard_delete_governance_cadence(_cadence_id uuid)
hard_delete_governance_record(_record_id uuid)
hard_delete_kpi_definition(_id uuid)
hard_delete_phase(_id uuid)
hard_delete_program(_id uuid)
hard_delete_project(_id uuid)
hard_delete_project_template(_id uuid)
hard_delete_sprint(_id uuid)
hard_delete_task(_id uuid)
has_pm_authority(_user_id uuid, _workspace_id uuid)
has_project_access(_user_id uuid, _project_id uuid)
has_project_access_by_kpi_def(_user_id uuid, _kpi_definition_id uuid)
has_project_access_by_target(_user_id uuid, _target_type text, _target_id uuid)
has_project_pm_authority(_user_id uuid, _project_id uuid)
has_project_pm_authority_by_kpi_def(_user_id uuid, _kpi_definition_id uuid)
has_project_pm_authority_by_target(_user_id uuid, _target_type text, _target_id uuid)
has_project_role(_user_id uuid, _project_id uuid, _role project_role)
has_workspace_role(_user_id uuid, _workspace_id uuid, _role app_role)
instantiate_project_from_template(_template_id uuid, _new_project_name text, _program_id uuid, _project_start_date date, _confirm_widening boolean, _delivery_model project_delivery_model)
is_active_user(_user_id uuid)
is_decision_cases_ai_enabled()
is_demo_workspace(_workspace_id uuid)
is_org_admin(_user_id uuid, _organization_id uuid)
is_org_member(_user_id uuid, _organization_id uuid)
is_organization_admin(_organization_id uuid, _user_id uuid)
is_organization_member(_organization_id uuid, _user_id uuid)
is_platform_super_admin(_user_id uuid)
is_story_pack_owner(_user_id uuid, _story_pack_id uuid)
is_tenant_admin(_tenant_id uuid, _user_id uuid)
is_tenant_member(_tenant_id uuid, _user_id uuid)
is_tenant_owner(_tenant_id uuid, _user_id uuid)
is_user_org_admin(_user_id uuid, _organization_id uuid)
is_user_org_member(_user_id uuid, _organization_id uuid)
is_user_workspace_member(_user_id uuid, _workspace_id uuid)
is_workspace_admin_or_higher(_user_id uuid, _workspace_id uuid)
is_workspace_member(_user_id uuid, _workspace_id uuid)
kc_admin_archive_article(_id uuid)
kc_admin_create_article(_category_id uuid, _title text, _slug text, _article_type knowledge_article_type, _summary text, _body text, _tooltip_excerpt text, _visibility knowledge_article_visibility, _related_route text, _related_object_type text, _related_object_id uuid, _workspace_id uuid, _owner_id uuid)
kc_admin_create_category(_name text, _slug text, _description text, _sort_order integer)
kc_admin_publish_article(_id uuid)
kc_admin_unarchive_article(_id uuid)
kc_admin_update_article(_id uuid, _category_id uuid, _title text, _slug text, _article_type knowledge_article_type, _summary text, _body text, _tooltip_excerpt text, _visibility knowledge_article_visibility, _related_route text, _related_object_type text, _related_object_id uuid, _workspace_id uuid, _owner_id uuid)
kc_admin_update_category(_id uuid, _name text, _slug text, _description text, _sort_order integer, _is_active boolean)
kpi_scheduler_diagnostics()
link_adoption_object(_adoption_plan_id uuid, _object_type text, _object_id uuid, _adoption_initiative_id uuid)
link_task_to_adoption(_task_id uuid, _adoption_initiative_id uuid)
list_active_portfolio_items_for_project_picker(_project_id uuid)
list_active_portfolio_items_for_workspace_picker(_workspace_id uuid)
list_adoption_templates(_workspace_id uuid)
list_ai_instruction_templates(_feature_key text)
list_ai_model_registry()
list_decision_case_ai_runs(_record_id uuid)
list_decrypted_backlog_items(_project_id uuid)
list_decrypted_comments(_target_type text, _target_id uuid)
list_decrypted_knowledge_articles(_category_id uuid, _include_unpublished boolean)
list_decrypted_knowledge_categories()
list_decrypted_kpi_definitions(_project_id uuid)
list_decrypted_kpi_snapshots(_project_id uuid, _kpi_definition_id uuid)
list_decrypted_kpi_updates(_kpi_definition_id uuid)
list_decrypted_project_benefits(_project_id uuid, _include_archived boolean)
list_decrypted_project_phases(_project_id uuid)
list_decrypted_project_tasks(_project_id uuid)
list_decrypted_project_team(_project_id uuid)
list_decrypted_risks(_target_id uuid, _target_type text)
list_decrypted_sprints(_project_id uuid)
list_decrypted_workflow_states(_project_id uuid)
list_entity_dependencies(_entity_type text, _entity_id uuid)
list_entity_links(_owner_type text, _owner_ids uuid[])
list_generated_decision_case_documents(_record_id uuid, _document_type generated_doc_type)
list_governance_record_brief_versions(_record_id uuid)
list_governance_record_btpm_context_links(_record_id uuid, _include_archived boolean)
list_governance_record_copilot_data_packages(_record_id uuid)
list_governance_record_cross_project_links(_record_id uuid, _include_archived boolean)
list_governance_record_evidence_files(_record_id uuid, _include_archived boolean)
list_governance_record_evidence_references(_record_id uuid, _include_archived boolean)
list_governance_record_stakeholder_packages(_record_id uuid)
list_knowledge_article_ai_metadata_for_visible_articles(_article_ids uuid[])
list_my_organizations_for_tenant(_tenant_id uuid)
list_my_tenants()
list_my_workspaces_for_organization(_organization_id uuid)
list_project_activity_events(_project_id uuid)
list_project_adoption_reporting_summaries(_workspace_id uuid, _project_ids uuid[])
list_project_adoption_substrate(_project_id uuid)
list_project_all_blockers(_project_id uuid)
list_project_all_risks(_project_id uuid)
list_project_governance_cadences(_project_id uuid, _include_archived boolean)
list_project_governance_records(_project_id uuid, _include_archived boolean)
list_project_people_presets(_workspace_id uuid, _include_archived boolean)
list_project_raci(_project_id uuid)
list_project_reporting_summaries(_workspace_id uuid, _project_ids uuid[], _include_demo boolean)
list_project_stakeholders(_project_id uuid)
list_project_templates(_workspace_id uuid, _include_archived boolean)
list_roadmap_calendar_markers(_project_ids uuid[])
list_roadmap_story_pack_included_files(_story_pack_id uuid)
list_roadmap_story_packs(_include_archived boolean)
list_sharepoint_workspace_bindings(_organization_id uuid)
list_user_saved_views(_surface_key text, _scope_key text)
list_user_workspaces()
list_workspace_projects(_workspace_id uuid, _include_archived boolean)
mark_decision_case_ai_run_discarded(_ai_run_id uuid)
mark_governance_record_copilot_data_package_downloaded(_package_id uuid)
mark_governance_record_stakeholder_package_provided(_package_id uuid, _distribution_note text, _distribution_evidence_url text)
move_task_workflow_state(_task_id uuid, _workflow_state_id uuid)
org_admin_assign_org_admin(_organization_id uuid, _target_user_id uuid, _reason text)
org_admin_list_org_admin_candidates(_organization_id uuid, _query text)
org_admin_list_org_admins(_organization_id uuid)
org_admin_list_org_authority_audit(_organization_id uuid, _limit integer)
org_admin_remove_org_admin(_organization_id uuid, _target_user_id uuid, _reason text)
pa_can_admin_workspace(_workspace_id uuid)
pa_grant_all_workspace_projects(_target_user_id uuid, _workspace_id uuid, _override_role project_role)
pa_grant_project_access(_target_user_id uuid, _project_id uuid, _role project_role)
pa_list_user_workspace_projects(_target_user_id uuid, _workspace_id uuid)
pa_map_workspace_role_to_project_role(_ws_role text)
pa_remove_project_access(_target_user_id uuid, _project_id uuid)
pa_reset_workspace_to_inherited(_target_user_id uuid, _workspace_id uuid)
pa_workspace_project_access_counts(_workspace_id uuid)
platform_admin_assign_tenant_admin(_tenant_id uuid, _target_user_id uuid, _reason text)
platform_admin_get_encryption_posture_overview()
platform_admin_get_overview(_reason text)
platform_admin_list_tenant_admin_candidates(_tenant_id uuid, _query text)
platform_admin_list_tenant_admins(_tenant_id uuid)
platform_admin_list_tenant_authority_audit(_tenant_id uuid, _limit integer)
platform_admin_list_tenants(_reason text)
platform_admin_remove_tenant_admin(_tenant_id uuid, _target_user_id uuid, _reason text)
preview_adoption_template(_workspace_id uuid, _template_id uuid, _template_key text)
preview_phase_clone_blueprint(_phase_id uuid)
preview_phase_clone_in_project(_phase_id uuid, _phase_start_date date)
preview_phase_planning_change(_phase_id uuid, _new_start date, _new_end date)
preview_phase_timeline_action(_phase_id uuid, _action text, _new_start date, _new_end date)
preview_project_adoption_template(_project_id uuid)
preview_project_clone_blueprint(_project_id uuid)
preview_project_people_preset_application(_preset_id uuid, _project_id uuid)
preview_project_planning_change(_project_id uuid, _new_start date, _new_end date)
preview_project_template_instantiation(_template_id uuid, _project_start_date date, _program_id uuid)
preview_task_clone_blueprint(_task_id uuid)
preview_task_clone_in_phase(_task_id uuid, _task_start_date date)
preview_task_planning_change(_task_id uuid, _new_phase_id uuid, _new_start date, _new_due date)
publish_roadmap_story_presentation_version(_story_pack_id uuid, _story_pack_version_id uuid, _presentation_blueprint_run_id uuid, _title text, _snapshot_json text, _source_limitations_json text, _source_mode text, _publish_warnings jsonb)
reactivate_workspace(_workspace_id uuid)
rebaseline_project(_project_id uuid)
record_generated_decision_case_document(_record_id uuid, _document_type generated_doc_type, _generation_status generated_doc_status, _output_filename text, _source_snapshot_at timestamp with time zone, _publish_status generated_doc_publish_status, _sharepoint_item_id text, _sharepoint_web_url text, _error_note text)
record_generated_operational_document(_project_id uuid, _document_type generated_doc_type, _generation_status generated_doc_status, _output_filename text, _source_snapshot_at timestamp with time zone, _error_note text)
record_generated_operational_document(_project_id uuid, _document_type generated_doc_type, _generation_status generated_doc_status, _output_filename text, _source_snapshot_at timestamp with time zone, _publish_status generated_doc_publish_status, _sharepoint_item_id text, _sharepoint_web_url text, _error_note text)
record_roadmap_story_run_files(_run_id uuid, _files jsonb)
register_tenant_storage_object(_tenant_id uuid, _organization_id uuid, _workspace_id uuid, _bucket text, _surface text, _object_type text, _object_id uuid, _file_name text, _content_type text, _size_bytes bigint, _checksum text, _metadata jsonb, _legacy_object_path text)
remove_dependency(_dependency_id uuid, _expected_updated_at timestamp with time zone, _correlation_id text, _idempotency_key text)
remove_project_people_preset_member(_member_id uuid, _expected_preset_updated_at timestamp with time zone, _correlation_id text, _idempotency_key text)
remove_project_stakeholder(_stakeholder_id uuid)
remove_roadmap_story_pack_external_file(_file_id uuid)
rename_project_people_preset(_preset_id uuid, _name text, _description text, _expected_updated_at timestamp with time zone, _correlation_id text, _idempotency_key text)
reopen_phase(_phase_id uuid)
reopen_task(_task_id uuid)
reorder_backlog_items(_project_id uuid, _rows jsonb, _correlation_id text, _idempotency_key text)
reorder_phases(_project_id uuid, _rows jsonb, _correlation_id text, _idempotency_key text)
reorder_tasks(_phase_id uuid, _rows jsonb, _correlation_id text, _idempotency_key text)
report_governance_cadences(_organization_id uuid, _workspace_id uuid, _project_ids uuid[], _include_archived boolean)
report_governance_event_types(_organization_id uuid, _workspace_id uuid, _project_ids uuid[])
report_governance_records(_organization_id uuid, _workspace_id uuid, _project_ids uuid[], _include_archived boolean)
report_project_governance_summary(_organization_id uuid, _workspace_id uuid, _project_ids uuid[])
reset_kpi_app_outbox(_outbox_id uuid, _reason text)
resolve_child_project_scope(_table text, _target_type text, _target_id uuid, _project_id_direct uuid)
resolve_effective_integration_secret_ref(_tenant_id uuid, _organization_id uuid, _integration_kind tenant_integration_kind, _secret_name text, _integration_name text, _reason text, _function_name text, _request_id text)
resolve_project_id(_target_type text, _target_id uuid)
resolve_project_id_from_governance_cadence(_cadence_id uuid)
resolve_project_id_from_governance_record(_record_id uuid)
resolve_project_id_from_sharepoint_project_binding(_binding_id uuid)
resolve_route_context_boundary(_workspace_id uuid, _project_id uuid, _program_id uuid, _phase_id uuid, _task_id uuid)
resolve_sharepoint_project_binding(_project_id uuid)
restore_governance_cadence(_cadence_id uuid)
restore_governance_record(_record_id uuid)
restore_governance_record_btpm_context_link(_context_link_id uuid)
restore_governance_record_cross_project_link(_cross_project_link_id uuid)
restore_governance_record_evidence_file(_evidence_file_id uuid)
restore_governance_record_evidence_reference(_evidence_id uuid)
restore_project_people_preset(_preset_id uuid, _expected_updated_at timestamp with time zone, _correlation_id text, _idempotency_key text)
restore_project_stakeholder(_stakeholder_id uuid)
save_ai_decision_brief_version(_record_id uuid, _ai_run_id uuid, _edited_brief_text text, _make_current boolean)
save_ai_decision_brief_version_v2(_record_id uuid, _ai_run_id uuid, _edited_brief_text text, _make_current boolean, _recommendation_text text, _requested_decision_text text, _guardrails_text text, _residual_risks_text text, _open_questions_text text, _confidence_level text, _decision_readiness text)
save_decision_brief_version_v3(_record_id uuid, _source_type text, _edited_brief_text text, _make_current boolean, _ai_run_id uuid, _executive_intro_text text, _options_summary text, _requested_decision_text text, _recommendation_text text, _guardrails_text text, _residual_risks_text text, _open_questions_text text, _confidence_level text, _decision_readiness text)
save_project_people_preset_from_project(_project_id uuid, _name text, _description text, _correlation_id text, _idempotency_key text)
save_project_template_from_project(_project_id uuid, _template_name text, _template_description text)
search_workspace_project_deep_matches(_workspace_id uuid, _query text, _include_archived boolean)
search_workspace_reference_targets(_workspace_id uuid, _query text)
service_enqueue_tenant_background_job(_tenant_id uuid, _job_type text, _payload jsonb, _organization_id uuid, _workspace_id uuid, _priority integer, _idempotency_key text, _max_attempts integer, _not_before timestamp with time zone, _requested_by uuid, _run_as_user_id uuid)
service_get_tenant_protected_download_context(_storage_object_id uuid, _requested_by uuid)
service_register_tenant_storage_object(_tenant_id uuid, _organization_id uuid, _bucket text, _surface text, _object_type text, _file_name text, _workspace_id uuid, _object_id uuid, _content_type text, _size_bytes bigint, _checksum text, _metadata jsonb, _legacy_object_path text, _created_by uuid)
set_current_governance_record_brief_version(_brief_version_id uuid)
set_current_governance_record_copilot_data_package(_package_id uuid)
set_current_governance_record_stakeholder_package(_package_id uuid)
set_governance_record_decisions(_record_id uuid, _decisions jsonb)
set_governance_record_links(_record_id uuid, _links jsonb)
set_my_active_context(_tenant_id uuid, _organization_id uuid, _workspace_id uuid, _is_all_workspaces boolean)
set_powerbi_workspace_scope(_organization_id uuid, _workspace_id uuid, _scope_mode text, _reason text)
set_project_template_archived(_template_id uuid, _is_archived boolean)
set_roadmap_story_pack_sources(_story_pack_id uuid, _sources jsonb)
set_roadmap_story_presentation_run_response_id(_run_id uuid, _openai_response_id text)
set_roadmap_story_run_response_id(_run_id uuid, _openai_response_id text, _files_selected_count integer, _files_sent_count integer, _files_skipped_count integer, _total_bytes_sent bigint)
start_roadmap_story_generation_run(_story_pack_id uuid, _provider text, _model text, _reasoning_effort text, _input_manifest jsonb, _prompt_summary text)
start_roadmap_story_presentation_run(_story_pack_id uuid, _story_pack_version_id uuid, _provider text, _model text, _reasoning_effort text, _input_manifest jsonb, _prompt text, _input_package_json text)
start_tenant_scheduler_run(_tenant_id uuid, _scheduler_name text, _metadata jsonb)
tenant_admin_assign_org_admin(_organization_id uuid, _target_user_id uuid, _reason text)
tenant_admin_disable_integration_secret(_integration_id uuid, _secret_name text, _organization_id uuid, _reason text)
tenant_admin_get_azure_openai_deployments(_integration_id uuid)
tenant_admin_get_azure_openai_endpoint(_integration_id uuid)
tenant_admin_get_encryption_posture(_tenant_id uuid)
tenant_admin_get_integration_detail(_integration_id uuid)
tenant_admin_get_organization_detail(_organization_id uuid)
tenant_admin_get_organization_encryption_posture(_organization_id uuid)
tenant_admin_get_powerbi_reporting_readiness(_tenant_id uuid)
tenant_admin_list_integration_secret_metadata(_integration_id uuid, _organization_id uuid)
tenant_admin_list_org_admin_candidates(_organization_id uuid, _query text)
tenant_admin_list_org_admins(_organization_id uuid)
tenant_admin_list_org_authority_audit(_organization_id uuid, _limit integer)
tenant_admin_remove_org_admin(_organization_id uuid, _target_user_id uuid, _reason text)
tenant_admin_set_integration_enabled(_integration_id uuid, _is_enabled boolean, _reason text)
tenant_admin_store_integration_secret(_integration_id uuid, _secret_name text, _secret_value text, _secret_kind text, _organization_id uuid, _reason text)
tenant_admin_update_azure_openai_deployments(_integration_id uuid, _deployments jsonb, _reason text)
tenant_admin_update_azure_openai_endpoint(_integration_id uuid, _endpoint text, _reason text)
toggle_project_agile_mode(_project_id uuid, _enable boolean)
transition_governance_decision_case_stage(_record_id uuid, _target_stage text)
transition_project_stage(_project_id uuid, _project_stage project_stage)
unarchive_backlog_item(_id uuid)
unarchive_board_workflow_state(_id uuid)
unarchive_kpi_definition(_id uuid)
unarchive_phase(_id uuid)
unarchive_program(_id uuid)
unarchive_project(_id uuid)
unarchive_project_template(_id uuid)
unarchive_roadmap_story_pack(_story_pack_id uuid)
unarchive_sprint(_id uuid)
unarchive_task(_id uuid)
unlink_adoption_object(_link_id uuid)
unlink_task_from_adoption(_task_id uuid)
update_adoption_initiative(_initiative_id uuid, _name text, _owner_id uuid, _status adoption_initiative_status, _priority pm_priority, _target_date date, _summary text, _sort_order integer, _set_name boolean, _set_owner boolean, _set_target_date boolean, _set_summary boolean)
update_adoption_template_from_payload(_template_id uuid, _name text, _description text, _payload jsonb)
update_ai_feature_setting(_feature_key text, _model_registry_id uuid, _enabled boolean, _reasoning_effort text, _max_files_per_request integer, _max_individual_file_mb integer, _max_total_file_mb integer, _require_user_confirmation boolean)
update_blocker_with_links(_blocker_id uuid, _title text, _description text, _severity text, _status text, _user_links jsonb, _object_links jsonb)
update_comment_with_references(_comment_id uuid, _body text, _references jsonb)
update_governance_cadence(_cadence_id uuid, _event_type text, _frequency_type text, _event_name text, _owner_id uuid, _next_expected_date date, _expected_evidence_type text, _clear_event_name boolean, _clear_owner boolean, _clear_next_expected_date boolean, _clear_expected_evidence_type boolean)
update_governance_cadence(_cadence_id uuid, _event_type text, _frequency_type text, _event_name text, _owner_id uuid, _next_expected_date date, _expected_evidence_type text, _clear_event_name boolean, _clear_owner boolean, _clear_next_expected_date boolean, _clear_expected_evidence_type boolean, _owner_stakeholder_id uuid, _clear_owner_stakeholder boolean)
update_governance_record_btpm_context_link(_context_link_id uuid, _source_project_id uuid, _object_type text, _object_id uuid, _relationship_type text, _context_reason text, _relevance_level text, _included_in_package boolean, _clear_context_reason boolean)
update_governance_record_cross_project_link(_cross_project_link_id uuid, _linked_project_id uuid, _relationship_type text, _relationship_reason text, _source_dependency_id uuid, _included_in_package boolean, _clear_relationship_reason boolean, _clear_source_dependency_id boolean)
update_governance_record_evidence_file(_evidence_file_id uuid, _evidence_title text, _evidence_summary text, _evidence_date date, _relevance_level text, _included_in_package boolean, _clear_evidence_summary boolean)
update_governance_record_evidence_reference(_evidence_id uuid, _evidence_type text, _title text, _external_url text, _summary text, _evidence_date date, _owner_stakeholder_id uuid, _relevance_level text, _included_in_package boolean, _clear_summary boolean, _clear_evidence_date boolean, _clear_owner_stakeholder_id boolean)
update_project_adoption_plan(_adoption_plan_id uuid, _objective text, _adoption_owner_id uuid, _impacted_audience_summary text, _approach_summary text, _readiness_status adoption_readiness_status, _enabled boolean, _set_owner boolean, _set_objective boolean, _set_audience boolean, _set_approach boolean)
update_project_benefit(_benefit_id uuid, _benefit_type text, _metric_name text, _unit_of_measure text, _target_value numeric, _realization_status text, _custom_benefit_type_label text, _clear_custom_benefit_type_label boolean, _description text, _clear_description boolean, _baseline_value numeric, _clear_baseline_value boolean, _actual_value numeric, _clear_actual_value boolean, _benefit_owner_id uuid, _clear_benefit_owner_id boolean, _expected_realization_date date, _clear_expected_realization_date boolean, _actual_realization_date date, _clear_actual_realization_date boolean, _evidence_note text, _clear_evidence_note boolean)
update_project_people_preset_member(_member_id uuid, _expected_preset_updated_at timestamp with time zone, _canonical_role_key text, _role_label text, _external_name text, _correlation_id text, _idempotency_key text)
update_project_stakeholder(_stakeholder_id uuid, _role_label text, _external_name text, _notes text, _start_date date)
update_project_template_metadata(_template_id uuid, _name text, _description text)
update_risk_with_links(_risk_id uuid, _title text, _description text, _mitigation_plan text, _likelihood text, _impact text, _status text, _user_links jsonb, _object_links jsonb)
update_roadmap_story_pack_config(_story_pack_id uuid, _title text, _guidance text, _audience text, _focus text, _primary_workspace_id uuid, _program_id uuid, _scope_config jsonb, _source_config jsonb, _patch_title boolean, _patch_guidance boolean, _patch_audience boolean, _patch_focus boolean, _patch_primary_workspace boolean, _patch_program boolean)
update_roadmap_story_pack_external_file(_file_id uuid, _display_name text, _web_url text, _user_note text, _mime_type text, _size_bytes bigint, _include_in_story boolean, _patch_display_name boolean, _patch_web_url boolean, _patch_user_note boolean, _patch_mime_type boolean, _patch_size_bytes boolean, _patch_include_in_story boolean)
update_roadmap_story_pack_note(_note_id uuid, _body text, _label text, _include_in_story boolean, _sort_order integer, _patch_body boolean, _patch_label boolean, _patch_include boolean, _patch_sort boolean)
update_roadmap_story_pack_visual_settings(_story_pack_id uuid, _settings jsonb)
upsert_governance_record_decision_outcome(_record_id uuid, _decision_result text, _final_decision_text text, _decision_date date, _decided_by_text text, _approval_forum text, _decision_rationale text, _conditions_guardrails text, _residual_risks text, _follow_up_actions text, _implementation_owner_stakeholder_id uuid, _implementation_target_date date, _signoff_status text, _signoff_evidence_url text)
upsert_project_closure_summary(_project_id uuid, _outcome_summary text, _benefits_summary text, _achievements_summary text, _open_items_summary text, _transition_notes text)
upsert_project_lessons_learned_document_metadata(_project_id uuid, _status text, _document_name text, _sharepoint_web_url text, _sharepoint_drive_id text, _sharepoint_item_id text, _created_in_sharepoint_at timestamp with time zone, _last_modified_at timestamp with time zone, _event_type text)
upsert_sharepoint_project_binding(_project_id uuid, _binding_mode sharepoint_project_binding_mode, _folder_web_url text, _folder_relative_path text, _folder_item_id text, _resolved_site_web_url text, _resolved_site_id text, _resolved_library_web_url text, _resolved_library_id_or_drive_id text)
upsert_sharepoint_workspace_binding(_workspace_id uuid, _site_web_url text, _library_web_url text, _site_label_or_name text, _library_label_or_name text, _site_id text, _library_id_or_drive_id text, _managed_outside_btpm boolean)
upsert_user_saved_view(_id uuid, _surface_key text, _scope_key text, _name text, _state jsonb)
validate_project_completion(_project_id uuid)
validate_roadmap_story_scope(_user_id uuid, _org_id uuid, _scope jsonb)
validate_tenant_storage_access(_storage_object_id uuid, _action text)
ws_add_member(_workspace_id uuid, _target_user_id uuid, _role app_role)
ws_change_member_role(_workspace_id uuid, _target_user_id uuid, _new_role app_role)
ws_create_invitation(_workspace_id uuid, _email text, _role app_role)
ws_list_add_member_candidates(_workspace_id uuid)
ws_list_members(_workspace_id uuid)
ws_list_pending_invitations(_workspace_id uuid)
ws_remove_member(_workspace_id uuid, _target_user_id uuid)
```

```db-out-of-scope-control-plane
acknowledge_api_d_policy(_client_key text, _correlation_id text)
get_api_d_consent_context(_client_key text)
revoke_api_d_policy(_client_key text, _correlation_id text)
```

```db-helper-no-business-surface
_actual_rollup_allowed()
_btpm_adoption_template_v1()
_clone_offset_days(_anchor date, _target date)
_gov_advance_next_expected_date(_base_date date, _frequency_type text, _actual_date_held date)
_gov_derive_cadence_status(_frequency_type text, _next_expected_date date, _archived_at timestamp with time zone, _due_soon_days integer)
_gov_frequency_next_date(_base_date date, _frequency_type text)
_is_allowed_tenant_integration_secret_name(_integration_kind tenant_integration_kind, _secret_name text)
_lifecycle_bypass_allowed()
_normalize_azure_openai_endpoint(_input text)
_pbi_assert_safe_metadata(_meta jsonb)
_planned_extension_allowed()
_sanitize_storage_segment(_input text)
_template_blueprint_summary(_blueprint jsonb)
btpm_fs_pair_conflict(_predecessor_end date, _successor_start date)
pmg_build_result(_status pmg_command_status, _command text, _target_type text, _target_id uuid, _project_id uuid, _data jsonb, _changes jsonb, _warnings jsonb, _confirmations jsonb, _conflict jsonb)
roadmap_story_allowed_source_categories()
```

## 7. Edge universe

Enumerated from the current tree under `supabase/functions/*/index.ts`
(excluding `_shared`). Universe count: **61**. Split:

- `requires_edge_gate`: **57**
- `out_of_scope_non_user_endpoint`: **4**

```edge-requires-gate
admin-delete-user
admin-users
ai-guide-v2-chat
ai-guide-v2-reindex
ai-guide-v2-smoke
ai-guide-v2-trace
ai-help-chat
azure-openai-test-connection
browse-governance-decision-sharepoint-files
btpm-import-commit
btpm-import-dry-run
build-kpi-app-payload
capture-kpi-snapshot
create-project-lessons-learned-document
evaluate-kpi-schedule-policies
export-kpi-automation-protocol
generate-decision-case-ai-brief
generate-decision-case-data-package
generate-decision-case-data-package-bundle
generate-decision-case-ppt-onepager
generate-decision-case-word-brief
generate-project-charter
generate-project-closure-report
generate-project-status-deck
generate-roadmap-status-deck
generate-roadmap-story
generate-roadmap-story-presentation
get-decision-case-data-package-bundle-download-url
get-kpi-app-system-email
invite-user
lifecycle-hard-delete
m365-ppt-readiness-check
microsoft-graph-test-connection
openai-test-connection
poll-decision-case-ai-brief
poll-roadmap-story
poll-roadmap-story-presentation
powerbi-reporting-credential-lifecycle
prepare-kpi-app-report-now
publish-roadmap-story-presentation
read-kpi-app-catalog
read-kpi-app-dimensions
reconcile-kpi-app-submission
redeem-invitations
refresh-project-lessons-learned-document-metadata
retry-kpi-app-submission
run-kpi-app-scheduler
run-kpi-snapshot-capture-scheduler
select-governance-decision-sharepoint-evidence-files
send-object-email
send-team-work-reminders
send-test-email
sharepoint-files
sharepoint-test-connection
sharepoint-validate
submit-kpi-app-payload
test-openai-decision-evidence-summary
```

```edge-out-of-scope-non-user
process-notifications
run-kpi-app-scheduler-cron
run-kpi-snapshot-capture-scheduler-cron
send-password-reset
```

User-session classification narrative:

- `ai-guide-v2-reindex`, `ai-guide-v2-smoke`, and `ai-guide-v2-trace`
  authenticate a human user, require Organization Admin authority, and
  use the browser-session-only OAuth denial guard. Their gateway
  `verify_jwt = false` setting is a deliberate ES256 accommodation and
  does not make them non-user endpoints; they belong in the
  browser/user-session set.

Non-user endpoint proofs (asserted at test time by inspecting the
current source files):

- `process-notifications` — worker-only endpoint protected by exact
  service-role bearer authentication. The handler compares the caller
  bearer to `SUPABASE_SERVICE_ROLE_KEY` via SHA-256 digest-based
  constant-time comparison before any service-role client construction
  or database work; ordinary browser/user JWTs are rejected.
- `run-kpi-app-scheduler-cron` and
  `run-kpi-snapshot-capture-scheduler-cron` — protected by shared
  scheduler-secret header check (`KPI_APP_SCHEDULER_SECRET` /
  `KPI_SNAPSHOT_SCHEDULER_SECRET`) and by `verify_jwt = false` in
  `supabase/config.toml`; they only forward to the orchestrator when
  their `..._ENABLED` gate is `true`.
- `send-password-reset` — service-role administered password-reset
  endpoint; no user session is used.


## 8. Release invariant (historical narrative)

**API-E.R1 normalization:** the previous requirement that
`src/release/releaseMetadata.generated.ts` remain permanently
byte-identical to the file at historical baseline commit `f0e83308`
has been retired. Release metadata is regenerated by the build on
every accepted change and is not an OAuth-containment security
invariant. The corresponding static assertions have been removed.

## 9. Correction file scope (historical narrative)

**API-E.R1 normalization:** the previous requirement that the diff
since correction base `11e1a85194bb6bac5da6cdf6ebdee79c83217324` be
restricted to a fixed correction-only file allowlist has been retired.
That allowlist was superseded by later approved API-E work and the
corresponding static assertion has been removed. The SHAs above are
retained only as historical narrative and are not current acceptance
invariants.


## API-E.C3 — Conservative exact overload resolution from call shape

Correction: the analyzer now resolves a call to an **exact snapshot signature** when the call's mechanically observable argument shape (arity, positional/named split, named-argument identity) uniquely identifies one candidate among a base name's overloads. Resolution remains fail-closed: any parsing failure, unbalanced call, unknown named argument, or same-shape ambiguity yields a `null` `resolved_signature` and a conservative `ambiguity_reason`.

### Methodology

- Argument lists are split on top-level commas with **both** parenthesis depth and square-bracket depth tracked (API-E.C3.1). Bracket tracking is required because array constructors (`ARRAY[1,2]`) and multidimensional array expressions (`ARRAY[[1,2],[3,4]]`) contain commas that belong to a single supplied argument; ignoring bracket depth would inflate argument counts and could resolve a call to the wrong overload. Splitting still runs on the C2 length-preservingly masked input, so brackets and commas inside comments or string / dollar-quoted literals are already replaced with spaces and cannot influence depth tracking. If either depth goes negative or is non-zero at end of input, the entire split is rejected and the call is classified `malformed_call_shape` (fail-closed).
- Whitespace-only argument slots (created by the length-preserving SQL masker replacing string / dollar-quoted literals) are counted as positional arguments.
- Candidate signatures are parsed from the corpus into `{ base_name, param_names[], param_count }` — no default-value evidence exists in identity signatures, so arity comparison is strict equality (`argument_count === param_count`).
- Named arguments (`name =>` / `name :=`) must map to a candidate parameter name; positional-after-named is rejected.
- No type inference, no implicit-cast reasoning, no ordering-based tie-break.

### C3 resolution counts (1,490 total call sites)

| Outcome | Count |
| --- | --- |
| Uniquely resolved via non-overloaded base name | 1,478 |
| Uniquely resolved via shape among overloads | 5 |
| Remaining unresolved | 7 |

### Bucket counts (unchanged from C2)

- `contained`: 26
- `requires_db_gate`: 519
- `out_of_scope_control_plane`: 3
- `helper_no_business_surface`: 16

No signatures transitioned between buckets under C3 — overload resolution refines call-site identity metadata without changing the classifier's conservative posture.

### New `CallSite` fields

- `shape_compatible_signatures: string[]` — candidates surviving shape filtering.
- `argument_count`, `positional_argument_count`, `named_argument_names` — mechanically parsed call-shape metadata.
- `ambiguity_reason` extended with: `unbalanced_call_expression`, `malformed_call_shape`, `no_shape_compatible_overload`, `multiple_shape_compatible_overloads`.

## API-E.C3.1 — Array-expression argument splitting correction

Correction: `splitTopLevelCommas` now tracks square-bracket depth alongside parenthesis depth so that commas inside `ARRAY[...]` and multidimensional array constructors are not treated as top-level argument separators. This removes a defect in the C3 analyzer that could inflate the observed argument count of a call whose supplied argument was an array expression, which in turn could resolve the call to the wrong overload (or force it into `no_shape_compatible_overload`).

The prior claim that "commas inside `ARRAY[...]` are not legal SQL" was **incorrect** and has been removed. Array constructors are ordinary SQL expressions whose element lists are comma-separated; the parser must treat those commas as internal to a single supplied argument.

### C3.1 fail-closed behavior

1. Every executable `[` increments square-bracket depth.
2. Every executable `]` decrements square-bracket depth.
3. If either depth goes negative at any point, or is non-zero at end of input, the split is rejected and the call is recorded as `malformed_call_shape`.
4. No guessing or recovery from malformed bracket structure.
5. Splitting continues to run on the C2 length-preservingly masked body, so brackets and commas inside comments or string / dollar-quoted literals remain invisible to depth tracking.

### C3.1 recomputation results (from the unchanged raw definition corpus)

- Call-site `argument_count` changes: 0
- Call-site `resolved_signature` changes: 0
- Call-site `ambiguity_reason` changes: 0
- Classification transitions: none
- `unresolved_ambiguities`: unchanged

No call in the 564-signature universe currently passes an array constructor to an overloaded base name, so the bracket-tracking correction does not shift any bucket assignment today. It closes a latent parser defect that would otherwise misclassify future calls of that shape.

### Bucket counts (unchanged from C2 / C3)

- `contained`: 26
- `requires_db_gate`: 519
- `out_of_scope_control_plane`: 3
- `helper_no_business_surface`: 16

### Remaining parser limitations

- No type inference, implicit-cast reasoning, or default-parameter modeling. Same-arity same-shape overloads that differ only by parameter type remain unresolved with `multiple_shape_compatible_overloads`.
- Ordering-based tie-breaks are not used.
- Corpus identity signatures do not encode defaults, so arity matching is strict equality.
