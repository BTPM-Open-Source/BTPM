# BTPM MCP — Integration and Agent Guide

BTPM MCP exposes the canonical BTPM integration capabilities to MCP-capable agents such as Microsoft 365 Copilot / Copilot Studio. It is a **thin adapter over canonical BTPM API/business execution**, not a second PM application layer.

For the operation/tool crosswalk, see [CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md). For Connected App/security administration, see [SECURITY_AND_ADMINISTRATION.md](./SECURITY_AND_ADMINISTRATION.md).

## 1. Core architecture principle

Every canonical MCP business tool maps to an existing BTPM API v1 `operationId`.

MCP does not:

- execute arbitrary SQL;
- expose a generic CRUD interface;
- accept an arbitrary `operationId` dispatcher;
- bypass canonical BTPM authorization;
- use service-role credentials for business reads/writes;
- invent separate PM business rules;
- weaken idempotency or concurrency controls.

The canonical operation remains the business authority. MCP adds agent-facing tool metadata, validation, confirmation and bounded result mapping.

## 2. Endpoint and transport

Use the deployment-specific MCP resource URL equivalent to:

```text
https://<supabase-project-host>/functions/v1/btpm-mcp
```

BTPM MCP uses **Streamable HTTP**.

MCP protocol POSTs must be compatible with the MCP Streamable HTTP transport and include the accepted response media types:

```http
Accept: application/json, text/event-stream
Authorization: Bearer <access-token>
```

Do not hard-code a tenant/project URL into reusable agent definitions; configure the environment-specific BTPM MCP URL.

## 3. OAuth protected-resource discovery

BTPM MCP exposes a public protected-resource metadata endpoint:

```text
GET /.well-known/oauth-protected-resource
```

The metadata identifies:

- the canonical MCP resource URI;
- the existing Supabase Auth issuer as authorization server;
- bearer authentication support.

The MCP server does not create a second BTPM authorization server and does not advertise Dynamic Client Registration as part of the accepted architecture.

The access token used for MCP must have the canonical MCP resource audience. A token that is valid only for some other audience is not accepted merely because the user is otherwise logged into BTPM.

## 4. Delegated identity and Connected App authorization

MCP is delegated-user based.

The protected request sequence is conceptually:

```text
request ID
  -> Origin/method/path checks
  -> bearer token verification
  -> current user/session confirmation
  -> signed OAuth client_id resolution
  -> BTPM Connected App + active policy + user acknowledgement
  -> trusted MCP execution context
  -> MCP SDK / tool registration
  -> explicit tool executor
  -> canonical BTPM read/write path
```

Client identity comes only from the signed token `client_id`. An MCP argument, `_meta`, query string or custom header cannot select another Connected App.

The trusted MCP context is server-derived and includes the delegated actor/client/provenance correlation. It does **not** accept caller-selected Tenant, Organization, Workspace, Project authority or source channel.

`sourceChannel` is server-fixed to `mcp`; delegated execution is fixed to `delegated_user`.

## 5. Tool discovery model

The source of truth is:

```text
supabase/functions/btpm-mcp/mcp/toolRegistry.ts
```

A canonical operation is callable through MCP only when its registry entry is explicitly `exposed` and `serverFactory` has an explicit bounded registration/executor path.

Exposure is fail-closed. Adding a future REST route does not automatically make it an MCP tool.

At the current documentation baseline:

- 50 canonical REST operations exist;
- 48 are exposed as canonical MCP tools;
- `version.get` is intentionally not exposed;
- `capabilities.get` is intentionally not exposed;
- `btpm_choose_project` is a separate Project Selector/bootstrap MCP Apps tool, not a canonical REST operation.

## 6. Tool categories

### Discovery/context reads

Typical agent discovery flow uses:

```text
btpm_get_me
btpm_list_organizations
btpm_list_workspaces
btpm_list_projects
btpm_get_project
btpm_get_project_planning
btpm_list_programs
btpm_list_workspace_members
```

