# BTPM REST API v1 — Integration Guide

This guide explains how an external application or middleware platform should use the current BTPM REST API v1 safely and correctly.

For the complete operation inventory and REST↔MCP crosswalk, see [CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md). For Connected App/security administration, see [SECURITY_AND_ADMINISTRATION.md](./SECURITY_AND_ADMINISTRATION.md).

## 1. Source authority and API base URL

The live API surface is defined by the current repository source:

- `supabase/functions/_shared/btpm-api/routes/capabilities.ts`
- `supabase/functions/_shared/btpm-api/routes/allowlist.ts`
- the individual modules under `supabase/functions/_shared/btpm-api/routes/`
- `supabase/functions/btpm-api-v1/`

Use a deployment-specific base URL equivalent to:

```text
https://<supabase-project-host>/functions/v1/btpm-api-v1
```

Do not hard-code the example host into portable integration logic. Treat the deployed base URL as environment configuration.

### OpenAPI contract

`docs/api/BTPM_API_V1_OPENAPI.yaml` is the machine-readable contract for the current REST v1 surface. It is the machine-readable companion to this guide and may be used for API discovery, client/tooling import, Postman/MuleSoft design and request-shape generation.

The live `capabilities.ts`, allowlist and strict route/body parsers remain authoritative if implementation and generated documentation ever drift. Request schemas in the OpenAPI are intentionally strict; response schemas are conservative where the live delegated readers/writers return bounded domain-specific projections.

## 2. Authentication model

Protected API operations use a **delegated-user OAuth bearer token**. BTPM currently does not expose `client_credentials`, static API keys, service-role credentials or direct database credentials as supported integration authentication methods.

For protected requests send:

```http
Authorization: Bearer <access-token>
```

The server validates, among other things:

- token validity and issuer;
- current user/session;
- signed `client_id` claim;
- active BTPM Connected App matching that OAuth client;
- active Connected App policy version;
- current user's acknowledgement of that exact policy version;
- applicable capability/scope/Project enablement and delegated-user authority.

Never send client identity in an ad hoc header/body field expecting BTPM to trust it. The signed token claim is authoritative.

`GET /v1/version` and `GET /v1/capabilities` are metadata routes and are deliberately public in the REST contract. Their output is service metadata, not a statement that a particular caller is authorized to execute every advertised operation.

## 3. Common request headers

### Protected calls

```http
Authorization: Bearer <access-token>
```

### JSON mutations

```http
Content-Type: application/json
Idempotency-Key: <unique-key>
```

### Optional request tracing

BTPM supports bounded request identifiers and returns a request ID on responses. When an external integration supplies a request identifier, keep it free of secrets and use a stable integration correlation value, not a bearer token or business narrative.

### Idempotency key rules

The canonical value must match:

```text
^[A-Za-z0-9._~:@/+!=-]{1,255}$
```

Leading/trailing spaces are trimmed by canonical validation. Blank/missing keys are rejected for mutations that require idempotency.

Recommended keys contain stable external identifiers, for example:

```text
salesforce:PortfolioItem:a012345:version:7
mulesoft:sf-event:0Xx123456789
```

Avoid timestamps alone when the same source event can be retried, because each retry would become a new BTPM mutation instead of an idempotent replay.

## 4. Response and safe-error model

