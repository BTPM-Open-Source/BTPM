# API-C — Client Policy and Business-Consent Substrate Contract

## 1. Status and Scope

**API-C objective:** freeze the data contract and governance posture for the client-policy and business-consent substrate before any schema, code, or runtime work.

**API-C.1 outcome:** this document is the sole approved deliverable for the step. It binds all later API-C schema migrations and must be treated as the source of truth for table shape, access posture, and sequencing.

**What API-C.1 does NOT do:**
- Create, alter, or drop any database object, table, index, trigger, policy, or function.
- Modify application code, tests, generated types, migrations, Supabase configuration, runtime state, release metadata, or dependencies.
- Introduce consent UX, external API behavior, OAuth server/provider enablement, client registration, redirect URI registration, JWT-key change, secret creation, or Custom Access Token Hook.
- Seed, register, or authorize any client, organization, workspace, or user.

## 2. Binding Inputs

- Accepted API-A.2 architecture contract.
- Accepted API-A.3 responsibility matrix.
- Accepted API-A.4 sequencing / threat matrix.
- Accepted API-B isolated OAuth 2.1 Authorization Code + PKCE S256 capability proof.
- Existing BTPM hierarchy: Platform → Tenant → Organization → Workspace.
- Phase 4B encryption / protected-handling rules: any later sensitive field addition requires encryption before storage or read paths are introduced.

## 3. Frozen API-C Data Model

### 3.1 `public.api_clients`

- **Purpose:** Platform-level stable registry of approved external client identities.
- **Columns:**
  - `id` — UUID primary key, default `gen_random_uuid()`.
  - `client_key` — stable lowercase identifier, unique, non-secret, human-readable technical key.
  - `oauth_client_id` — nullable unique lowercase identifier for the non-secret, provider-issued OAuth client identifier. No secret, token, code, or redirect URI state.
  - `display_name` — human-facing name.
  - `description` — optional non-sensitive description.
  - `lifecycle_status` — e.g. `draft`, `active`, `suspended`, `retired`.
  - `created_by`, `updated_by` — UUID references to `auth.users` where applicable.
  - `created_at`, `updated_at` — timestamps with time zone, default `now()`.
- **Constraints:** unique `client_key`; unique nullable `oauth_client_id`.
- **Rules:**
  - No secret, token, authorization code, refresh token, key material, redirect URI registration state, or technical-grant state.
  - No rows are seeded in API-C.

### 3.2 `public.api_client_policy_versions`

- **Purpose:** immutable/versioned business-policy metadata per API client.
- **Columns:**
  - `id` — UUID primary key, default `gen_random_uuid()`.
  - `api_client_id` — FK to `public.api_clients(id)`.
  - `version` — stable version label.
  - `policy_uri` — non-sensitive URI to the canonical policy document.
  - `policy_digest` — lowercase SHA-256 hex digest of the policy document at time of registration.
  - `lifecycle_status` — e.g. `draft`, `active`, `retired`.
  - `effective_at`, `retired_at` — optional timestamps.
  - `created_by`, `updated_by`, `created_at`, `updated_at`.
- **Constraints:**
  - Unique `(api_client_id, version)`.
  - Unique `(api_client_id, policy_digest)`.
  - Partial unique index enforcing at most one `active`/`current` version per `api_client_id`.
- **Rules:**
  - API-C does not store policy document text, credentials, or token state.
  - Policy URI, digest, and version are deliberately non-sensitive control metadata.

### 3.3 `public.api_organization_client_enablements`

- **Purpose:** explicit BTPM business enablement of a client for one Organization.
- **Columns:**
  - `id` — UUID primary key.
  - `tenant_id` — FK to the tenant resolver.
  - `organization_id` — FK to the owning Organization.
  - `api_client_id` — FK to `public.api_clients(id)`.
  - `lifecycle_status` — enabled/disabled lifecycle field.
  - `reason` — optional non-sensitive business reason.
  - `created_by`, `updated_by`, `created_at`, `updated_at`.
- **Constraints:** unique `(organization_id, api_client_id)`.
- **Rules:**
  - Trigger or check must derive and enforce Organization → Tenant consistency.
  - This record never substitutes for user membership, policy acknowledgement, capability grant, or OAuth technical grant.

### 3.4 `public.api_workspace_client_enablements`

- **Purpose:** explicit allow/disable record for one Workspace and client.
- **Columns:**
  - `id` — UUID primary key.
  - `tenant_id` — FK to the tenant resolver.
  - `organization_id` — FK to the owning Organization.
  - `workspace_id` — FK to the Workspace.
  - `api_client_id` — FK to `public.api_clients(id)`.
  - `lifecycle_status` — enabled/disabled lifecycle field.
  - `reason` — optional non-sensitive business reason.
  - `created_by`, `updated_by`, `created_at`, `updated_at`.
- **Constraints:** unique `(workspace_id, api_client_id)`.
- **Rules:**
  - Trigger or check must enforce Workspace → Organization → Tenant consistency.
  - Absence of an enabled row means not allowed when Workspace scoping is required.
  - Organization enablement does not automatically expose every Workspace.