### Operational reads

```text
btpm_list_project_risks
btpm_get_risk
btpm_list_project_blockers
btpm_get_blocker
btpm_list_execution_updates
btpm_get_phase
btpm_get_task
```

### Portfolio reads

```text
btpm_list_portfolios
btpm_get_portfolio
btpm_list_portfolio_projects
```

### KPI reads

```text
btpm_list_project_kpis
btpm_get_kpi
btpm_list_kpi_updates
```

### Mutations

MCP exposes canonical mutation tools for Execution Updates, Risks, Blockers, Phases, Tasks, Projects, Programs, Portfolios and KPIs. Every exposed mutation is marked `confirmation = required` in the registry.

See [CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md) for the complete exact names.

## 7. Project Selector: `btpm_choose_project`

`btpm_choose_project` is intentionally different from the 48 canonical MCP business tools.

It is a bootstrap/presentation tool that helps a user/agent establish valid BTPM working context by navigating Organization → Workspace → Project. It does not create a new canonical BTPM business operation or an alternative authorization path.

Recommended use:

1. invoke Project Selector when project context is unknown or ambiguous;
2. let the user choose the intended Project;
3. use canonical MCP reads against the selected Project;
4. before a mutation, summarize the intended change and obtain explicit confirmation.

Do not treat the selector result as permanent authorization. Every later canonical tool call is independently authorized by BTPM.

## 8. Read-tool conventions

Read tools are bounded and preserve the canonical REST authorization model.

The agent should:

- prefer discovery tools over guessing UUIDs;
- use returned pagination controls rather than asking for unbounded data;
- keep a stable selected Project context within the conversation when appropriate;
- re-resolve context if the user changes Organization/Workspace/Project;
- never infer that an inaccessible/missing object exists outside the caller's scope.

Business reads execute caller-bound using the delegated bearer identity. MCP does not perform a service-role business read and then filter it afterward.

## 9. Mutation confirmation

Every MCP mutation requires an explicit confirmation argument accepted by the tool contract.

Conceptually:

```text
Agent identifies desired change
  -> reads current state if needed
  -> presents exact proposed mutation to user
  -> user confirms
  -> tool call sets confirmation=true
  -> canonical mutation executes once
```

If confirmation is absent/false, the MCP tool returns a bounded `confirmation_required` result before the business writer executes.

This **transport/tool confirmation** is distinct from domain-specific business confirmations described below.

Do not design an agent that globally sets `confirmation=true` without a user/business decision. Confirmation must correspond to the specific intended mutation.

## 10. Idempotency in MCP mutations

MCP mutation arguments include a validated idempotency key where required by the canonical mutation layer. MCP reuses the same canonical idempotency semantics as REST.

Recommended format:

```text
copilot:<business-object>:<external-event-or-intent-id>:<version>
```

Example:

```text
copilot:project-risk:meeting-20260823:item-4:v1
```

Important rules:

- retry the same logical mutation with the same idempotency key;
- do not change the key merely because the agent retried after a transport timeout;
- do not reuse a key for a different canonical payload;
- do not put secrets or full sensitive narrative into the key.

## 11. Optimistic concurrency

Where the MCP registry marks `concurrencyToken = required`, the agent must supply the current version token from an authoritative prior BTPM read.

Typical pattern:

```text
1. btpm_get_<object>
2. retain updatedAt/version token
3. formulate proposed change
4. obtain confirmation
5. call mutation with expectedUpdatedAt
6. on stale result: re-read and ask/reconcile
```

The MCP adapter does **not** manufacture, refresh or replace stale version tokens and does not automatically retry a write with a newly fetched token.

This is important for safe agent behavior: a stale result means another actor may have changed the object, so the agent must reconsider the intended mutation.

## 12. Conditional business-state outcomes

Several operations deliberately expose business states that must **not** be flattened into generic MCP errors.