Normal REST JSON responses include a server request ID header. Safe HTTP failures use a bounded form equivalent to:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Request validation failed."
  },
  "requestId": "..."
}
```

Representative public error codes include:

| Code | Typical HTTP status | Meaning |
|---|---:|---|
| `invalid_request` | 400 | Request path/query/body failed strict validation. |
| `invalid_request_id` | 400 | Supplied request identifier is invalid. |
| `unsupported_media_type` | 415 | JSON mutation did not use `application/json`. |
| `request_too_large` | 413 | Body exceeded the bounded request size. |
| `invalid_json` | 400 | Body is not valid JSON. |
| authentication-family failures | 401 | Bearer/session/issuer/audience problem. |
| `not_authorized` | 403 | Caller/client/scope/object is not authorized. |
| `route_not_found` | 404 | No allowed route matches. |
| `idempotency_conflict` | 409 | Same key is associated with a different canonical request. |
| `idempotency_pending` | 409 | Same canonical request is still in progress. |
| `concurrency_conflict` | 409 | Supplied resource version is stale. |
| `rate_limit_exceeded` | 429 | Connected App/user/route rate limit exceeded. |
| `api_unavailable` | 503 | API/operation disabled by a runtime control. |
| `request_timeout` | 504 | Request timed out. |
| `internal_error` | 500 | Bounded server failure. |

BTPM deliberately does not expose raw SQL errors, stack traces, service-role information, tokens, policy internals or database messages in these responses.

## 5. Strict request validation

BTPM routes use **closed schemas**. Unknown keys and unsupported aliases are rejected instead of ignored.

Important examples:

- Workspace list uses `organization_id`, not `organizationId`.
- Project list and Program list use `workspace_id`, not `workspaceId`.
- Portfolio list uses `organization_id` and `include_archived`, not camelCase aliases.
- `/v1/me` uses camelCase `contextType` and `contextId` together.
- Execution Update history uses camelCase `targetType` and `targetId`.

Do not rely on middleware libraries to rename request keys automatically without checking the BTPM route contract.

UUID path segments are strict and non-nil. Nested endpoints reject trailing or extra path segments rather than attempting permissive route normalization.

## 6. Pagination

### Offset pagination

Directory/administrative collections generally use:

```text
limit=<1..100>&offset=<0..10000>&search=<optional>
```

Common defaults are `limit=50`, `offset=0`. Search is bounded where supported.

Examples include Organizations, Workspaces, Projects, Programs, Workspace Members, Portfolios, Portfolio Projects and Project KPIs.

### Cursor pagination

Operational histories/collections such as Risks, Blockers, Execution Updates and KPI Update History use opaque keyset cursors.

Rules:

- treat the cursor as opaque;
- persist/send it exactly as returned;
- do not manufacture or edit it;
- do not infer authorization/scope from it;
- do not replace cursor pagination with external offset assumptions.

Risk and Blocker collection reads accept a limit up to 500. Execution Update history also uses a bounded limit up to 500.

## 7. Optimistic concurrency

Updates to versioned objects require `expectedUpdatedAt` (or a per-row token for reorder operations). This token must come from a prior authoritative BTPM read.

Example pattern:

```text
1. GET current object
2. retain its updatedAt/version token
3. calculate desired change
4. PATCH/POST mutation with expectedUpdatedAt
5. if conflict: stop and reconcile; do not silently overwrite
```

Do **not** implement the following anti-pattern:

```text
409 conflict -> automatically GET new token -> automatically retry same desired overwrite
```

That defeats optimistic concurrency and can overwrite a user's newer BTPM change. A conflict should trigger a merge/reconciliation decision.

Versioned mutations are identified in [CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md).

## 8. Idempotent mutation behavior

BTPM hashes a normalized canonical business payload rather than blindly hashing raw JSON. Consequences:

- same idempotency key + same canonical request can replay safely;
- same key + different canonical request returns an idempotency conflict;
- caller identity/request IDs are not substitutes for the business idempotency key;
- PATCH presence semantics matter: omitted and explicitly cleared values can hash differently where the canonical contract distinguishes them.

For integration design, assign one idempotency key to one external business mutation/event version.

## 9. Read operations and discovery

### Caller identity

```http
GET /v1/me
```

Optional contextual authority probe:

```http
GET /v1/me?contextType=project&contextId=<project-uuid>
```

`contextType` accepts exactly `organization`, `workspace` or `project`; `contextType` and `contextId` must be supplied together.

### Organizations

```http
GET /v1/organizations?limit=50&offset=0&search=<text>
```

### Workspaces

```http
GET /v1/workspaces?organization_id=<organization-uuid>&limit=50&offset=0
```

### Projects

```http
GET /v1/projects?workspace_id=<workspace-uuid>&limit=50&offset=0
```

The Project collection is particularly important: it returns Projects accessible to the delegated user **and** enabled for the calling Connected App. An accessible BTPM Project that is not Connected-App enabled may be omitted from the integration list.

### Programs

```http
GET /v1/programs?workspace_id=<workspace-uuid>&limit=50&offset=0
```

### Workspace Members

```http
GET /v1/workspaces/<workspace-uuid>/members?limit=50&offset=0&search=<text>
```

This surface is intentionally bounded and returns only the accepted member identity fields required for integration use.

### Project planning context

```http
GET /v1/projects/<project-uuid>/planning
```

Returns the canonical Project planning context including Project/Phases/Tasks/dependency information available to the caller.

### Risks

```http
GET /v1/projects/<project-uuid>/risks?limit=100&cursor=<opaque-cursor>
GET /v1/risks/<risk-uuid>
```

### Blockers

```http
GET /v1/projects/<project-uuid>/blockers?limit=100&cursor=<opaque-cursor>
GET /v1/blockers/<blocker-uuid>
```

### Execution Update history

```http
GET /v1/execution-updates?targetType=task&targetId=<task-uuid>&limit=100&cursor=<opaque-cursor>
```

`targetType` accepts `phase` or `task`.

### Portfolios

```http
GET /v1/portfolios?organization_id=<organization-uuid>&limit=50&offset=0&include_archived=false
GET /v1/portfolios/<portfolio-uuid>
GET /v1/portfolios/<portfolio-uuid>/projects?limit=50&offset=0
```

### KPIs

```http
GET /v1/projects/<project-uuid>/kpis?limit=50&offset=0&include_archived=false
GET /v1/kpis/<kpi-uuid>
GET /v1/kpis/<kpi-uuid>/updates?limit=<bounded>&cursor=<opaque-cursor>
```

## 10. Mutation contract reference

Every mutation below also requires a valid delegated caller, Connected App authorization and canonical idempotency control.

### Execution Updates

`POST /v1/execution-updates`

```json
{
  "targetType": "task",
  "targetId": "<task-uuid>",
  "summary": "Cutover rehearsal completed; two follow-ups remain.",
  "updateDate": "2026-08-23",
  "statusLabel": "On track"
}
```

- `targetType`: `phase|task`.
- `summary`: required narrative, max 4000 characters.
- `updateDate`: calendar `YYYY-MM-DD`.
- `statusLabel`: optional.
- Append-only; the narrative is not echoed back by the mutation result.

### Risks

`POST /v1/risks`

```json
{
  "targetType": "project",
  "targetId": "<project-uuid>",
  "title": "Finance SME capacity",
  "description": "Limited capacity may affect design sign-off.",
  "mitigationPlan": "Backfill critical workshops.",
  "likelihood": "medium",
  "impact": "high",
  "status": "open"
}
```

Vocabulary:

- target: `project|phase|task`
- likelihood: `low|medium|high`
- impact: `low|medium|high|critical`
- status: `open|under_mitigation|monitoring|realized|closed`

`PATCH /v1/risks/{riskId}` uses the complete scalar desired state plus `expectedUpdatedAt`.

### Blockers

`POST /v1/blockers`

```json
{
  "targetType": "task",
  "targetId": "<task-uuid>",
  "title": "Interface specification unavailable",
  "description": "Vendor has not delivered the final field mapping.",
  "severity": "high",
  "status": "open"
}
```

Vocabulary:

- target: `project|phase|task`
- severity: `low|medium|high|critical`
- status: `open|in_progress|resolved`

`PATCH /v1/blockers/{blockerId}` uses the complete desired scalar state plus `expectedUpdatedAt`.

### Phases

`POST /v1/phases`

Canonical fields:

```json
{
  "projectId": "<project-uuid>",
  "name": "Realize",
  "description": null,
  "status": "planned",
  "phaseType": "work_item",
  "startDate": "2026-08-24",
  "targetEndDate": "2026-09-30",
  "sortOrder": 30
}
```

Status vocabulary: `planned|active|completed|on_hold|cancelled`.

Phase type vocabulary: `work_item|milestone|deliverable|decision|review`.

In a baselined Project, Phase create can require both planning dates. If requested dates extend the Project planning window, BTPM can require explicit parent-window approval instead of silently extending it.

`PATCH /v1/phases/{phaseId}` requires `expectedUpdatedAt` and the accepted complete metadata state (`name`, `description`, `status`, `phaseType`).

Reorder:

```http
POST /v1/projects/<project-uuid>/phases/reorder
```

```json
{
  "rows": [
    {"phaseId":"<uuid>","expectedUpdatedAt":"<timestamp>","sortOrder":10},
    {"phaseId":"<uuid>","expectedUpdatedAt":"<timestamp>","sortOrder":20}
  ]
}
```

Maximum batch: 1000 rows. Canonical business logic validates sibling completeness/order/project membership.

Planning:

```http
PATCH /v1/phases/<phase-uuid>/planning
```

```json
{
  "expectedUpdatedAt": "<timestamp>",
  "startDate": "2026-08-24",
  "targetEndDate": "2026-09-30",
  "confirmParentExtension": false
}
```

### Tasks

Task vocabulary:

- status: `planned|active|completed|on_hold|cancelled`
- priority: `low|medium|high|critical`
- type: `milestone|deliverable|work_item|decision|review`

`POST /v1/tasks` creates a Task in a Phase using the canonical Task fields accepted by the route. Baselined Projects require planned start/due dates.

`PATCH /v1/tasks/{taskId}` requires `expectedUpdatedAt` and the accepted complete scalar Task metadata state.

Reorder:

```http
POST /v1/phases/<phase-uuid>/tasks/reorder
```

```json
{
  "rows": [
    {"taskId":"<uuid>","expectedUpdatedAt":"<timestamp>","sortOrder":10}
  ]
}
```

Planning:

```http
PATCH /v1/tasks/<task-uuid>/planning
```

```json
{
  "expectedUpdatedAt": "<timestamp>",
  "startDate": "2026-08-24",
  "dueDate": "2026-08-31",
  "confirmParentExtension": false
}
```

Assignment:

```http
PUT /v1/tasks/<task-uuid>/assignee
```

```json
{"assigneeId":"<workspace-member-user-uuid>"}
```

Use `{"assigneeId":null}` to clear assignment. There is intentionally no concurrency token on this dedicated assignment command; canonical Workspace membership/eligibility rules apply.

Transition:

```http
POST /v1/tasks/<task-uuid>/transition
```

The canonical body carries `expectedUpdatedAt`, actual-date set flags/values and an optional transition status from the bounded transition vocabulary (`active|completed`). Completed Tasks are not automatically reopened by this command.

### Projects

Create:

```http
POST /v1/projects
```

```json
{
  "workspaceId": "<workspace-uuid>",
  "name": "Wave 5 Deployment",
  "programId": null,
  "deliveryModel": "internal_delivery"
}
```

Delivery model: `internal_delivery|vendor_delivery|co_delivery`.

Creating a Project does **not** automatically enable that Project for the Connected App. A later Project-scoped integration call may require an administrator to enable it.

Update:

```http
PATCH /v1/projects/<project-uuid>
```

Requires `expectedUpdatedAt` and supports PATCH-presence semantics for the accepted mutable fields:

- `name`
- `priority`: `low|medium|high|critical`
- `description`
- `charter`
- `goals`
- `scopeIn`
- `scopeOut`
- `businessCase`
- `successCriteria`
- `completionCriteria`
- `budgetNarrative`
- `assumptions`
- `constraints`
- `programId`
- `deliveryModel`

Transition:

```http
POST /v1/projects/<project-uuid>/transition
```

```json
{
  "expectedUpdatedAt": "<timestamp>",
  "targetStatus": "completed",
  "confirmWarnings": false
}
```

Statuses: `planned|active|completed|on_hold|cancelled`.

Completion may produce hard blockers or soft warnings. Soft warnings require an explicit follow-up action with `confirmWarnings=true`; the integration must not auto-confirm them without the intended business decision.

### Programs

Create:

```http
POST /v1/programs
```

```json
{
  "workspaceId": "<workspace-uuid>",
  "name": "TO BE Implementation",
  "description": "Transformation implementation program"
}
```

Update requires `expectedUpdatedAt`; accepted mutable fields are `name`, `status` and clearable `description`. Program status uses the canonical PM status vocabulary.

### Portfolios

Create:

```http
POST /v1/portfolios
```

```json
{
  "organizationId": "<organization-uuid>",
  "name": "Afatinib",
  "code": "AFA",
  "description": "Product portfolio item synchronized from Salesforce",
  "lifecycleState": "development",
  "strategicPriority": "high",
  "ownerId": null
}
```

Lifecycle state values:

- `opportunity_candidate`
- `business_case_approved`
- `contracted`
- `development`
- `submission_approval`
- `launch_preparation`
- `launched_commercial`
- `lcm_optimization`
- `on_hold`
- `discontinuation`
- `retired`

Strategic priority: `critical|high|medium|low|watchlist`.

Defaults when omitted: lifecycle `opportunity_candidate`, strategic priority `medium`, nullable optional fields `null`.

Update:

```http
PATCH /v1/portfolios/<portfolio-uuid>
```

Requires `expectedUpdatedAt` and at least one mutable field: `name`, `code`, `description`, `lifecycleState`, `strategicPriority`, `ownerId`. PATCH presence/clear semantics are preserved.

Project assignment:

```http
PUT /v1/projects/<project-uuid>/portfolio
```

```json
{"portfolioId":"<portfolio-uuid>"}
```

Use `null` to clear the Project's Portfolio assignment. There is no concurrency token on this dedicated assignment command.

### KPIs

Create:

```http
POST /v1/projects/<project-uuid>/kpis
```

```json
{
  "name": "Milestones completed",
  "description": null,
  "unit": "%",
  "targetValue": 100,
  "targetDirection": "increase",
  "sourceMode": "manual",
  "valueType": "percent",
  "cadence": "weekly",
  "calculationKey": null,
  "formulaVersion": null,
  "completionMethod": null,
  "commentRequired": false,
  "actionPlanRequired": false,
  "autoSnapshotEnabled": false
}
```

Vocabulary:

- target direction: `increase|decrease|maintain|target_exact`
- source mode: `manual|automatic`
- value type: `percent|number|currency|text`
- cadence: `manual_only|weekly|monthly|quarterly|yearly`
- completion method: `task_count|duration_weighted`

Defaults: target direction `target_exact`, source mode `manual`, value type `number`, cadence `manual_only`, boolean controls false.

Update:

```http
PATCH /v1/kpis/<kpi-uuid>
```

Requires `expectedUpdatedAt`; the accepted KPI fields use PATCH presence semantics. Do not send internal `_set_*` fields; BTPM derives them from field presence.

Append operational update:

```http
POST /v1/kpis/<kpi-uuid>/updates
```

```json
{
  "value": 72.5,
  "updateDate": "2026-08-23",
  "note": "Weekly actual"
}
```

`value` must be a finite JSON number; `updateDate` is strict `YYYY-MM-DD`.

## 11. End-to-end example: Salesforce Portfolio Item → MuleSoft → BTPM

Assume Salesforce creates Portfolio Item `a01XX0000001234` and MuleSoft must create the corresponding BTPM Portfolio.

### Step A — resolve or configure the BTPM Organization

Use an approved stored mapping or query:

```http
GET <base>/v1/organizations?search=Example
Authorization: Bearer <delegated-token>
```

Store the authoritative BTPM Organization UUID in the integration mapping/configuration.

### Step B — map Salesforce fields to canonical BTPM values

Example mapping:

| Salesforce | BTPM |
|---|---|
| `Name` | `name` |
| product/code field | `code` |
| lifecycle field | one exact BTPM `lifecycleState` |
| priority field | one exact BTPM `strategicPriority` |
| description | `description` |
| source record ID | integration mapping/idempotency key, **not** a BTPM business field unless a separately approved field exists |

Do not invent a new lifecycle value. Translate explicitly in MuleSoft or reject the event for reconciliation.

### Step C — create

```bash
curl -X POST "$BTPM_API/v1/portfolios" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: salesforce:PortfolioItem:a01XX0000001234:v1" \
  -d '{
    "organizationId":"<organization-uuid>",
    "name":"Afatinib",
    "code":"AFA",
    "description":"Synchronized from Salesforce",
    "lifecycleState":"development",
    "strategicPriority":"high",
    "ownerId":null
  }'
