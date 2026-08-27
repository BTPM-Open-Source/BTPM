# BTPM Email Transport — Canonical Model

Phase 4D.14A.7H lock. This document is the source of truth for how BTPM edge
functions send email. Any new email-sending code must comply.

## Transport layers

| Layer | Module | Purpose |
|---|---|---|
| `sendTenantEmail` | `supabase/functions/_shared/tenantOutboundEmail.ts` | Canonical BTPM business notification transport. Resolves tenant SMTP from `organization_id`, enforces the `outbound_email` environment gate, applies duplicate-suppression, and writes `outbound_email_events` audit rows. |
| `sendAuthEmail` | `supabase/functions/_shared/authOutboundEmail.ts` | Organization-scoped Tenant SMTP wrapper for auth-adjacent emails (invitations, Organization-resolved custom password-reset). Requires `organizationId`; delegates to `sendTenantEmail`. No fallback transport. |
| Supabase Auth mail (native) | Supabase Auth — configured in the Supabase dashboard | Platform account-recovery transport (`supabase.auth.resetPasswordForEmail`) and other native Supabase Auth messages. Used by BTPM code only when no unambiguous Organization can be resolved for a password-reset request. |

Microsoft Graph mail transport — **retired**. BTPM code no longer sends any
email through Microsoft Graph. `graphMail.ts` is deleted; `M365_SENDER_EMAIL`
and `M365_SENDER_NAME` are runtime-unused.

## Allowed callers

- **`sendTenantEmail`** — every BTPM business notification. Current callers:
  `send-test-email`, `send-object-email`, `send-team-work-reminders`,
  `process-notifications`. Any future assignment/reminder/notification email
  MUST use this helper.
- **`sendAuthEmail`** — Organization-scoped auth-adjacent flows only.
  Current callers: `invite-user`, `send-password-reset` (Tenant branch).
- **Supabase Auth `resetPasswordForEmail`** — permitted only in
  `send-password-reset` when the canonical Organization resolver returns
  `platform_auth`.

## Forbidden patterns

1. Importing `nodemailer` (or any raw SMTP client) outside
   `tenantOutboundEmail.ts`.
2. Importing or defining `sendGraphMail`, or otherwise reintroducing a
   Microsoft Graph mail transport, anywhere in BTPM code.
3. Calling Microsoft Graph `/sendMail` from BTPM code.
4. Reading `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_PASSWORD`/
   `SMTP_FROM*` env vars anywhere in BTPM notification code.
5. Reading `M365_SENDER_EMAIL` or `M365_SENDER_NAME` at runtime.
6. Falling back from Tenant SMTP to any other transport (Graph, global SMTP,
   project-level SMTP secret, arbitrary Tenant SMTP integration) for a
   tenant business notification or an auth-adjacent email.
7. Using the retired `global_graph_fallback` / `sent_fallback` /
   `failed_fallback` transport-result literals.
8. Adding a new email-sending edge function that does not call
   `sendTenantEmail` or `sendAuthEmail`, except for the `send-password-reset`
   platform-auth branch which delegates to Supabase Auth's native
   `resetPasswordForEmail`.

## Password-reset routing (`send-password-reset`)

`send-password-reset` chooses exactly one route per invocation using the
canonical resolver in
`supabase/functions/_shared/passwordResetOrganizationResolver.ts`:

- Route A — **Tenant SMTP**: when the user has a valid last-active
  Organization membership, or exactly one active Organization membership.
  Uses `auth.admin.generateLink('recovery')` + `sendAuthEmail`.
- Route B — **Supabase Auth native mail**: when no unambiguous
  Organization can be resolved. Uses `resetPasswordForEmail`. Never
  generates a separate action link and never invokes `sendAuthEmail`.

Anti-enumeration: valid requests always return `{ success: true }`
regardless of route, delivery outcome, or whether the account exists.

## Supabase Auth SMTP distinction

Supabase Auth SMTP (magic links, sign-up confirmation, password recovery
via Route B, OTP) is configured in the Supabase dashboard and lives
outside this code path. BTPM code:

- MUST NOT read Supabase Auth's "Minimum interval per user" setting.
- MUST NOT change Supabase Auth SMTP settings or Auth templates as part of
  the notification transport work.
- BTPM notification throttling is app-owned via
  `check_outbound_email_recent_duplicate` and per-caller event keys.

## Outbound-email gate

Every tenant business email goes through
`assert_environment_action_allowed(organization_id, 'outbound_email')`.
Non-production organizations are fail-closed with
`skipped_non_production`. Supabase Auth's native recovery mail is not
Organization-scoped and is therefore not written into
`outbound_email_events`.

## Audit and dedupe

- `record_outbound_email_event` writes one row per attempt (sent,
  skipped_*, failed_*). Metadata is small and never contains secret values,
  Vault IDs, or the email body.
- `check_outbound_email_recent_duplicate` collapses repeat sends within a
  short window keyed by `(tenant_id, event_key, recipient_email)`.
- Route B (native Supabase Auth) is intentionally not audited into
  `outbound_email_events` because no Tenant was selected.

## M365 / Graph / SharePoint / Power BI

`M365_TENANT_ID`, `M365_CLIENT_ID`, and `M365_CLIENT_SECRET` remain read
at runtime only by the pending Power BI functions
(`powerbi-provision-semantic-model`, `powerbi-manual-sync`,
`powerbi-bridge-qa`). SharePoint/PPT Graph runtime is already migrated to
the Tenant integration and is unrelated to email transport. No BTPM
function sends mail through Microsoft Graph.

## Enforcement

Static guard: `scripts/governance/check-email-transport-canonical.sh`
grep-checks the forbidden patterns above, including the Graph-mail
retirement invariants introduced in Phase 4D.14A.7H.

## Non-sender allowlist

Some edge functions match the naming heuristic used by the static guard
but do not actually transmit email. They are excluded from transport
enforcement unless they start sending mail:

- `supabase/functions/get-kpi-app-system-email/index.ts` — metadata
  fetch helper that returns the configured KPI app system email address.
  Read-only.

If any allowlisted function begins sending mail, it must switch to
`sendTenantEmail` or `sendAuthEmail` and be removed from the allowlist
in `scripts/governance/check-email-transport-canonical.sh`.