### Phase Create

Possible specialized outcomes include:

- `phase_dates_required` — a baselined Project requires planned dates;
- `project_window_extension_required` — requested Phase dates require explicit Project-window extension.

`project_window_extension_required` is not the same as ordinary MCP `confirmation_required`.

### Task Create

Specialized outcomes include:

- `task_dates_required`;
- `phase_window_extension_required`.

### Phase Planning

A Phase planning call can return:

- ordinary tool `confirmation_required` before execution when the mutation was not confirmed;
- business `project_window_extension_required` after the canonical writer evaluates the planning window;
- `stale_phase_planning` when the supplied version is stale.

The bounded parent-window detail object contains only the accepted planning fields; it does not disclose internal tenant/auth/database metadata.

### Task Planning

Equivalent distinctions exist for:

- ordinary MCP `confirmation_required`;
- business `phase_window_extension_required`;
- `stale_task_planning`.

### Project Transition

This operation has three especially important control layers:

1. **MCP transport confirmation** — no writer execution until the user confirms the mutation.
2. **Completion soft warnings** — canonical business result `completion_soft_warnings`. This remains a bounded business payload and requires an intentional follow-up with warning confirmation.
3. **Completion hard block** — canonical `completion_hard_blocked`. This remains a business result; the agent must surface the blockers instead of treating it as a generic API failure.

A stale Project transition remains a distinct `stale_project` conflict.

The agent must never automatically set the business warning confirmation simply because the user confirmed the original transition attempt.

### Task Transition and reopen

A completed Task is locked against ordinary Task transition. The MCP result can be `task_reopen_required`.

The tool does not automatically:

- reopen the Task;
- change another field first;
- fetch a fresh token and retry;
- invoke a hidden second mutation.

Reopen remains a separate BTPM business flow.

## 13. No automatic parent mutation

When a Phase/Task operation reports that a parent planning window would need extension, the MCP adapter does not silently extend the parent.

The safe agent interaction is:

```text
"The Task dates exceed the current Phase window. The required Phase target end
would become 30 September. Do you want to extend the Phase window?"
```

Only after the intended approval should the agent perform the separately allowed action according to the canonical contract.

This preserves user intent and avoids hidden multi-object writes.

## 14. Bounded error/result model

MCP maps failures to bounded categories/messages. Examples include:

```text
invalid_arguments
not_authorized
rate_limited
unavailable
confirmation_required
idempotency_conflict
idempotency_pending
stale_* / concurrency-related categories
```

Domain-specific tools add the bounded conditional states described above.

MCP output must not reveal:

- SQLSTATE/database error detail;
- service-role credentials;
- raw bearer tokens;
- stack traces;
- hidden Tenant/Organization/Workspace authority internals;
- current database timestamps merely to help an agent bypass a stale write.

## 15. Recommended agent orchestration pattern

For a general BTPM Copilot/agent, use this pattern:

### A. Establish identity and context

```text
btpm_get_me
  -> btpm_choose_project (when useful)
  -> or list Organizations -> Workspaces -> Projects
```

### B. Read before proposing writes

For updates/transitions, fetch the current object first. For creates/appends, validate the parent context first.

### C. Convert external information into a proposal

If the agent reads M365/email/meeting content and identifies candidate Risks, Blockers or Execution Updates:

- present the extracted items;
- compare against existing BTPM objects to avoid obvious duplicates;
- do not write unapproved candidate items;
- explain important mapped fields/vocabularies.

### D. Obtain explicit approval

Confirmation should apply to a clearly stated mutation, not an open-ended instruction to modify BTPM arbitrarily.

### E. Execute once

Use a deterministic idempotency key and the current concurrency token where applicable.

### F. Handle conditional outcomes

Surface parent-window requirements, completion warnings/blocks, reopen requirements or stale state. Do not auto-repair them.

### G. Verify

