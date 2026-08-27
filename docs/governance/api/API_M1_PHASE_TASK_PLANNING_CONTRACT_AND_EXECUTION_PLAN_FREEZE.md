# API-M.1 — Phase/Task Planning Read + Command Contract and Execution Plan Freeze

Marker: **API-M.1 — Phase/Task planning read and bounded Phase/Task command contract freeze**

Status: **documentation-only governance freeze**. No runtime, schema, migration,
route, capability, grant, Edge Function, OpenAPI, frontend, Supabase or
configuration change is made by this step.

Baseline commit accepted as the API-M starting point:
`e814046a4436ffde816c17194eaa5b5d7d142845`.

Programme position (per
`docs/governance/api/API_AT_REMAINING_PROGRAMME_REVISION_2026_08_08.md`):

```text
API-K -> API-M -> API-N -> API-O -> API-P -> API-Q -> API-R -> API-S -> deferred API-L -> API-T
```

API-K and API-ADM are complete. **API-L is deferred and is NOT a prerequisite
for API-M.** API-N remains blocked until the API-M final audit (M.13) and Human
Owner approval.

---

## 1. Frozen API-M objective

Expose the reusable canonical Project planning dataset required to reproduce the
current BTPM Project Gantt externally, and expand the external API to a bounded
set of canonical Phase and Task commands, **without** introducing direct
Supabase access, generic CRUD, arbitrary RPC exposure, a second planning truth,
or consumer-specific BTPM code.

Two equal, non-optional pillars:

- **A. Planning Read** — protected external Project planning read.
- **B. Phase/Task Commands** — explicit external commands over existing
  canonical BTPM behavior.

---

## 2. Planning read contract (frozen)

| Item | Frozen value |
| --- | --- |
| Route | `GET /v1/projects/{projectId}/planning` |
| Route ID | `projects.planning.get` |
| Capability | `planning:read` |
| Capability kind | `read` |
| Scope level | `project` |

`projects:read` MUST NOT be broadened to implicitly authorize this richer
Phase/Task planning dataset. `planning:read` is a separate capability.

Required security composition (identical in kind to the accepted protected
Project reads of API-H.3/API-H.4):

- authenticated delegated BTPM user;
- valid signed API client identity;
- accepted current user business-policy version (API-D);
- active API client;
- enabled Organization Connected App;
- enabled Workspace Connected App;
- enabled Project access (per API-HR.2-C1 project-enablement containment);
- exact `planning:read` capability;
- delegated user's canonical access to the Project;
- target-derived Tenant / Organization / Workspace / Project containment;
- normal API runtime switches and rate controls (API-G.1, API-G.5.10).

The consumer MUST NOT establish authority by supplying Tenant, Organization or
Workspace identifiers. Scope is derived from `{projectId}` server-side, as in
`public.api_v1_get_project`.

---

## 3. Planning response contract (frozen, bounded)

Only canonical source fields or deterministic projections already required by
the current BTPM Gantt.

### 3.1 Project

`projectId`, `name`, `startDate`, `targetEndDate`, `actualStartDate`,
`actualEndDate`, plus the project baseline context the current Gantt consumes
(baseline approval state) where present in the canonical model.

### 3.2 Phases

`phaseId`, `projectId`, `name`, `status`, `phaseType`, `sortOrder`,
`startDate`, `targetEndDate`, `baselineStartDate`, `baselineEndDate`,
`addedAfterBaseline`, `actualStartDate`, `actualEndDate`, `updatedAt`.

`updatedAt` is required because the existing canonical Phase/Task **update,
reorder and execution** PMG commands enforce optimistic concurrency on the row
`updated_at` value (`_expected_updated_at`, or per-row `expected_updated_at` for
the reorder commands). Create commands have no prior row version and therefore
take no such argument, and the current legacy planning-change functions take no
`_expected_updated_at` at all (see §8.2, §17 C-1B). External consumers still
need the current row version for the operations that do enforce it, so API-M
exposes `updatedAt` in the planning read to avoid forcing a second read model
before a command call.

### 3.3 Tasks

`taskId`, `projectId`, `phaseId`, `name`, `status`, `priority`, `taskType`,
`sortOrder`, `startDate`, `dueDate`, `baselineStartDate`, `baselineEndDate`,
`addedAfterBaseline`, `actualStartDate`, `actualEndDate`, `updatedAt`.

Assignee **names** are NOT part of the planning payload (see §5 finding F-3):
the current Gantt resolves display names from a separate workspace-members read,
not from the planning dataset. Task assignment mutation belongs to the Task
command surface (`tasks:assign`); broader Team/RACI reads remain API-P.

### 3.4 Dependencies (read projection only)

`dependencyId`, `sourceType`, `sourceId`, `targetType`, `targetId`,
`dependencyType` (canonical `public.dependency_type` enum).

API-M exposes this **read projection only**. Dependency create/update/remove
remains **API-O**.

