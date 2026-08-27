# API-D — Membership-Aware Consent UX Contract (Frozen)

**Status:** Documentation-only freeze. No runtime, schema, function, route, UI,
feature-flag substrate, audit table, test, workflow, dependency, or existing
document is changed by this step.

**Historical execution provenance:** internal repository identifiers and SHAs are omitted from the public distribution.
**Authorized phase:** API-D only. API-E and later phases are prohibited.

**Binding inputs**
- `docs/governance/api/API_A2_ARCHITECTURE_CONTRACT.md`
- `docs/governance/api/API_A3_CONSUMER_AND_RESPONSIBILITY_MATRIX.md`
- `docs/governance/api/API_A4_EXECUTION_AND_THREAT_MATRIX.md`
- `docs/governance/api/API_B_ISOLATED_OAUTH_CAPABILITY_PROOF.md`
- `docs/governance/api/API_C_CLIENT_POLICY_SUBSTRATE_CONTRACT.md`
- `docs/governance/api/API_C_CLIENT_POLICY_SUBSTRATE_EVIDENCE.md`

---

## 1. Objective

API-D delivers a feature-flagged BTPM consent/acknowledgement UX and the
protected server flows that record or revoke the currently authenticated BTPM
user's acknowledgement of a specific **current** client-policy version.

**Membership-aware** means eligibility is derived server-side from:
- the caller's current active, non-deactivated BTPM user status;
- authoritative active Organization and Workspace membership tables;
- API-C Organization and Workspace enablement rows for the resolved client.

Acknowledgement recorded through API-D is **business consent only**. It never
creates Organization or Workspace authority, capability authority, OAuth
authority, technical grant, token, session, or API access. It is not a proxy
for a signed OAuth grant and must never be treated as one.

---

## 2. Critical Phase Separation

API-D **must not**:
- enable or configure the Supabase OAuth 2.1 server or provider;
- register an OAuth client, a redirect URI, or a client secret;
- issue, exchange, store, or reference authorization codes, access tokens, ID
  tokens, or refresh tokens;
- change any JWT signing key or Custom Access Token Hook;
- introduce OAuth-session containment, signed-client verification middleware,
  Edge API authentication, external API endpoints, or PostgREST/RPC exposure
  to external consumers;
- activate OAuth in production.

Signed `client_id` verification and OAuth direct-bypass containment remain
**API-E** work.

Until API-E ships and is accepted, any non-secret client identifier used by
the feature-flagged consent page is **display/selection context only**. The
server must resolve it against `public.api_clients` before use; it is never
authority and must never be trusted as proof of an OAuth grant.

The API-D **feature flag defaults OFF**. No route or flow becomes externally
usable merely because repository code exists.

---

## 3. Authority and Scope Rules

- Every API-D read or write requires an authenticated, active, non-deactivated
  BTPM user resolved from `auth.uid()` server-side.
- Active-Organization UI preference and `profiles.organization_id` are **never
  authority**. They may be used only to prioritize display order, and only
  after server-side membership eligibility has been re-derived independently.
- All eligible Organizations and Workspaces are derived server-side from
  authoritative membership/status tables joined with the corresponding API-C
  enablement rows.
- **Organization enablement and Workspace enablement are separate policy
  layers.** Workspace exposure is not inferred from Organization enablement,
  matching the frozen API-C composition posture; API-D composition rules must
  cite `API_C_CLIENT_POLICY_SUBSTRATE_CONTRACT.md` §3 and its evidence-record
  clarification.
- A user may acknowledge only a **current/active** policy version belonging to
  the **resolved active client**, and only when at least one **eligible enabled
  Organization** context exists. Where a Workspace context is required by the
  client's policy scope, an **eligible enabled Workspace enablement row and
  current Workspace membership** are also required.
- Deactivated users, unassigned users, cross-tenant requests, cross-Organization
  requests, cross-Workspace requests, disabled clients, disabled/superseded
  policy versions, disabled enablements, and policy/client mismatches all
  **fail closed**.
- Responses and UX must never expose internal UUIDs of unauthorized objects,
  hidden memberships, or the existence of objects across unauthorized scopes.
  Fail-closed responses must be indistinguishable from "not applicable".

---

## 4. Protected Read/Write Design

API-D exposes **explicit protected functions only**. No generic CRUD, no
arbitrary RPC dispatcher, no PostgREST table access from browser roles.

**Read — consent-context function**
- Input: non-secret client key/identifier (display/selection context only).
- Server behavior: resolve `auth.uid()`, resolve the client against
  `api_clients`, derive eligible Organization/Workspace contexts and the
  current active policy version server-side.
- Returned data is limited to the safe display surface required by the
  consent page:
  - resolved client display name and public key;
  - current policy version, canonical URI, digest, and effective timestamp;
  - whether the current user already has a current, non-revoked
    acknowledgement of that exact version;
  - a safe display-only summary of eligible Organization/Workspace contexts,
    using authorized display names and counts only.
- Must **not** return tokens, secrets, raw policy body text, Organization,
  Workspace, Tenant, membership, enablement, or any other internal UUID,
  hidden internal UUIDs of unauthorized objects, unrelated memberships, or
  any object the caller is not eligible to see.
- The server uses the existence of at least one eligible context as an
  eligibility gate; the acknowledgement remains for the exact
  user/client/policy version. No Organization or Workspace selection is
  introduced into API-D.

