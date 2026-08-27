# BTPM REST / MCP Capability Matrix

This file is the current human-readable crosswalk between the canonical BTPM API v1 operation inventory and MCP exposure metadata.

**Authority:** `supabase/functions/_shared/btpm-api/routes/capabilities.ts`, `routes/allowlist.ts`, individual route modules, and `supabase/functions/btpm-mcp/mcp/toolRegistry.ts`.

## Legend

- **Class**: `read` or `mutation` from the canonical REST allowlist.
- **MCP confirmation**: all exposed mutations require explicit MCP confirmation before execution.
- **Concurrency**: operations marked `required` require the caller to supply the current canonical version token (`expectedUpdatedAt` or the per-row equivalent). MCP forwards it unchanged.
- **Idempotency**: all mutations use the canonical BTPM mutation/idempotency path; REST carries `Idempotency-Key` in the request header, while MCP carries a validated idempotency key as a tool argument.

## Complete canonical operation crosswalk

| # | operationId | REST | Class | MCP tool | MCP exposure | Confirmation | Concurrency |
|---:|---|---|---|---|---|---|---|
| 1 | `version.get` | `GET /v1/version` | read | `btpm_get_version` | **not exposed** | n/a | n/a |
| 2 | `capabilities.get` | `GET /v1/capabilities` | read | `btpm_get_capabilities` | **not exposed** | n/a | n/a |
| 3 | `me.get` | `GET /v1/me` | read | `btpm_get_me` | exposed | no | n/a |
| 4 | `organizations.get` | `GET /v1/organizations` | read | `btpm_list_organizations` | exposed | no | n/a |
| 5 | `workspaces.get` | `GET /v1/workspaces` | read | `btpm_list_workspaces` | exposed | no | n/a |
| 6 | `programs.get` | `GET /v1/programs` | read | `btpm_list_programs` | exposed | no | n/a |
| 7 | `programs.get_by_id` | `GET /v1/programs/{programId}` | read | `btpm_get_program` | exposed | no | n/a |
| 8 | `projects.get` | `GET /v1/projects` | read | `btpm_list_projects` | exposed | no | n/a |
| 9 | `projects.get_by_id` | `GET /v1/projects/{projectId}` | read | `btpm_get_project` | exposed | no | n/a |
| 10 | `projects.planning.get` | `GET /v1/projects/{projectId}/planning` | read | `btpm_get_project_planning` | exposed | no | n/a |
| 11 | `execution_updates.append` | `POST /v1/execution-updates` | mutation | `btpm_append_execution_update` | exposed | **yes** | n/a |
| 12 | `risks.create` | `POST /v1/risks` | mutation | `btpm_create_risk` | exposed | **yes** | n/a |
| 13 | `risks.update` | `PATCH /v1/risks/{riskId}` | mutation | `btpm_update_risk` | exposed | **yes** | **required** |
| 14 | `blockers.create` | `POST /v1/blockers` | mutation | `btpm_create_blocker` | exposed | **yes** | n/a |
| 15 | `blockers.update` | `PATCH /v1/blockers/{blockerId}` | mutation | `btpm_update_blocker` | exposed | **yes** | **required** |
| 16 | `phases.create` | `POST /v1/phases` | mutation | `btpm_create_phase` | exposed | **yes** | n/a |
| 17 | `phases.update` | `PATCH /v1/phases/{phaseId}` | mutation | `btpm_update_phase` | exposed | **yes** | **required** |
| 18 | `phases.reorder` | `POST /v1/projects/{projectId}/phases/reorder` | mutation | `btpm_reorder_phases` | exposed | **yes** | **required per row** |
| 19 | `phases.plan` | `PATCH /v1/phases/{phaseId}/planning` | mutation | `btpm_plan_phase` | exposed | **yes** | **required** |
| 20 | `tasks.create` | `POST /v1/tasks` | mutation | `btpm_create_task` | exposed | **yes** | n/a |
| 21 | `tasks.update` | `PATCH /v1/tasks/{taskId}` | mutation | `btpm_update_task` | exposed | **yes** | **required** |
| 22 | `tasks.reorder` | `POST /v1/phases/{phaseId}/tasks/reorder` | mutation | `btpm_reorder_tasks` | exposed | **yes** | **required per row** |
| 23 | `tasks.plan` | `PATCH /v1/tasks/{taskId}/planning` | mutation | `btpm_plan_task` | exposed | **yes** | **required** |
| 24 | `tasks.assign` | `PUT /v1/tasks/{taskId}/assignee` | mutation | `btpm_assign_task` | exposed | **yes** | n/a |
| 25 | `tasks.transition` | `POST /v1/tasks/{taskId}/transition` | mutation | `btpm_transition_task` | exposed | **yes** | **required** |
| 26 | `risks.get` | `GET /v1/projects/{projectId}/risks` | read | `btpm_list_project_risks` | exposed | no | n/a |
| 27 | `risks.get_by_id` | `GET /v1/risks/{riskId}` | read | `btpm_get_risk` | exposed | no | n/a |
| 28 | `blockers.get` | `GET /v1/projects/{projectId}/blockers` | read | `btpm_list_project_blockers` | exposed | no | n/a |
| 29 | `blockers.get_by_id` | `GET /v1/blockers/{blockerId}` | read | `btpm_get_blocker` | exposed | no | n/a |
| 30 | `execution_updates.get` | `GET /v1/execution-updates` | read | `btpm_list_execution_updates` | exposed | no | n/a |
| 31 | `phases.get_by_id` | `GET /v1/phases/{phaseId}` | read | `btpm_get_phase` | exposed | no | n/a |
| 32 | `tasks.get_by_id` | `GET /v1/tasks/{taskId}` | read | `btpm_get_task` | exposed | no | n/a |
| 33 | `projects.create` | `POST /v1/projects` | mutation | `btpm_create_project` | exposed | **yes** | n/a |
| 34 | `projects.update` | `PATCH /v1/projects/{projectId}` | mutation | `btpm_update_project` | exposed | **yes** | **required** |
| 35 | `projects.transition` | `POST /v1/projects/{projectId}/transition` | mutation | `btpm_transition_project` | exposed | **yes** | **required** |
| 36 | `programs.create` | `POST /v1/programs` | mutation | `btpm_create_program` | exposed | **yes** | n/a |
| 37 | `programs.update` | `PATCH /v1/programs/{programId}` | mutation | `btpm_update_program` | exposed | **yes** | **required** |
| 38 | `workspace_members.get` | `GET /v1/workspaces/{workspaceId}/members` | read | `btpm_list_workspace_members` | exposed | no | n/a |
| 39 | `portfolios.get` | `GET /v1/portfolios` | read | `btpm_list_portfolios` | exposed | no | n/a |
| 40 | `portfolios.get_by_id` | `GET /v1/portfolios/{portfolioId}` | read | `btpm_get_portfolio` | exposed | no | n/a |
| 41 | `portfolios.projects.get` | `GET /v1/portfolios/{portfolioId}/projects` | read | `btpm_list_portfolio_projects` | exposed | no | n/a |
| 42 | `portfolios.create` | `POST /v1/portfolios` | mutation | `btpm_create_portfolio` | exposed | **yes** | n/a |
| 43 | `portfolios.update` | `PATCH /v1/portfolios/{portfolioId}` | mutation | `btpm_update_portfolio` | exposed | **yes** | **required** |
| 44 | `portfolios.assign_project` | `PUT /v1/projects/{projectId}/portfolio` | mutation | `btpm_assign_project_portfolio` | exposed | **yes** | n/a |
| 45 | `kpis.get` | `GET /v1/projects/{projectId}/kpis` | read | `btpm_list_project_kpis` | exposed | no | n/a |
| 46 | `kpis.get_by_id` | `GET /v1/kpis/{kpiId}` | read | `btpm_get_kpi` | exposed | no | n/a |
| 47 | `kpis.updates.get` | `GET /v1/kpis/{kpiId}/updates` | read | `btpm_list_kpi_updates` | exposed | no | n/a |
| 48 | `kpis.create` | `POST /v1/projects/{projectId}/kpis` | mutation | `btpm_create_kpi` | exposed | **yes** | n/a |
| 49 | `kpis.update` | `PATCH /v1/kpis/{kpiId}` | mutation | `btpm_update_kpi` | exposed | **yes** | **required** |
| 50 | `kpis.updates.append` | `POST /v1/kpis/{kpiId}/updates` | mutation | `btpm_append_kpi_update` | exposed | **yes** | n/a |