---

## 4. Gantt single-source-of-truth rule (frozen)

The planning endpoint is a **planning-data API, not a serialized Gantt API**.

It MUST NOT expose or persist: chart coordinates, pixels, zoom, scroll
position, collapsed rows, filters, saved views, rendered bar positions,
presentation labels duplicated from canonical records, client-side find state,
any stored `gantt_rows`, or any other Gantt-specific shadow state.

- Ordering remains canonical `sort_order`.
- Dates remain canonical Project / Phase / Task planning fields.
- Dependency lines remain deterministic projections of canonical dependencies.
- External consumers render their own Gantt.

---

## 5. Gantt parity acceptance contract (frozen) and read findings

Acceptance: for the same Project at the same point in time, fetch
`GET /v1/projects/{projectId}/planning`, render an external Gantt from the
payload only, and compare with the current BTPM Project Gantt. Phase hierarchy,
Task hierarchy, Phase ordering, Task sibling ordering, Project planning window,
Phase dates, Task dates, baseline dates/state, actual execution dates,
milestone/task-type semantics and dependency edges must match. Only
presentation/styling differences are acceptable. Missing or inconsistent
planning truth is an API-M failure.

Astra may later act as a validation consumer; **no BTPM code may be
Astra-specific**.

### Repository-grounded read findings

- **F-1 — canonical Gantt data sources.** `src/pages/ProjectGantt.tsx` composes:
  `useProjectPhases` → `public.list_decrypted_project_phases(_project_id)`;
  `usePhaseTasks` → `public.list_decrypted_project_tasks(_project_id)`;
  `useProjectDependencies` → **direct PostgREST read of `public.dependencies`**
  filtered by in-project phase/task ids; and the `project` row supplied by the
  route outlet context.
- **F-2 — exact fields consumed.** `src/components/gantt/useGanttData.ts` reads
  per Phase: `id`, `name`, `status`, `sort_order`, `start_date`,
  `target_end_date`, `baseline_start_date`, `baseline_end_date`,
  `added_after_baseline`, `actual_start_date`, `actual_end_date`; per Task:
  `id`, `name`, `status`, `phase_id`, `sort_order`, `start_date`, `due_date`,
  `baseline_*`, `added_after_baseline`, `actual_*`, `task_type`, and
  `task_assignments[0].assignee_id`. Dependency lines use `source_type`,
  `source_id`, `target_type`, `target_id`, and are drawn only for same-level
  pairs (`ganttUtils.ts`, `useGanttDependencyLines`).
- **F-3 — assignment discrepancy vs the requested contract.** The Gantt shows an
  assignee **label** resolved through `useWorkspaceMembers` (`membersMap`), i.e.
  a separate membership read, not planning truth. Minimum Gantt parity therefore
  does **not** require assignee identity in the planning payload. Frozen
  decision: exclude assignees from `planning:read`; if a later step proves parity
  requires assignment, it must be raised as a bounded amendment, not assumed.
- **F-4 — dependency read gap.** The UI currently reads `public.dependencies`
  directly from the browser. There is **no** existing protected dependency read
  wrapper suitable for external delegated exposure, so M.3 must include the
  dependency projection inside the single planning wrapper (no direct table read
  from the API path).
- **F-5 — decryption boundary.** Phase/Task narrative fields are served to the
  UI through the protected `list_decrypted_project_*` RPCs. The API-M planning
  wrapper must not re-implement decryption and must not return protected
  narrative unless a field is explicitly frozen in §3 (it is not — `description`
  is intentionally excluded from the planning payload).

---

## 6. Phase external command surface (frozen)

Capabilities: `phases:create`, `phases:update`, `phases:reorder`,
`phases:plan`.

| Capability | Route ID | Method | Path |
| --- | --- | --- | --- |
| `phases:create` | `phases.create` | POST | `/v1/phases` |
| `phases:update` | `phases.update` | PATCH | `/v1/phases/{phaseId}` |
| `phases:reorder` | `phases.reorder` | POST | `/v1/projects/{projectId}/phases/reorder` |
| `phases:plan` | `phases.plan` | PATCH | `/v1/phases/{phaseId}/planning` |

Phase planning change and Phase metadata update remain **separate contracts**.
No generic Phase action endpoint.

---

## 7. Task external command surface (frozen)

Capabilities: `tasks:create`, `tasks:update`, `tasks:reorder`, `tasks:plan`,
`tasks:assign`, `tasks:transition`. No seventh Task capability.

| Capability | Route ID | Method | Path |
| --- | --- | --- | --- |
| `tasks:create` | `tasks.create` | POST | `/v1/tasks` |
| `tasks:update` | `tasks.update` | PATCH | `/v1/tasks/{taskId}` |
| `tasks:reorder` | `tasks.reorder` | POST | `/v1/phases/{phaseId}/tasks/reorder` |
| `tasks:plan` | `tasks.plan` | PATCH | `/v1/tasks/{taskId}/planning` |
| `tasks:assign` | `tasks.assign` | PUT | `/v1/tasks/{taskId}/assignee` |
| `tasks:transition` | `tasks.transition` | POST | `/v1/tasks/{taskId}/transition` |

