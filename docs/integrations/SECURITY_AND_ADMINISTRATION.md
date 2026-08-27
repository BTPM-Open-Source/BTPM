# BTPM Integration Security and Administration

This guide is for BTPM administrators, integration architects and IT teams responsible for enabling REST API or MCP access safely.

It explains the control model around Connected Apps, delegated OAuth identity, policy acknowledgement, scope/Project enablement, rate limiting, containment, encryption and production validation.

## 1. Security model at a glance

BTPM integrations are not authorized by a single API key or by possession of a valid OAuth token alone.

Effective access is layered:

```text
runtime availability
  -> delegated OAuth token validation
  -> current BTPM user/session
  -> signed OAuth client_id
  -> active BTPM Connected App
  -> active Connected App policy version
  -> current user acknowledgement of that policy version
  -> capability/operation authorization
  -> Tenant/Organization/Workspace containment
  -> Project Connected App enablement where required
  -> delegated user authority/RLS
  -> canonical BTPM business rules
  -> mutation controls (idempotency/concurrency/etc.)
```

Failure at a layer is fail-closed. An integration should never be designed around bypassing one layer with another.

## 2. Delegated user identity

The current supported integration identity is **delegated-user OAuth**.

BTPM does not currently define the following as supported external integration identities:

- OAuth `client_credentials` machine identity;
- static API keys;
- Supabase service-role credentials;
- direct database credentials;
- caller-selected BTPM user IDs;
- generic backend RPC/table access.

This matters for unattended middleware. A MuleSoft or backend job still needs an approved delegated-user authorization arrangement under the current model. If the business requires a true non-human integration principal, that should be treated as a separate architecture/governance enhancement rather than improvised with a service-role secret.

## 3. OAuth token trust boundary

The API/MCP server validates signed token claims and confirms the current authenticated BTPM user/session.

Key rules:

- bearer token must be current and cryptographically valid;
- expected issuer is the BTPM Supabase Auth issuer;
- audience must match the target protected resource where required;
- `sub` must correspond to the current user/session;
- `client_id` is taken only from the signed token claim;
- client identity is never accepted from request JSON, query string, MCP arguments or an arbitrary header.

For MCP, the access token audience must match the canonical MCP resource URI. A token valid for another audience does not automatically authenticate to MCP.

## 4. Connected App lifecycle

A BTPM Connected App represents an approved external OAuth client/integration application.

An administrator should establish, at minimum:

1. the external OAuth client registration;
2. the BTPM Connected App record tied to the signed OAuth `client_id`;
3. an active Connected App lifecycle state;
4. an active policy version;
5. the required operation/capability grants and scope controls;
6. any required Project enablements;
7. the intended rate-limit profile;
8. authorized test users and acknowledgement flow.

A disabled/suspended/retired client must not remain operational merely because old user tokens exist.

## 5. Policy version and user acknowledgement

BTPM resolves the active policy version for the Connected App and requires the delegated user to have acknowledged that exact active version.

The authorization layer fails closed when:

- there is no active policy version;
- active policy state is ambiguous;
- acknowledgement is missing;
- acknowledgement is for an older/stale version;
- acknowledgement has been revoked.

Changing the active policy version can therefore require users to acknowledge the new version before the integration becomes usable again.

### Operational implication

When users suddenly receive authorization failures after a governance/policy change, check policy-version acknowledgement before assuming the API/MCP implementation is broken.

## 6. Capability and operation authorization

`GET /v1/capabilities` is the **implemented API inventory**, not a per-client permission listing.

An operation can exist in the product and still be unavailable to a particular integration because of:

- Connected App capability configuration;
- scope restrictions;
- Project enablement;
- delegated user access;
- runtime switches;
- canonical business rules.

Use [CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md) to understand what the product implements, but use Connected App governance and real negative/positive tests to prove what a specific client/user can execute.

## 7. Tenant, Organization, Workspace and Project containment

BTPM derives authoritative scope server-side.

External callers must not be trusted to select privileged Tenant/Organization/Workspace scope just by supplying IDs. Object relationships and canonical authority checks determine whether a target belongs to the user's permitted context.

Security testing must include attempts to cross:

- Workspace boundaries;
- Organization boundaries;
- Tenant boundaries where distinct test contexts exist;
- Project enablement boundaries;
- object attachment boundaries (for example, a Risk stored against a Project outside the caller's authority).

An object identifier is not an authorization token.

## 8. Project-level Connected App enablement

Project-scoped integrations have an additional practical control: the Project may need to be explicitly enabled for the Connected App.

This has two important consequences:

1. `GET /v1/projects?workspace_id=...` can omit a Project the user can see in the BTPM UI if that Project is not enabled for the Connected App.
2. `projects.create` does **not** automatically enable the newly created Project for the Connected App.

After an integration creates a new Project, an administrator may need to enable it before subsequent Project-scoped integration operations become available.

Do not "fix" this by automatically enabling every newly created Project inside middleware. Project enablement is a governance decision.

## 9. Caller-bound business data access

Business API/MCP operations execute in the delegated user's authority context.

The production design uses caller-bound clients for business reads/writes and keeps privileged service-role usage limited to infrastructure/governance functions. The service-role path is not an alternative business-data integration interface.

An administrator must never distribute the Supabase service-role key to:

- MuleSoft flows;
- Copilot agents;
- browser clients;
- external vendors;
- Postman collections shared outside the trusted server environment.

## 10. Service-role boundary

The accepted MCP architecture confines privileged service-role use to infrastructure purposes such as:

- Connected App / policy authorization;
- canonical rate-limit infrastructure;
- MCP connection-verification evidence where applicable.

It is not used to perform normal business reads/writes on behalf of integrations.

If future code introduces service-role business table reads/writes for an external integration, treat that as a security/architecture change requiring explicit review.

## 11. Encryption and sensitive data

BTPM's sensitive business fields use the protected tenant-versioned encryption model. The accepted encrypted format is tenant-versioned (`btpmenc:v1:t:*` in the current implementation family).

External API/MCP integrations should assume that:

- sensitive narratives may be encrypted at rest;
- canonical read/write wrappers are responsible for protected field handling;
- integrations must not bypass wrappers and write plaintext directly to protected database columns;
- integration logs should not replicate protected narratives unnecessarily;
- response/error contracts intentionally avoid leaking protected internal values.

The integration layer should pass only the business content required for the intended operation and should apply its own enterprise data-handling rules upstream as well.

## 12. Idempotency administration

Every mutation workflow must use an idempotency design appropriate to its source system.

### Good design

```text
source-system : object/event : source-id : source-version
```

Examples:

```text
salesforce:PortfolioItem:a01XX0000001234:v7
sap:wbs-budget-update:PRJ-10023:20260823T103000Z
copilot:risk-proposal:meeting-20260823:item-4:v1
```

### Bad design

```text
random-uuid-generated-on-every-retry
current-timestamp-only
full-sensitive-description
bearer-token-fragment
```

The same logical source mutation must retain the same idempotency key across transport retries.

## 13. Optimistic concurrency administration

For versioned updates, BTPM requires a caller-supplied current version token (`expectedUpdatedAt` or row-specific equivalent).

Integrators must be designed to handle stale state intentionally.

A recommended policy is:

```text
concurrency conflict
  -> stop automatic write loop
  -> fetch current BTPM object
  -> compare source/current BTPM state
  -> reconcile or obtain a new user/business decision
  -> issue a new intentional mutation with its own appropriate idempotency state
```

Do not configure middleware to auto-fetch the newest timestamp and force the same overwrite. That turns optimistic concurrency into last-writer-wins and defeats the control.

## 14. Rate limiting

BTPM uses a canonical atomic rate-limit path backed by server-side state. It is not an in-memory best-effort throttle.

Rate limiting is scoped to the relevant client/user/route subject according to the accepted BTPM profile configuration.

External integrations should:

- expect HTTP `429` / bounded MCP `rate_limited` outcomes;
- back off according to integration policy;
- avoid fan-out loops that issue one API call per row when a bounded collection/read can reduce traffic;
- avoid immediate tight retry loops;
- monitor repeated rate limiting as a capacity/design signal.

Changing a rate-limit profile is an administrative decision and should not be the first response to inefficient integration design.

## 15. Runtime switches and kill controls

The REST runtime includes explicit availability controls such as:

```text
BTPM_API_ENABLED
BTPM_API_READS_ENABLED
BTPM_API_MUTATIONS_ENABLED
```

and controlled allowed-origin configuration.

Fail-closed behavior is intentional: missing/malformed controls do not implicitly enable a surface.

Operational runbooks should document who may disable reads/mutations and how integrations should interpret `api_unavailable` / equivalent availability failures.

For MCP, resource/audience/origin/runtime configuration should likewise be environment-managed and not embedded in agent prompts.

## 16. CORS / Origin controls

Browser-originated access is constrained by allowed-origin configuration. Do not broaden CORS to `*` merely to make a test client work.

Server-to-server middleware such as MuleSoft typically does not rely on browser CORS, but OAuth redirect/consent and browser-based integration tooling still need correct environment-specific origins.

## 17. Request IDs, observability and logging

BTPM uses bounded non-sensitive request IDs and structured logging.

External integrations should log:

- BTPM request ID;
- operation name / endpoint;
- external source object/event ID;
- integration correlation ID if applicable;
- HTTP status / bounded result category;
- retry count / reconciliation state.

External integrations should **not** log:

- bearer tokens;
- refresh tokens;
- service-role keys;
- OAuth client secrets;
- raw database errors;
- full sensitive narrative content unless explicitly required and protected by the organization's logging controls.

A request ID is a diagnostic correlate, not an authorization credential.

## 18. Environment separation

Use separate configuration for DEV/QAS/Production where those environments exist.

At minimum separate:

- API base URL;
- MCP resource URL;
- OAuth client registration/client ID;
- redirect URIs;
- Connected App record/policy version;
- secrets/refresh-token storage;
- integration mapping stores;
- test data and Project enablements.

Do not point a test Copilot/MuleSoft flow at Production simply because the schema is identical.

## 19. Secret management

Store OAuth client secrets, refresh tokens and any upstream system credentials in an approved enterprise secret store.

Never store secrets in:

- BTPM documentation;
- GitHub Markdown examples;
- Copilot system prompts;
- Salesforce text fields;
- MuleSoft source code/properties committed in plaintext;
- browser local storage by deliberate integration design;
- idempotency keys or request IDs.

The examples in this documentation intentionally use placeholders only.

## 20. REST Connected App onboarding checklist

Before enabling a new REST integration:

1. Define the business purpose and exact operations required.
2. Register the OAuth client with approved redirect/authentication configuration.
3. Create/map the BTPM Connected App to that signed OAuth `client_id`.
4. Activate the correct Connected App policy version.
5. Ensure test user acknowledgement is current.
6. Grant only the minimum required capabilities/operations.
7. Configure Organization/Workspace/Project scope as required.
8. Enable only required Projects for the Connected App.
9. Assign an appropriate rate-limit profile.
10. Configure DEV/QAS endpoint and secret storage.
11. Validate `GET /v1/me`.
12. Validate Organization/Workspace/Project discovery.
13. Validate one read-only business operation.
14. Validate one idempotent mutation in non-production.
15. Validate a retry of the same mutation with the same idempotency key.
16. Validate idempotency conflict using same key/different canonical payload.
17. Validate concurrency conflict for a versioned mutation.
18. Run the negative security tests in §22.
19. Review logs for accidental sensitive data.
20. Document reconciliation/rollback/operational ownership before Production.

## 21. MCP / Microsoft 365 Copilot onboarding checklist

Before enabling an MCP agent:

1. Confirm the OAuth client is pre-registered/approved for the BTPM MCP resource.
2. Configure the MCP server URL for the correct environment.
3. Confirm protected-resource discovery works.
4. Confirm delegated token audience is the MCP resource URI.
5. Map the signed OAuth `client_id` to the intended BTPM Connected App.
6. Confirm active policy + user acknowledgement.
7. Apply minimum capability/scope/Project enablement.
8. Confirm the MCP connection initializes successfully.
9. Inspect `tools/list` and compare against [CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md).
10. Validate `btpm_get_me`.
11. Validate Organization → Workspace → Project discovery / Project Selector.
12. Validate previously required workspace-level reads such as Projects, Programs and Workspace Members.
13. Validate a Project-scoped read.
14. Validate a mutation that requires explicit confirmation.
15. Validate missing confirmation produces no writer execution.
16. Validate idempotent retry.
17. Validate stale concurrency behavior.
18. Validate a conditional domain outcome (for example planning-window extension) is surfaced, not auto-corrected.
19. Validate a disabled Project.
20. Run the negative security tests in §22 with distinct users/contexts where possible.

## 22. Required negative security tests

A production readiness exercise should explicitly prove failures, not only happy paths.

### Authentication / client governance

- no bearer token;
- malformed/invalid bearer token;
- expired token;
- wrong issuer/audience;
- valid user token with unknown/inactive Connected App client;
- missing active policy;
- missing acknowledgement;
- stale acknowledgement after policy version change;
- revoked acknowledgement.

### Scope and containment

- user authorized in Workspace A attempts object in Workspace B;
- user authorized in Organization A attempts Organization B;
- cross-Tenant attempt if separate test tenants exist;
- valid object ID outside caller authority;
- Project visible to user but not enabled for Connected App;
- child object structurally inconsistent with its canonical Project/Workspace scope (should fail closed rather than become externally readable).

### Mutation controls

- missing idempotency key;
- invalid idempotency key;
- same key + same payload replay;
- same key + different payload conflict;
- stale `expectedUpdatedAt`;
- unknown/extra JSON field;
- invalid enum alias/casing;
- mutation without MCP confirmation;
- parent-window extension requirement without business confirmation;
- Project completion soft warnings without explicit warning confirmation;
- completed Task transition requiring reopen.

### Disclosure

Verify failures do not reveal:

- SQLSTATE;
- database messages;
- stack traces;
- service-role secrets;
- bearer/refresh tokens;
- internal policy IDs beyond what is explicitly part of a public contract;
- hidden Tenant/Organization/Workspace authorization detail.

## 23. Troubleshooting matrix

| Symptom | Likely areas to check |
|---|---|
| User can log into BTPM UI but API returns 403 | Connected App status, policy acknowledgement, capability/scope, Project enablement. |
| Project is visible in UI but absent from API/MCP list | Project-level Connected App enablement. |
| Everything stopped after policy update | User acknowledgement may now be stale/missing for new active version. |
| MCP authenticates but tool calls are unavailable | MCP tool exposure, capability/scope, Connected App authorization, Project enablement. |
| 409 on update | Stale `expectedUpdatedAt`; perform reconciliation. |
| 409 idempotency conflict | Reused key for a different canonical request. |
| Repeated 429 | Rate profile or inefficient call pattern/fan-out. |
| 400 after middleware mapping | Closed schema, wrong casing/alias, invalid enum, unknown key. |
| New Project created but next Project call fails | Project create does not auto-enable Connected App access. |
| Task transition says reopen required | Completed Task must use the dedicated BTPM reopen flow; do not auto-retry transition. |
| Planning operation requests parent extension | Domain confirmation is required; do not silently widen parent schedule. |

## 24. Integration ownership model

For each production integration assign owners for:

- BTPM Connected App governance;
- OAuth registration/secrets;
- source-system mapping;
- BTPM vocabulary mapping;
- middleware/agent code;
- monitoring and incident response;
- idempotency/reconciliation store;
- user/access lifecycle;
- policy acknowledgement changes;
- Production Project enablement;
- change/release testing.

Without explicit ownership, expired acknowledgements, stale mappings and Project enablement changes can appear as unexplained integration failures.

## 25. Production acceptance record

For a material production integration, record at least:

- environment and BTPM release/SHA tested;
- OAuth client ID (not secret);
- BTPM Connected App identifier/name;
- active policy version reference;
- authorized operation set;
- Organization/Workspace/Project scope;
- rate-limit profile;
- positive UAT cases;
- negative containment/security cases;
- idempotency and concurrency evidence;
- external-ID mapping strategy;
- recovery/reconciliation procedure;
- business and IT owner approval.

## 26. Architecture invariants that must trigger review if changed

Treat the following as material integration/security architecture changes requiring explicit review:

- introduction of machine-to-machine `client_credentials`;
- service-role business data reads/writes;
- generic RPC/CRUD/operation dispatcher;
- caller-selected Tenant/Organization/Workspace trusted scope;
- bypass of Connected App/policy acknowledgement;
- automatic Project enablement on Project create;
- removal/weakening of idempotency;
- automatic concurrency-token refresh/retry;
- automatic parent schedule extension;
- automatic Task reopen;
- unbounded list/export tool;
- MCP operation exposure becoming implicit instead of allowlisted;
- plaintext writes to fields governed by BTPM's protected encryption model.

These changes may be valid future product decisions, but they must not appear as incidental integration conveniences.