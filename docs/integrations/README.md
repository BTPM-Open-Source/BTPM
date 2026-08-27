# BTPM Integration Capabilities

This directory is the practical integration guide for the two supported BTPM machine-integration surfaces:

- **BTPM REST API v1** — conventional HTTPS API for systems such as MuleSoft, Salesforce middleware, scripts, ETL/orchestration platforms and custom applications.
- **BTPM MCP** — Model Context Protocol adapter for agentic clients such as Microsoft 365 Copilot / Copilot Studio and other MCP-capable clients.

The two surfaces are deliberately related but not interchangeable. MCP is an adapter over the same canonical BTPM operations; it is not a second business-logic implementation and it does not have a separate authorization model.

## Documentation map

| Document | Use it for |
|---|---|
| [REST_API.md](./REST_API.md) | REST endpoint, authentication, request controls, pagination, errors, operation families and examples. |
| [MCP.md](./MCP.md) | MCP endpoint, OAuth protected-resource behavior, tools, confirmation, concurrency and agent orchestration. |
| [CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md) | Current operation-by-operation crosswalk between REST and MCP. This is the quickest inventory of what is callable. |
| [SECURITY_AND_ADMINISTRATION.md](./SECURITY_AND_ADMINISTRATION.md) | Connected App onboarding, delegated identity, policy acknowledgement, enablement, containment, rate limiting, encryption and production validation. |
| [BTPM_API_V1_OPENAPI.yaml](../api/BTPM_API_V1_OPENAPI.yaml) | Current machine-readable OpenAPI 3.1 contract for the REST v1 surface. |

## Which interface should an integrator use?

Use **REST API v1** when the caller is a deterministic application or middleware flow and you want explicit HTTP requests, retries, mapping, scheduling and transactional integration logic. Typical examples are MuleSoft, Salesforce integration flows, ERP middleware and custom services.

Use **MCP** when the caller is an AI/agent client that should discover tools and invoke BTPM capabilities conversationally. MCP adds agent-facing schemas and mutation confirmation, but the underlying BTPM authorization and business rules remain canonical API/PMG rules.

A common architecture is:

```text
Salesforce / ERP / other source
          |
          v
      MuleSoft
          |
          | HTTPS + delegated-user OAuth token
          v
   BTPM REST API v1
          |
          v
canonical BTPM authorization + PM business commands + persistence
```

For an agent:

```text
Microsoft 365 Copilot / MCP client
          |
          | Streamable HTTP + delegated-user OAuth token
          v
       BTPM MCP
          |
          v
canonical BTPM API adapters / authorization / PM business commands
```

## Identity model: important limitation

The currently implemented integration identity is **delegated-user OAuth**. BTPM does **not** currently expose a `client_credentials` machine-to-machine identity model, static API keys, service-role credentials or generic database access as integration mechanisms.

A middleware platform therefore cannot simply authenticate as an autonomous BTPM machine principal. Any proposed unattended pattern using a dedicated BTPM user and refresh token must still comply with BTPM governance for delegated users and Connected Apps; it should not be treated as equivalent to a formally approved service-account / machine-identity architecture.

## Canonical security model

For protected operations, successful possession of a bearer token is only the first layer. Effective execution is constrained by server-side controls including:

1. API/MCP runtime switches.
2. Valid delegated-user token and current BTPM session/user.
3. Signed OAuth `client_id` mapped to an active BTPM Connected App.
4. Active Connected App policy version and current user acknowledgement.
5. Capability/operation enablement and applicable Connected App scope.
6. Tenant, Organization and Workspace containment.
7. Project-level Connected App enablement where Project-scoped execution requires it.
8. Delegated user authority/RLS.
9. Canonical BTPM business rules.
10. Mutation controls such as idempotency and optimistic concurrency where applicable.

Scope, actor and provenance are derived server-side. Callers do not provide trusted Tenant/Organization/Workspace authority, actor identity, source channel or service-role context.

## Current operation surface

The current canonical source advertises **50 REST operations**:

- **24 reads/context operations**;
- **26 mutations**.

MCP has an explicit exposure decision for every one of those operations:

- **48 canonical operations are exposed as MCP tools**;
- `version.get` and `capabilities.get` are intentionally **not exposed** through MCP;
- `btpm_choose_project` is an additional MCP Project Selector/bootstrap tool and is **not** a canonical REST `operationId`.

See [CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md) for the complete crosswalk.

## Source-of-truth rules

These integration guides are explanatory documentation. When implementation and prose ever disagree, the following repository sources are authoritative in this order for the live surface:

1. `supabase/functions/_shared/btpm-api/routes/capabilities.ts` — canonical operation inventory.
2. `supabase/functions/_shared/btpm-api/routes/allowlist.ts` and individual route modules — method, path and read/mutation classification.
3. `supabase/functions/btpm-mcp/mcp/toolRegistry.ts` — MCP exposure, tool names, confirmation, result shape and concurrency requirement.
4. Individual REST route parsers and MCP tool schemas/executors — exact request/argument validation and bounded outputs.
5. Canonical delegated readers/writers and database commands — authorization, containment, persistence and business rules.

### OpenAPI status

`docs/api/BTPM_API_V1_OPENAPI.yaml` is the machine-readable companion to these integration guides and is suitable for API discovery, tooling import, request-shape generation and integration design. The live `capabilities.ts`, allowlist and strict route/body parsers remain authoritative if implementation and generated documentation ever drift.

The OpenAPI request contracts are intentionally strict. Read and mutation response schemas are conservative where the live delegated readers/writers return bounded domain-specific projections; integrations should use the documented request contract and live response fields rather than infer new write authority from response-only fields.

## Quick integration sequence

A new integrator should normally proceed in this order:

1. Have a BTPM administrator create/activate the Connected App and configure its OAuth client identity.
2. Complete the delegated-user authorization and current policy acknowledgement flow.
3. Grant/enable only the required BTPM operations and scopes.
4. For Project-scoped operations, ensure the target Project is enabled for the Connected App.
5. Validate identity with `GET /v1/me` (REST) or `btpm_get_me` (MCP).
6. Discover Organizations, then Workspaces, then Projects rather than hard-coding scope IDs unless the integration has an approved stable mapping.
7. Prove a read-only use case.
8. For mutations, add idempotency, explicit concurrency handling where required and application-level retry rules that never bypass BTPM conflicts.
9. Run positive and negative authorization/containment tests before production use.
10. Record the external-system-to-BTPM identifier mapping required for reconciliation.

## Example: Salesforce Portfolio Item mirrored into BTPM

For a MuleSoft flow triggered by creation of a Salesforce Portfolio Item, the normal BTPM-side sequence is:

1. Resolve the target BTPM Organization and confirm the Connected App/user can access it.
2. Map Salesforce fields to the canonical Portfolio vocabulary.
3. Call `POST /v1/portfolios` with a new unique `Idempotency-Key` for that Salesforce event/object version.
4. Persist the returned BTPM Portfolio identifier against the Salesforce source record or in an integration mapping store.
5. On later Salesforce changes, read the current BTPM Portfolio first, retain its `updatedAt`/version token, then call `PATCH /v1/portfolios/{portfolioId}` with `expectedUpdatedAt`.
6. Treat a concurrency conflict as a reconciliation event; do not automatically fetch a new version token and overwrite a newer BTPM change.

The REST guide contains the concrete request pattern and Portfolio vocabulary.