---

## 8. Phase/Task command mapping inventory (evidence-based)

The ten canonical functions behind the frozen Phase/Task capabilities are **not
one homogeneous set**. Repository inspection separates them into two classes
with materially different architecture, authorization and containment.

Evidence used for this section:

- `docs/governance/pmg/PMG_8A_FINAL_REGRESSION_SECURITY_API_READINESS_INVENTORY.md`
  and `docs/governance/pmg/PMG_8C_PER_FUNCTION_SECURITY_PROPERTY_MATRIX.md`;
- `docs/governance/api/evidence/API_E_REACHABLE_SURFACE_LOCK.json`
  (`pmg_command_rpcs.count = 31`,
  `pmg_command_rpcs.containment_gate = "public.is_active_user"`);
- `docs/governance/api/API_E4A_REMAINING_DIRECT_BYPASS_INVENTORY.md`;
- effective (latest) migrations per function, not the earliest creating
  migration: Phase PMG commands
  `20260719125708_0a39ecd0-3ef2-44c2-ac00-060d52155028.sql`; Task
  create/update/reorder `20260719132305_2dbd5e97-b6fc-460b-8a21-758e460a5368.sql`;
  `apply_task_assignee_set`
  `20260719103347_a865360e-019c-40c8-985b-3101d0b64ee9.sql`;
  `apply_task_execution_change`
  `20260719094929_9b048ff7-8e67-4a9a-8d74-be44a31d4d2b.sql`; legacy planning
  commands `20260420163805_c7c41a5d-e8b6-4e95-9703-c9ed1f295aa8.sql`;
  `public.is_active_user` `20260722133411_6e92dfa0-d58c-4f68-a948-d25081581dfd.sql`;
  `public.is_workspace_admin_or_higher`
  `20260414183444_c74f74dc-ee90-462d-816a-66bac6d394bb.sql`;
- current UI callers: `src/hooks/useProjectPlanning.ts`,
  `src/lib/planningService.ts`, `src/hooks/useTaskAssignment.ts`,
  `src/lib/executionService.ts`.

### 8.1 Class A — PMG protected commands (members of the PMG-31 inventory)

Eight of the ten functions are confirmed members of the 31-RPC PMG protected
command inventory recorded in `API_E_REACHABLE_SURFACE_LOCK.json`
(`pmg_command_rpcs.entries`): `apply_phase_create`, `apply_phase_update`,
`reorder_phases`, `apply_task_create`, `apply_task_update`, `reorder_tasks`,
`apply_task_assignee_set`, `apply_task_execution_change`.

Properties verified for **every** Class A member individually in its effective
definition (no property below is generalized without per-member evidence):

- `RETURNS jsonb`, `LANGUAGE plpgsql`, `SECURITY DEFINER`,
  `SET search_path = public`;
- actor from `auth.uid()`, then `public.is_active_user(v_actor)`;
- PM authority on the target Project via
  `public.has_project_pm_authority(v_actor, <project_id>)`;
- target-derived Project/Workspace/Organization scope (never caller-supplied);
- `public.pmg_build_result(...)` envelope (`applied`, `no_change`, `conflict`,
  `confirmation_required`, `not_authorized`, `invalid`), parsed by
  `src/lib/pmg/pmgContract.ts`;
- PMG audit/provenance through `public.pmg_record_command_audit(...)` with
  `_correlation_id` / `_idempotency_key` provenance parameters;
- row locking (`FOR UPDATE`) on the mutated target or sibling set;
- EXECUTE posture: `REVOKE ALL ... FROM PUBLIC` and `FROM anon`,
  `GRANT EXECUTE ... TO authenticated, service_role`.

Per-member concurrency (explicitly **not** uniform):

| Function | Concurrency argument | Behavior |
| --- | --- | --- |
| `apply_phase_create` | none | new row; no prior version exists |
| `apply_phase_update` | `_expected_updated_at timestamptz` (required; `invalid`/`expected_updated_at_required` when NULL) | `conflict` when `updated_at IS DISTINCT FROM _expected_updated_at` |
| `reorder_phases` | per-row `expected_updated_at` inside `_rows jsonb` | full sibling-set match required; stale row ⇒ `conflict` |
| `apply_task_create` | none | new row |
| `apply_task_update` | `_expected_updated_at` (required) | `conflict` on mismatch |
| `reorder_tasks` | per-row `expected_updated_at` inside `_rows jsonb` | full sibling-set match required |
| `apply_task_assignee_set` | none | idempotent set; `no_change` on repeat |
| `apply_task_execution_change` | `_expected_updated_at` (required) | `conflict` on mismatch |