```

Persist the returned BTPM Portfolio ID in a durable mapping table or back into Salesforce if governance permits.

### Step D — update later

Before update:

```http
GET <base>/v1/portfolios/<portfolio-uuid>
```

Retain its current `updatedAt` value. Then:

```bash
curl -X PATCH "$BTPM_API/v1/portfolios/$PORTFOLIO_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: salesforce:PortfolioItem:a01XX0000001234:v7" \
  -d '{
    "expectedUpdatedAt":"<updated-at-from-read>",
    "lifecycleState":"submission_approval",
    "strategicPriority":"critical"
  }'
```

If BTPM returns a concurrency conflict, MuleSoft should route the item to reconciliation rather than automatically overwriting the newer BTPM state.

## 12. Recommended middleware behavior

For MuleSoft or similar platforms:

1. Keep BTPM base URL/OAuth configuration per environment.
2. Maintain a durable external-ID ↔ BTPM-ID mapping.
3. Use deterministic event-version idempotency keys.
4. Make vocabulary transformations explicit and reject unmapped values.
5. Separate transient HTTP retries from business retries.
6. Retry network/5xx/timeout according to policy using the **same** idempotency key.
7. Do not blindly retry 400/403/409 business/security failures.
8. Treat `429` with controlled backoff.
9. Treat concurrency conflicts as reconciliation.
10. Log BTPM request IDs, operationId, external source ID and outcome — never bearer tokens or sensitive narrative payloads unless approved.
11. Test disabled Project and cross-scope negative cases before production.
12. Periodically verify the Connected App policy/capability configuration remains consistent with the integration design.

## 13. Change-management rule for integrators

Do not assume a newly added BTPM field or API route is automatically integration-accessible. API and MCP exposure are explicit, and Connected App capability/Project enablement remains independently governed. Revalidate this document, the OpenAPI contract and the live `capabilities.ts`/allowlist when upgrading the integration to a newer BTPM release.