**Write — acknowledge command**
- Records or upserts the current user's acknowledgement of the exact
  current policy version through a protected PMG-style command path.

**Write — revoke command**
- Sets revocation on the current user's exact acknowledgement of the exact
  current policy version through a protected PMG-style command path.

**Common function contract**
- All functions derive `auth.uid()` internally; no caller-supplied user ID.
- `SECURITY DEFINER` with fixed `SET search_path = public`.
- Explicit input validation and least-privilege `EXECUTE` grants (to
  `authenticated` only for the narrowly named API-D functions; never to
  `anon`).
- **No direct table `GRANT`s and no RLS policies exposing API-C tables to
  browser roles.** Existing API-C tables remain service-role-only outside the
  named API-D functions.
- Browser/UI code may call only the narrowly named protected API-D functions.

---

## 5. Audit and Evidence

- Each acknowledgement or revocation writes an **immutable** PMG-style audit
  row containing: actor user ID, resolved client ID, exact policy version ID,
  action (`acknowledge` | `revoke`), timestamp, `source_channel = 'btpm_ui'`,
  request/correlation identifier where available, and safe non-sensitive
  metadata only.
- Audit rows are append-only; no update or delete path from browser roles or
  from API-D functions.
- Consent is **never** inferable from technical grant, client registration,
  login event, membership row, Organization enablement row, Workspace
  enablement row, or capability grant. The audit substrate must make the
  separation between business consent and technical authority explicit.
- Negative tests introduced in later API-D steps must prove this separation
  and cross-scope fail-closed behavior.

---

## 6. UX and Login-Return Contract

- Feature-flagged consent route and page, **disabled by default**.
- Login return path preserves **only** a validated internal BTPM return path
  (per the API-B.1 `sanitizeReturnTo` posture) and a strictly validated
  non-secret authorization/client context through password or Microsoft
  login. Absolute or protocol-relative URLs are rejected.
- Never accept or redirect to an arbitrary external URL under any query
  parameter, referrer, or storage hint.
- The consent page shows:
  - resolved client name;
  - current policy version link and version identifier;
  - a concise permissions/meaning statement;
  - a summary of the eligible membership context that qualifies the user;
  - explicit **Approve** and **Deny** actions.
- **Deny** closes or returns from the consent UI without creating, retaining,
  revoking, or changing an acknowledgement. Deny creates no API-D
  consent-audit row in this phase.
- No internal UUIDs, raw token claims, secret material, or hidden
  tenant/workspace information is placed in UI, URL, logs, `localStorage`,
  `sessionStorage`, cookies, or any other browser storage.
- Ordinary email/password and Microsoft login, invitation redemption, route
  guards, existing routes, and non-consent UI behavior remain unchanged.

---

## 7. Encryption and Data Classification

- Only **non-sensitive control metadata** may be persisted in `ack_metadata`
  or audit metadata (e.g., resolved client key, policy version identifier,
  action, coarse timestamp, correlation identifier).
- **Prohibited from storage** in any API-D column, log, or audit row:
  - raw or excerpted policy document body;
  - confidential business data or personal narrative;
  - OAuth authorization codes, access tokens, refresh tokens, ID tokens;
  - client secrets or any key material;
  - raw IP address;
  - raw `User-Agent` string.
- If a later implementation requires sensitive content on a read or write
  path, that step must **stop** and apply the Phase 4B encryption rule before
  the storage or read path is added.

---

## 8. Rollback

- The API-D UX is disabled by turning the feature flag OFF; the route and
  components become unreachable to end users.
- Protected API-D functions and the API-D audit additions are independently
  removable in reverse dependency order (UI → functions → audit substrate →
  feature-flag substrate).
- Existing API-C acknowledgement rows remain **inert and non-authoritative**
  in every rollback state.
- Rollback must not modify existing authentication, PMG, business tables,
  encryption keys, API-C core tables, or ordinary UI paths.

---

## 9. Numbered API-D Implementation Plan (Frozen)

- **API-D.1** — this documentation-only contract freeze. No code, schema,
  test, workflow, or existing document change.
- **API-D.2** — additive protected membership-aware consent-context read
  function(s), feature-flag substrate if needed, and focused static and
  database tests. No UI.
- **API-D.3** — additive protected acknowledge and revoke commands plus the
  immutable consent audit substrate and focused tests. No UI.
- **API-D.4** — feature-flagged consent page and components and safe
  login-return preservation wired **only** to the protected API-D functions
  from API-D.2 and API-D.3. Feature flag remains OFF by default.
- **API-D.5** — API-D evidence record and full-phase closure preparation.
  No new runtime capability is introduced.

**Mandatory execution rules for each of API-D.2 through API-D.5:**
- exactly one bounded implementation prompt;
- both same-SHA GitHub gates (`repository-settlement/ready` and
  `repository-validation/ready`) must succeed on the same commit SHA;
- independent full-diff review before acceptance;
- **at most one** automatic correction per step.

API-E and later phases remain prohibited until API-D closure is accepted.

---

## 10. Explicit Unchanged Behavior

This step changes no code, no migration, no generated types, no test, no
workflow, no package or dependency, no Supabase configuration, no auth or
OAuth configuration, no route, no UI, no feature flag, no runtime state, no
database object, no grant, no RLS policy, no secret, and no existing
document. It adds exactly one new documentation file at the path in the
report below.