**Class A source-awareness status (exact).** No Class A function contains an
explicit `api_e_private.*` / `api_e.*` capability check of its own. Their only
external-context interaction is indirect, through the shared containment gate:
the effective `public.is_active_user(_user_id)` returns the active-profile check
when `api_e_private.jwt_client_id()` is NULL, returns `false` when a client id
is present but `api_e_private.assert_trusted_context()` is false, and otherwise
returns the active-profile check. Consequence: an untrusted OAuth client
principal is denied at that gate, but a *trusted* delegated external context
would pass it **without any exact-capability binding**. Class A therefore
requires the approved API-M exact-capability external execution treatment
(API-K.1 pattern, e.g. migration
`20260808133125_084ee2d8-7b06-478e-89c4-13e64f26c1c4.sql` for `risks:create`)
before any API wrapper may invoke them — see §17 C-1A.

**External wrapper requirement:** required for every Class A member, per
`docs/governance/api/API_F3_DATABASE_EXECUTION_WRAPPER_CONTRACT.md`.

**Encryption:** protected narrative (`description` and equivalents) is written
through the canonical encryption path; decrypted reads only via
`public.get_decrypted_task` / `public.list_decrypted_project_*`.

### 8.2 Class B — legacy planning commands (NOT PMG-31 members)

`public.apply_phase_planning_change` and `public.apply_task_planning_change` are
**not** members of the PMG-31 protected-command inventory. They are absent from
`pmg_command_rpcs.entries` in `API_E_REACHABLE_SURFACE_LOCK.json` and appear
instead in the direct-bypass inventory with
`classification: "requires_db_gate"`,
`classification_reason: "business_surface_present_without_approved_guard"`.
Any statement treating them as PMG commands is incorrect.

Actual current behavior (effective definition
`20260420163805_c7c41a5d-e8b6-4e95-9703-c9ed1f295aa8.sql`):

| Property | `apply_phase_planning_change` | `apply_task_planning_change` |
| --- | --- | --- |
| Signature | `(_phase_id uuid, _new_start date, _new_end date, _confirm_parent_extension boolean DEFAULT false)` | `(_task_id uuid, _new_start date, _new_due date, _confirm_parent_extension boolean DEFAULT false)` |
| Return type | `RETURNS uuid` (the target id) — **no PMG envelope** | `RETURNS uuid` — **no PMG envelope** |
| Language/security | `plpgsql`, `SECURITY DEFINER`, `SET search_path = public` | identical |
| Authorization | `public.is_workspace_admin_or_higher(auth.uid(), ph.workspace_id)` — **workspace authority**, not `has_project_pm_authority` | `public.is_workspace_admin_or_higher(auth.uid(), t.workspace_id)` |
| Active-user gate | none (`public.is_active_user` is **not** called) | none |
| Failure semantics | `RAISE EXCEPTION` text (not found / not authorized / completed-locked / cancelled-archived / invalid range), parent-extension refusal raised with `ERRCODE = 'check_violation'` | identical shape |
| Direct update | direct `UPDATE public.phases SET start_date, target_end_date` | direct `UPDATE public.tasks SET start_date, due_date` |
| Parent extension | when the new window exceeds the Project window, requires `_confirm_parent_extension`, then sets `app.allow_planned_extension` and calls `public._apply_project_extension_internal(...)` | same via `public._apply_phase_extension_internal(...)`, which may cascade to the Project |
| Concurrency | **none** — no `_expected_updated_at`, no `FOR UPDATE` on the target row; last write wins | **none** |
| Grants/EXECUTE | `GRANT EXECUTE ... TO authenticated` in the creating migration; no accompanying `REVOKE ALL ... FROM PUBLIC/anon` in that migration | same |
| Activity/audit | canonical activity via `public.log_activity_event(...)` in the extension path; **no** `pmg_record_command_audit`, no correlation/idempotency provenance parameters | same |
| Encryption | not applicable — planning dates only; no protected narrative written | same |
| Current UI caller | `applyPhasePlanningChange` (`src/lib/planningService.ts`) with preview `public.preview_phase_planning_change` | `applyTaskPlanningChange` (`src/lib/planningService.ts`) with preview `public.preview_task_planning_change` |

**Class B OAuth / direct-invocation posture (evidence-bounded).** Because these
functions never call `public.is_active_user`, the PMG-31 `is_active_user`
containment mechanism does **not** apply to them, and no claim is made here that
they reject delegated OAuth principals. `public.is_workspace_admin_or_higher` is
a plain `user_roles` lookup with no `api_e_private` awareness. Their final
OAuth/direct-invocation posture **cannot be conclusively established from
committed repository evidence** and therefore remains a **required security
verification/correction before external exposure** (§17 C-1B).

### 8.3 Capability → canonical function mapping

Authorization is stated per command class rather than as a blanket rule:
Class A rows use `is_active_user` + `has_project_pm_authority`; Class B rows use
`is_workspace_admin_or_higher` on the target's Workspace with no active-user
gate.

