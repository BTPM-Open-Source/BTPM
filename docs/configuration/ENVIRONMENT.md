# Environment variables and runtime secrets

BTPM has three distinct configuration classes. Keep them separate:

1. browser-safe application configuration;
2. server-side Edge Function runtime configuration;
3. Tenant integration secrets stored through BTPM's protected integration-secret system.

Never move a secret into a browser `VITE_*` variable to simplify deployment.

## Browser-safe application configuration

The repository `.env.example` defines the supported base browser values:

| Variable | Purpose | Secret? |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL used by the web application | No |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key used by the web application | No |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project reference used by deployment-aware client code | No, but deployment-specific |

Copy `.env.example` into your local/deployment environment file and replace the placeholders. Do not commit real production deployment values into the public repository.

## Supabase Edge Function environment

BTPM Edge Functions use standard Supabase server-side values:

| Variable | Purpose | Secret? |
| --- | --- | --- |
| `SUPABASE_URL` | Project URL used by server code | No |
| `SUPABASE_ANON_KEY` | Low-privilege Supabase key used for caller-bound/authenticated operations | No, but server use is normal |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged Supabase key used only by protected server paths | **Yes** |

`SUPABASE_SERVICE_ROLE_KEY` must never be exposed to the browser or committed to source control.

## REST API v1 runtime controls

The `btpm-api-v1` Edge Function reads the following BTPM-specific server variables:

| Variable | Purpose |
| --- | --- |
| `BTPM_API_ENABLED` | Master REST API enable/disable switch |
| `BTPM_API_READS_ENABLED` | Enables accepted REST read routes when the master switch is enabled |
| `BTPM_API_MUTATIONS_ENABLED` | Enables accepted REST mutation routes when the master switch is enabled |
| `BTPM_API_ALLOWED_ORIGINS` | Exact comma-separated CORS origin allowlist |

The REST runtime fails closed when required controls are missing or malformed. Do not assume an unset switch means enabled.

`BTPM_API_ALLOWED_ORIGINS` accepts exact `http://` or `https://` origins. Entries must not contain wildcard `*`, credentials, paths, query strings or fragments. Example:

```text
https://pm.example.com,https://copilot.example.com
```

Do not include a trailing application path such as `/app` or `/callback`.

## MCP protected-resource configuration

| Variable | Purpose | Secret? |
| --- | --- | --- |
| `BTPM_MCP_RESOURCE_URI` | Canonical OAuth protected-resource identifier and MCP audience | No, but security-sensitive configuration |

Use the canonical public HTTPS URI of the deployed BTPM MCP resource. The runtime requires a valid HTTPS URL without embedded credentials, query string or fragment and normalizes trailing slashes.

External clients do not choose this value. The Platform Admin protected-resource operation resolves it server-side so a browser cannot inject a different OAuth audience.

## KPI scheduler controls

If recurring KPI processing is enabled, configure these server-side values:

| Variable | Purpose | Secret? |
| --- | --- | --- |
| `KPI_SNAPSHOT_SCHEDULER_SECRET` | Shared secret authenticating automatic KPI snapshot scheduler calls | **Yes** |
| `KPI_SNAPSHOT_SCHEDULER_ENABLED` | Enables the snapshot scheduler wrapper only when equal to literal `true` | No |
| `KPI_APP_SCHEDULER_SECRET` | Shared secret authenticating KPI App scheduler calls | **Yes** |
| `KPI_APP_SCHEDULER_ENABLED` | Enables the KPI App scheduler wrapper only when equal to literal `true` | No |

The two scheduler shared secrets must also be stored in Supabase Vault under their matching names so `pg_cron`/`pg_net` jobs can retrieve them without embedding plaintext in cron command text. See `docs/operations/KPI_SCHEDULER.md` for the complete scheduling procedure.

## Notification worker controls

If the notification outbox worker is scheduled, configure:

| Variable | Purpose | Secret? |
| --- | --- | --- |
| `NOTIFICATION_WORKER_SCHEDULER_SECRET` | Dedicated shared secret for calls to `process-notifications` | **Yes** |
| `APP_URL` | Canonical BTPM web origin used to build notification deep links | No |

The worker expects the scheduler secret in its dedicated request header and never accepts the service-role key as an incoming caller credential. `APP_URL` should be the deployed BTPM application origin, not a secret and not a path-specific URL.

## Other feature-specific server configuration

Additional operational functions may define narrowly scoped server controls. Configure them only when enabling the corresponding feature and follow the feature-specific repository documentation. Do not guess variable names or reuse credentials across unrelated controls.

## Tenant integration secrets

Provider credentials for supported integrations are not browser environment variables. Configure them through BTPM Tenant Administration so they use the protected Tenant integration-secret path.

Current catalogued secret sets are documented in [OPTIONAL_INTEGRATIONS.md](./OPTIONAL_INTEGRATIONS.md).

Examples include:

- OpenAI API key;
- Azure OpenAI API key;
- Microsoft Graph tenant/client credentials;
- SharePoint site coordinates;
- MuleSoft KPI endpoint credentials;
- SMTP credentials.

## Secret-handling rules

- Never commit `.env`, `.env.local`, provider credentials or production identifiers.
- Never expose the service-role key in client-side code.
- Never put a provider secret in `VITE_*`.
- Never store a Tenant integration credential as plain application configuration when a protected integration-secret field exists for it.
- Never log raw access tokens, refresh tokens, client secrets, API keys, passwords, scheduler shared secrets or encryption-key material.
- Use separate credentials for development/test and production.
- Rotate credentials through the owning provider and BTPM protected secret-management path, not by editing source files.

## Encryption is not an environment-secret setup step

A fresh installation does not require an `ENCRYPTION_KEY`, `BTPM_ENCRYPTION_KEY` or similar user-created environment variable. The first-install bootstrap invokes BTPM's database key lifecycle to prepare the Tenant encryption-key family. See [ENCRYPTION.md](./ENCRYPTION.md).