### 3.5 `public.api_user_policy_acknowledgements`

- **Purpose:** record user acknowledgement of a specific client policy version, separate from OAuth technical grant state.
- **Columns:**
  - `id` — UUID primary key.
  - `user_id` — FK to `auth.users(id)`.
  - `api_client_id` — FK to `public.api_clients(id)`.
  - `policy_version_id` — FK to `public.api_client_policy_versions(id)`.
  - `acknowledged_at` — timestamp of acknowledgement.
  - `revoked_at` — optional revocation timestamp.
  - `ack_metadata` — safe non-sensitive acknowledgement metadata (e.g. source IP hash, user-agent family).
  - `created_at`.
- **Constraints:** unique `(user_id, api_client_id, policy_version_id)`.
- **Rules:**
  - Integrity must enforce that the policy version belongs to the same `api_client_id`.
  - No Organization or Workspace authority is inferred from acknowledgement.
  - No direct authenticated insert/update in API-C; API-D will add protected acknowledgement flows.

### 3.6 `public.api_capability_grants`

- **Purpose:** explicit allowlist entry per client + Organization, optionally narrowed to a Workspace.
- **Columns:**
  - `id` — UUID primary key.
  - `tenant_id` — FK to the tenant resolver.
  - `organization_id` — FK to the owning Organization.
  - `workspace_id` — optional FK to the Workspace; NULL means Organization-level.
  - `api_client_id` — FK to `public.api_clients(id)`.
  - `api_version` — API version string, e.g. `v1`.
  - `capability_kind` — enum or check: `read` or `command`.
  - `capability_key` — stable capability key such as `project:read`, `task:command`.
  - `lifecycle_status` — enabled/disabled lifecycle field.
  - `reason` — optional non-sensitive business reason.
  - `created_by`, `updated_by`, `created_at`, `updated_at`.
- **Constraints:**
  - Unique `(organization_id, api_client_id, api_version, capability_key)` where `workspace_id IS NULL`.
  - Unique `(workspace_id, api_client_id, api_version, capability_key)` where `workspace_id IS NOT NULL`.
- **Rules:**
  - Trigger or check must enforce Organization → Tenant and optional Workspace → Organization consistency.
  - Capability provenance is not authority; no generic CRUD/RPC capability may exist.

## 4. Security and Runtime Posture

- **Schema discipline:** all six tables use additive schema only, UUID primary keys, foreign keys, appropriate indexes, `updated_at` triggers where mutable, and Row Level Security enabled.
- **Inert substrate access:**
  - Revoke direct access from `anon` and `authenticated`.
  - Grant table access only to `service_role`.
  - No authenticated RLS policy or browser caller is introduced in API-C.
- **No exposed surface:** API-C introduces no RPC, Edge Function, route, React hook, page, or external API endpoint.
- **Later phases:** API-D and API-E may introduce protected functions or flows that read this substrate, but only under their own approved governance gates.
- **Unchanged systems:** existing email/password and Microsoft sign-in, invitation redemption, routes and guards, tenant and workspace authorization, Project Mutation Gateway (PMG), encryption subsystem, and all ordinary UI behavior remain unchanged.
- **No activation:** no OAuth server/provider enablement, client registration, redirect URI registration, JWT-key change, secret creation, or production activation.
- **No seed rows:** no clients, policies, enablements, acknowledgements, or capability grants are inserted in API-C.
- **No Custom Access Token Hook.**

## 5. Encryption Classification

- All stored fields are identifiers, status/lifecycle fields, hashes, timestamps, or explicitly non-sensitive control metadata.
- No confidential business payload, policy document body, personal narrative, secret, token, credential, ciphertext-as-text, or key material is stored.
- If later phases add sensitive fields, Phase 4B encryption is mandatory before any storage or read path is introduced.

## 6. Numbered API-C Execution Plan

1. **API-C.1:** freeze this contract (this document).
2. **API-C.2:** additive migration for `api_clients` and `api_client_policy_versions`, plus focused static tests.
3. **API-C.3:** additive migration for `api_organization_client_enablements` and `api_workspace_client_enablements`, with scope-integrity triggers and focused tests.
4. **API-C.4:** additive migration for `api_user_policy_acknowledgements` and `api_capability_grants`, with integrity triggers and focused tests.
5. **API-C.5:** API-C evidence record and full-phase closure audit.

## 7. Rollback

- Each schema step remains unreferenced by runtime and can be rolled back in reverse dependency order.
- Rollback must not modify existing authentication, PMG, business tables, encryption keys, or runtime configuration.
- Because the substrate is inert, removal does not affect current application behavior.

## 8. Do Not Claim or Perform

- Do not implement schema, code, tests, generated types, migrations, or runtime configuration in this step.
- Do not invent consent UX, external API behavior, OAuth flows, or client onboarding flows.
- Do not claim that any client, policy, enablement, acknowledgement, or capability grant is active or authorized.
- Do not ask Lovable to validate or audit its own work.