| API capability | Route ID | Method/path | Canonical function(s) | Class | Current UI caller | Authorization (current) | Concurrency (current) | Confirmation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `phases:create` | `phases.create` | POST `/v1/phases` | `public.apply_phase_create(_project_id, _name, _description, _status, _phase_type, _start_date, _target_end_date, _sort_order, _correlation_id, _idempotency_key)` | A | `useCreatePhase` (`src/hooks/useProjectPlanning.ts`) | `is_active_user` + `has_project_pm_authority` | none (new row) | `confirmation_required` when Phase dates fall outside the Project window |
| `phases:update` | `phases.update` | PATCH `/v1/phases/{phaseId}` | `public.apply_phase_update(_phase_id, _expected_updated_at, _name, _description, _status, _phase_type, _correlation_id, _idempotency_key)` | A | `useUpdatePhase` | `is_active_user` + `has_project_pm_authority` | `_expected_updated_at` → `conflict` | none (metadata only; no dates) |
| `phases:reorder` | `phases.reorder` | POST `/v1/projects/{projectId}/phases/reorder` | `public.reorder_phases(_project_id, _rows jsonb[{id, expected_updated_at, new_sort_order}], _correlation_id, _idempotency_key)` | A | `useReorderPhases` | `is_active_user` + `has_project_pm_authority` | per-row `expected_updated_at` over the full sibling set | none |
| `phases:plan` | `phases.plan` | PATCH `/v1/phases/{phaseId}/planning` | `public.apply_phase_planning_change(_phase_id, _new_start, _new_end, _confirm_parent_extension)`, preview `public.preview_phase_planning_change(_phase_id, _new_start, _new_end)` | **B (legacy, not PMG-31)** | `applyPhasePlanningChange` (`src/lib/planningService.ts`) | `is_workspace_admin_or_higher` on the Phase's Workspace; no active-user gate | **none today**; API-M freezes external `expectedUpdatedAt` and requires canonicalization in M.6 (§9.2, §17 C-1B) | explicit `_confirm_parent_extension` boolean |
| `tasks:create` | `tasks.create` | POST `/v1/tasks` | `public.apply_task_create(_phase_id, _name, _description, _status, _priority, _task_type, _start_date, _due_date, _estimated_hours, _sort_order, _correlation_id, _idempotency_key)` | A | `useCreateTask` | `is_active_user` + `has_project_pm_authority` | none (new row) | `confirmation_required` when Task dates fall outside the parent Phase window |
| `tasks:update` | `tasks.update` | PATCH `/v1/tasks/{taskId}` | `public.apply_task_update(_task_id, _expected_updated_at, _name, _description, _status, _priority, _task_type, _estimated_hours, _correlation_id, _idempotency_key)`; fresh timestamp from `public.get_decrypted_task(_task_id)` | A | `useUpdateTask` | `is_active_user` + `has_project_pm_authority` | `_expected_updated_at` → `conflict` | metadata only |
| `tasks:reorder` | `tasks.reorder` | POST `/v1/phases/{phaseId}/tasks/reorder` | `public.reorder_tasks(_phase_id, _rows jsonb[{id, expected_updated_at, new_sort_order}], _correlation_id, _idempotency_key)` | A | `useReorderTasks` | `is_active_user` + `has_project_pm_authority` | per-row `expected_updated_at` over the full sibling set | none |
| `tasks:plan` | `tasks.plan` | PATCH `/v1/tasks/{taskId}/planning` | `public.apply_task_planning_change(_task_id, _new_start, _new_due, _confirm_parent_extension)`, preview `public.preview_task_planning_change(_task_id, _new_phase_id, _new_start, _new_due)` | **B (legacy, not PMG-31)** | `applyTaskPlanningChange` | `is_workspace_admin_or_higher` on the Task's Workspace; no active-user gate | **none today**; API-M freezes external `expectedUpdatedAt` and requires canonicalization in M.9 (§9.2, §17 C-1B) | explicit `_confirm_parent_extension` boolean |
| `tasks:assign` | `tasks.assign` | PUT `/v1/tasks/{taskId}/assignee` | `public.apply_task_assignee_set(_task_id, _assignee_id, _correlation_id, _idempotency_key)`, delegating once to canonical `public.set_task_assignee` | A | `useSetTaskAssignee` (`src/hooks/useTaskAssignment.ts`) | `is_active_user` + `has_project_pm_authority` + assignee Workspace membership | none (idempotent set; `no_change` on repeat) | none |
| `tasks:transition` | `tasks.transition` | POST `/v1/tasks/{taskId}/transition` | `public.apply_task_execution_change(_task_id, _expected_updated_at, _set_actual_start, _actual_start_date, _set_actual_end, _actual_end_date, _status, _correlation_id, _idempotency_key)` | A | `updateTaskExecution` (`src/lib/executionService.ts`) | `is_active_user` + `has_project_pm_authority` | `_expected_updated_at` → `conflict` | completed-task lock requires canonical `public.reopen_task` first |