Read the resulting object if the workflow requires confirmation/reconciliation.

## 16. Example agent flow: create a Risk from meeting evidence

A safe conversational sequence is:

```text
Agent: I found a potential Project risk in the meeting notes:
       "Finance SME availability may delay design sign-off."
       Proposed BTPM Risk:
       - target: Project <name>
       - title: Finance SME availability
       - likelihood: medium
       - impact: high
       - status: open
       - mitigation: Backfill critical workshops
       Create it?

User: Yes.

Agent:
  1. resolves the selected Project and existing risks;
  2. verifies an equivalent Risk is not already present where practical;
  3. calls btpm_create_risk with confirmation=true and a deterministic
     idempotencyKey;
  4. reports the bounded result.
```

The agent must not spoof Project/Tenant scope in the tool arguments; BTPM derives/validates canonical scope.

## 17. Example agent flow: update a Project

```text
1. btpm_get_project(projectId)
2. read updatedAt + current metadata
3. propose exact patch
4. user confirms
5. btpm_update_project(
     projectId,
     expectedUpdatedAt=<read token>,
     ...desired mutable fields,
     confirmation=true,
     idempotencyKey=<stable key>
   )
6. if stale_project/concurrency state -> re-read and reconcile with user
```

Do not automatically refresh the token and replay the same overwrite.

## 18. Example agent flow: Salesforce-originated Portfolio via MCP

REST is generally the cleaner interface for deterministic MuleSoft synchronization, but an MCP-capable orchestration agent can create a Portfolio too.

Agent-side mapping must use exact canonical values:

```text
lifecycleState = development
strategicPriority = high
```

Then invoke:

```text
btpm_create_portfolio
```

with the Organization ID, mapped business fields, explicit mutation confirmation and stable idempotency key.

For unattended Salesforce event synchronization, prefer REST/middleware unless a separately governed agent execution model is intentional; MCP's mutation confirmation semantics are designed around an agent/user decision boundary.

## 19. Microsoft 365 Copilot / Copilot Studio onboarding

At a high level:

1. Register/configure the approved OAuth client for the BTPM MCP resource.
2. Configure the MCP server endpoint and delegated authorization.
3. Ensure the BTPM Connected App maps to the same signed OAuth `client_id`.
4. Ensure the active policy version is acknowledged by the test user.
5. Grant/enable only required capabilities and scopes.
6. Ensure required Projects are enabled for the Connected App.
7. Connect/test with one known user.
8. Validate `btpm_get_me` and Organization/Workspace/Project discovery.
9. Validate `tools/list` contains the intended exposed surface.
10. Validate one read-only project flow.
11. Validate one controlled mutation with confirmation/idempotency.
12. Validate a stale-write conflict and disabled-Project negative case.
13. Only then expand the agent instructions to broader orchestration.

See [SECURITY_AND_ADMINISTRATION.md](./SECURITY_AND_ADMINISTRATION.md) for the full production checklist.

## 20. Agent prompt/instruction design recommendations

An agent that uses BTPM should be instructed to:

- always resolve the target BTPM object/context before mutation;
- never claim success unless the tool result succeeded;
- never use unapproved extracted findings as write instructions;
- never duplicate an existing object when the existing object should be updated instead;
- respect exact BTPM vocabularies;
- obtain explicit confirmation for each mutation intent;
- preserve idempotency across retries;
- re-read/reconcile on concurrency conflicts;
- surface business warnings/blocks instead of bypassing them;
- never perform hidden parent extension or Task reopen;
- keep sensitive source content out of logs/idempotency keys;
- use bounded pagination rather than attempting to download an entire tenant.

## 21. MCP change-control rule

MCP exposure is intentionally explicit. A future canonical REST operation must receive a deliberate MCP registry exposure decision and an explicit executor before it is callable. Agent builders should not assume that a REST capability automatically appears in `tools/list`, and should not rely on undocumented tool names.