## Additional MCP bootstrap tool

`btpm_choose_project` is an MCP Apps / Project Selector tool. It is intentionally outside the 50 canonical `operationId` inventory because it is an agent/bootstrap presentation workflow, not a new BTPM business operation. It helps an agent/user select a valid Organization → Workspace → Project context using canonical BTPM reads.

## Read-family request notes

### Offset-paginated directory reads

The following use bounded offset pagination (typical defaults `limit=50`, `offset=0`, maximum `limit=100`):

- Organizations
- Workspaces
- Projects
- Programs
- Workspace Members
- Portfolios
- Portfolio Projects
- Project KPI collection

Where supported, `search` is bounded to 100 characters. Portfolio/KPI collections additionally expose explicit archive filters where defined by their canonical parser.

### Cursor-paginated operational reads

Risks, Blockers and Execution Update history use opaque cursor/keyset pagination, not arbitrary database offsets. Risk and Blocker collection reads accept `limit` up to 500. Execution Update history accepts target type/id plus a bounded cursor. KPI update history also uses a dedicated opaque cursor.

Callers must treat cursors as opaque. Do not parse them for identity/authorization data and do not synthesize them.

## Mutation controls by family

### Creates / appends without concurrency token

- execution update append
- risk create
- blocker create
- phase create
- task create
- task assign
- project create
- program create
- portfolio create
- project↔portfolio assignment
- KPI create
- KPI update append

These still require idempotency. Through MCP they also require explicit tool confirmation.

### Mutations with optimistic concurrency

- risk update
- blocker update
- phase update
- phase reorder (per row)
- phase planning
- task update
- task reorder (per row)
- task planning
- task transition
- project update
- project transition
- program update
- portfolio update
- KPI update

The caller supplies the version token that it previously read. BTPM does not automatically refresh it on conflict. A stale write must be reconciled explicitly.

## Conditional business states that integrators must handle

Some mutations can return valid business-state outcomes that are not equivalent to generic transport errors:

- Phase create in a baselined Project can require dates: `phase_dates_required`.
- Task create in a baselined Project can require dates: `task_dates_required`.
- Phase create/planning can require explicit Project-window extension approval.
- Task create/planning can require explicit Phase-window extension approval.
- Planning operations can return stale planning conflicts.
- Project completion can return soft warnings requiring explicit follow-up confirmation, or hard completion blocks.
- A completed Task cannot be silently reopened by `tasks.transition`; the explicit reopen boundary remains separate.

MCP preserves those distinctions rather than flattening them into ordinary confirmation or generic failure. REST clients should likewise model them as domain outcomes and not blindly retry.