The API-M future external architecture is unchanged by this classification:
delegated user; target-derived scope; exact capability; Organization /
Workspace / Project Connected App enablement; canonical BTPM business authority;
no service-role business mutation.

Adjacent canonical behavior deliberately **excluded** from API-M:
`public.apply_phase_timeline_action` / `public.preview_phase_timeline_action`
(Gantt drag/resize resolution of `move_phase_plan` vs `shift_remaining_work`),
`public.reopen_task` / `public.reopen_phase`,
`public.apply_project_planning_change`. These are specialized presentation-driven
or Project-level operations; exposing them is not required to preserve canonical
Phase/Task planning semantics and would breach §19 non-goals.

---

## 9. Mutation architecture rules (frozen)

Each material API-M command follows the API-I/API-K proven chain:

```text
HTTP request
-> API authentication / runtime / rate limit
-> strict route-specific input validation
-> dedicated database wrapper with fixed typed parameters
-> server derives authoritative target scope
-> exact trusted API context and exact capability
-> Organization / Workspace / Project Connected App checks
-> delegated user's canonical business authority
-> API-F transactional idempotency claim
-> exactly one hardcoded canonical PMG/planning operation
-> bounded canonical result
-> API-F idempotency completion
-> commit
```

Prohibited: generic mutation executor; function-name parameter; RPC-name
parameter; command-name dynamic dispatch; table-name parameter; arbitrary SQL;
arbitrary RPC exposure; generic CRUD; client-selected authorization scope;
external service-role execution.

### 9.1 Idempotency

`public.api_idempotency_registry` (API-F) is the **only** external replay
mechanism for material API-M mutations. PMG audit/`_idempotency_key`
provenance fields are not a substitute. Required: same key + same canonical
request → safe replay; same key + different payload → conflict; pending claim →
no duplicate execution; mutation and idempotency completion remain
transactional; no plaintext protected narrative in idempotency
metadata/results.

### 9.2 Optimistic concurrency

Reuse the canonical concept — the row `updated_at` value — as
`expectedUpdatedAt` in the external contract. Stale mutations make no change,
return a bounded HTTP 409, and never expose SQL or database internals. Reorder
routes must submit the full canonical sibling set with per-row
`expected_updated_at`, exactly as `reorder_phases` / `reorder_tasks` require.
Create routes carry no `expectedUpdatedAt` (no prior row version exists).

**Frozen decision — external planning concurrency.** External `phases:plan` and
`tasks:plan` **MUST** use optimistic concurrency through `expectedUpdatedAt`. A
stale external planning mutation must produce a bounded conflict and make **no
change**. Because the current Class B legacy planning functions (§8.2) accept no
version argument, the later Phase/Task implementation steps must canonicalize
them (M.6 for Phase, M.9 for Task) subject to all of the following:

- existing BTPM UI behavior is preserved (current callers in
  `src/lib/planningService.ts` continue to work unchanged);
- parent-extension confirmation semantics are preserved;
- completed / cancelled / archived and parent-child containment protections are
  preserved;
- the canonical row `updated_at` concept is used — **no second version field**
  is introduced;
- stale external planning changes yield a bounded conflict with no mutation.

M.1 documents this requirement only; it is **not** implemented here.

---

## 10. Planning confirmation semantics (frozen)

A Phase or Task planning change MUST NOT silently extend its parent planning
window. The canonical rule is implemented by
`public.apply_phase_planning_change` and `public.apply_task_planning_change`
via the `_confirm_parent_extension` boolean, with
`public.preview_phase_planning_change` / `public.preview_task_planning_change`
returning `valid`, `requires_extension`, `blocked`, `blocked_reason` and the
parent current/proposed window.

External contract:

- `confirmParentExtension` is an explicit request field;
- absence of confirmation must never cause automatic parent extension —
  the wrapper returns the canonical confirmation-required outcome;
- completed / cancelled / archived / execution-anchored protections remain
  canonical and are not relaxed for external callers;
- no simpler external planning path may bypass these rules.

---

## 11. Reorder semantics (frozen)

- **Phase reorder** — sibling ordering within one Project only; canonical
  `sort_order`; no Project movement.
- **Task reorder** — sibling ordering within one Phase only; canonical
  `sort_order`; no re-parenting through the reorder route.

A future Task move between Phases is a separately governed command and is not
part of API-M.

---

## 12. Assignment semantics (frozen)

`tasks:assign` reuses `public.apply_task_assignee_set` only. No second
assignment model. Canonical validation already enforced (per the RPC and
`useTaskAssignment.ts`): authenticated active actor; PM authority on the task's
Project; when the assignee is non-null, the assignee must be a member of the
task's Workspace; scope derived from the task row itself; DELETE + optional
INSERT + activity emission delegated exactly once to `public.set_task_assignee`.
No generic organization user directory is exposed. Team/RACI remains API-P.

---

## 13. Task transition semantics (frozen)

`tasks:transition` reuses `public.apply_task_execution_change` only. Bounded
caller inputs: `expectedUpdatedAt`; optional explicit actual-start set/clear;
optional explicit actual-end set/clear; optional `status` limited to the
canonical execution vocabulary `active` | `completed`. Server behavior remains
canonical: actual-date range validation, completed-task lock (reopen required
first), phase/project actual rollups, encryption, execution history and
activity. Callers may not directly set system-derived execution fields that the
canonical command derives (notably Phase and Project actual dates, which are
derived from children and rejected by trigger).

---

## 14. Security and encryption (frozen)

Delegated-user business execution only; no external service-role business
mutation; target-derived scope; exact capability intersection; no
client-provided Tenant/Organization/Workspace authority; no raw SQL or Supabase
error text externally; no credentials or tokens in logs, audit or idempotency
records. All API-M surfaces use the existing BTPM encryption model; protected
narrative is decrypted only through approved protected backend reads; material
encrypted fields remain encrypted at rest; no plaintext-first migration or
persistence; mutation success results must not echo protected narrative.

---

## 15. Existing behavior that must remain unchanged

Ordinary non-OAuth UI sessions; current Planning UX; current Project Gantt;
Phase create/edit; Task create/edit; current reorder behavior; parent/child
planning containment; current execution transition behavior; task assignment
behavior; dependency behavior; API-H read routes; API-I execution-update
mutation; API-K Risk/Blocker mutations; Connected Apps administration; OAuth
containment; API-F idempotency; durable API activity; existing encryption.

API-M is additive external capability, not a PM-domain redesign.

---

## 16. Explicit API-M non-goals

No Project/Program mutations (API-N); no Dependency mutation (API-O); no KPI
API (API-O); no Governance API (API-O); no Team/RACI API (API-P); no Agile API
(API-P); no MCP/Copilot (API-Q); no machine-to-machine identity (API-R); no
Story Pack internal API migration (deferred API-L); no generic user-directory
API; no generic CRUD; no arbitrary RPC; no generic PMG dispatcher; no external
service-role business execution; no Project/Phase/Task shadow model; no stored
Gantt state; no consumer-specific schema/routes/authorization; no
Astra-specific BTPM code.

---

## 17. Conflicts and gaps discovered (evidence-based)

- **C-1A — PMG command source-awareness gap (Class A).** The eight Class A
  PMG-31 commands (§8.1) contain no explicit `api_e_private.*` / `api_e.*`
  capability check. Their only external-context interaction is the shared
  `public.is_active_user` gate, whose effective definition denies a principal
  carrying `api_e_private.jwt_client_id()` unless
  `api_e_private.assert_trusted_context()` is true — and, when it is true,
  admits it with **no exact-capability binding**. These commands therefore
  require the approved API-M exact-capability external execution treatment
  (API-K.1 pattern) before any API wrapper may invoke them. No function may be
  assumed externally executable merely because it exists.
- **C-1B — legacy planning-command canonicalization gap (Class B).**
  `public.apply_phase_planning_change` and `public.apply_task_planning_change`
  are **not** PMG-31 commands (§8.2) and require more than "adding
  source-awareness". Before external exposure they must be brought into the
  required API-M command posture: trusted delegated external execution; exact
  capability binding; authoritative target-derived scope; optimistic concurrency
  on the canonical row `updated_at`; bounded result/error semantics suitable for
  the API (today they `RAISE EXCEPTION` and return `uuid`); and preservation of
  canonical planning and parent-extension confirmation behavior. They must not
  be described as PMG-31 commands unless a later approved step actually converts
  them into that architecture. Their current OAuth/direct-invocation posture is
  **not** established by committed evidence (they never call
  `public.is_active_user`), so establishing it is a required security
  verification/correction before external exposure.
- **C-2 — planning-change concurrency direction (resolved in M.1).** The
  asymmetry is real: the Class B planning functions take no
  `_expected_updated_at`, unlike `apply_phase_update` / `apply_task_update` /
  `apply_task_execution_change`. M.1 does **not** leave competing options: per
  §9.2 the frozen direction is that external `phases:plan` / `tasks:plan` MUST
  use `expectedUpdatedAt`, and M.6 / M.9 must canonicalize the legacy planning
  commands accordingly while preserving UI behavior, confirmation semantics,
  lock/containment protections, and using the canonical `updated_at` concept
  only.
- **C-3 — `preview_*` exposure question.** The canonical confirmation workflow is
  two-step (preview then apply). API-M freezes only the apply routes; the
  external contract must therefore surface the canonical
  confirmation-required outcome (including parent current/proposed window as
  bounded safe fields) from the apply wrapper itself, rather than exposing
  `preview_*` as an additional external route. If M.7/M.10 finds the bounded
  result insufficient for a usable external flow, a separate `*.planning`
  preview route must be governed as an amendment, not invented inline.
- **C-4 — dependency read has no protected wrapper.** See finding F-4; the
  planning wrapper must own the dependency projection.
- **C-5 — task move between phases exists in canonical preview.**
  `preview_task_planning_change` accepts `_new_phase_id`, but
  `apply_task_planning_change` does not. API-M must not expose task
  re-parenting; the external planning contract carries dates only.
- **Recommended split.** Because of C-1A plus C-1B, M.9 (Task external
  is the largest single step (six capabilities across four canonical
  functions). Recommendation recorded here rather than acted upon: M.9 may be
  split into **M.9a** (create/update/reorder) and **M.9b**
  (plan/assign/transition) if implementation review confirms the combined
  change set is too large to verify in one step.

---

## 18. Frozen API-M execution sequence

| Step | Scope |
| --- | --- |
| **M.1** | This documentation-only contract and execution-plan freeze. |
| **M.2** | API-M capability catalogue registration: `planning:read` plus the four Phase and six Task capabilities. Catalogue only; **no grants**. |
| **M.3** | Project planning read database contract: one dedicated protected planning read wrapper returning the bounded §3 payload (including the dependency projection). |
| **M.4** | Wire `GET /v1/projects/{projectId}/planning` (route contract, parser, adapter, bearer-bound reader, router allowlist). |
| **M.5** | Planning/Gantt parity regression contract: permanent guards proving payload completeness and single-source behavior. |
| **M.6** | Phase canonical external readiness for the four approved Phase operations only, comprising (a) source-awareness / exact-capability external execution alignment for the three Class A PMG Phase commands and (b) canonicalization of the Class B legacy Phase planning command `apply_phase_planning_change` — including optimistic concurrency on the canonical `updated_at`, bounded result semantics, exact capability binding and target-derived scope. Existing UI behavior, parent-extension confirmation and lock/containment protections preserved. |
| **M.7** | Phase dedicated transactional API wrappers (exact capabilities, scope derivation, API-F idempotency, concurrency, confirmation). |
| **M.8** | Phase HTTP command surface: strict routes, parsers, adapters. |
| **M.9** | Task canonical external readiness for the six approved Task operations, comprising (a) source-awareness / exact-capability external execution alignment for the five Class A PMG Task commands and (b) canonicalization of the Class B legacy Task planning command `apply_task_planning_change` — including optimistic concurrency on the canonical `updated_at`, bounded result semantics, exact capability binding and target-derived scope. Existing UI behavior, parent-extension confirmation and lock/containment protections preserved. Possible split M.9a/M.9b per §17. |
| **M.10** | Task dedicated transactional API wrappers. |
| **M.11** | Task HTTP command surface: strict routes, parsers, adapters. |
| **M.12** | OpenAPI + developer contract for the real implemented surface, permanent cross-layer guards, approved generic Connected App capability configuration, Gantt parity plus selected Phase/Task controlled runtime validation. Astra may serve as test evidence only. |
| **M.13** | Independent API-M full-phase audit; no implementation unless a separately identified correction is required. **Human Owner approval is required before API-N.** |

---

## 19. Definition of Done for M.1

1. Exactly one new governance document exists at
   `docs/governance/api/API_M1_PHASE_TASK_PLANNING_CONTRACT_AND_EXECUTION_PLAN_FREEZE.md`.
2. No runtime, code, schema, migration or configuration change was made.
3. The August 8 remaining-programme revision is reflected; API-L is recorded as
   deferred and not an API-M prerequisite.
4. `planning:read` is frozen separately from `projects:read`.
5. The planning response is sufficient for current Gantt parity (§3, §5).
6. No Gantt shadow state is introduced (§4).
7. Dependency read projection versus API-O mutation scope is explicit (§3.4).
8. All four Phase capabilities and all six Task capabilities are frozen with
   explicit route IDs, methods and paths (§6, §7).
9. Canonical Phase/Task functions are inventoried from repository inspection and
   separated into Class A PMG-31 protected commands and Class B legacy planning
   commands, with per-command authorization, concurrency and containment stated
   from effective definitions; gaps are identified, not assumed (§8, §17 C-1A,
   C-1B).
9a. External `phases:plan` / `tasks:plan` are frozen to require
    `expectedUpdatedAt`, and M.6 / M.9 explicitly own the required legacy
    planning-command canonicalization (§9.2, §18).
10. Planning confirmation, concurrency and ordering rules reflect current BTPM
    behavior (§9.2, §10, §11).
11. Encryption and delegated-user authority requirements are explicit (§2, §14).
12. API-F idempotency is the sole external replay substrate (§9.1).
13. Generic dispatch, CRUD and arbitrary RPC exposure are prohibited (§9).
14. The M.2–M.13 sequence is documented (§18).
15. API-N remains blocked until the API-M final audit and Human Owner approval.
