# BTPM first-install and configuration guide

This guide describes a new BTPM deployment from an empty Supabase project. It is intentionally written for a fresh installation. Do not use an existing production database as the first installation target.

## 1. Prerequisites

Install:

- Node.js and npm;
- Git;
- Supabase CLI;
- access to create and administer a Supabase project;
- a hosting target for the React/Vite web application.

Clone the repository and install dependencies:

```bash
git clone <your-btpm-repository-url>
cd btpm
npm ci
```

## 2. Create a fresh Supabase project

Create an empty Supabase project for BTPM. Record the project reference, project URL and publishable/anon key. The browser application uses only publishable Supabase configuration; the service-role key must remain server-side.

Link the repository to the project with the Supabase CLI and replace the placeholder `project_id = "your-project-ref"` in `supabase/config.toml` with the project reference for the deployment copy you are operating. Do not commit a production project reference into a public fork.

See [configuration/SUPABASE.md](./configuration/SUPABASE.md).

## 3. Configure the browser application

Copy `.env.example` to your local environment file and set:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
```

Only values intended for the browser belong in `VITE_*` variables. Never put the Supabase service-role key, OAuth client secrets, SMTP passwords, AI provider keys or other private credentials in a `VITE_*` variable.

See [configuration/ENVIRONMENT.md](./configuration/ENVIRONMENT.md).

## 4. Apply the database baseline

The files under `supabase/migrations/` form the clean first-install migration baseline. Apply them to the empty project using the normal Supabase migration workflow, for example from a correctly linked checkout:

```bash
supabase db push
```

Review the output before approving database changes. A fresh install should apply the repository migration sequence in order and should not depend on historical deployment-specific migrations.

## 5. Deploy Edge Functions and runtime configuration

Deploy the Edge Functions required by the features you plan to use. Supabase supplies the normal project runtime values such as `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.

BTPM also uses feature-specific server-side values. Important examples are:

- `BTPM_API_ENABLED` — master switch for REST API v1;
- `BTPM_API_READS_ENABLED` — REST read enablement;
- `BTPM_API_MUTATIONS_ENABLED` — REST mutation enablement;
- `BTPM_API_ALLOWED_ORIGINS` — comma-separated exact browser origins allowed to call the REST API; wildcards are not accepted;
- `BTPM_MCP_RESOURCE_URI` — canonical HTTPS protected-resource URI for the BTPM MCP endpoint.

Do not mechanically change `verify_jwt` entries in `supabase/config.toml`. Some BTPM functions deliberately set `verify_jwt = false` at the Supabase gateway because the function performs its own authentication, token verification or signed-secret validation. Removing that setting, or applying it to other functions without understanding the code path, can break or weaken the intended boundary.

See [configuration/ENVIRONMENT.md](./configuration/ENVIRONMENT.md).

## 6. Configure Supabase Auth

BTPM supports email/password authentication through Supabase Auth. Configure the Supabase Auth Site URL and permitted redirect URLs for your deployed web origin.

The application uses these web routes:

- `/auth` — sign-in page;
- `/auth/callback` — OAuth/PKCE completion and invitation redemption;
- `/reset-password` — password-reset completion.

For Microsoft sign-in, BTPM calls Supabase Auth with provider `azure`. Configure the Azure/Microsoft provider in Supabase Auth and register the Supabase Auth callback URL in the Microsoft application registration. Supabase then redirects the browser back to BTPM's `/auth/callback` route after authentication.

Microsoft sign-in does not automatically grant BTPM access. The callback attempts to redeem a pending BTPM invitation for the authenticated email; a Microsoft account with no assigned BTPM access is signed out and shown a no-access message.

See [configuration/AUTHENTICATION_AND_SSO.md](./configuration/AUTHENTICATION_AND_SSO.md).

## 7. Create the first Auth user

Create the first Supabase Auth user using an email address you control. This user will become the initial Platform Super Admin and Tenant Owner during bootstrap.

The clean database baseline intentionally does not embed a user, Tenant, Organization or Workspace.

## 8. Bootstrap the first BTPM context

Open `supabase/bootstrap/first_install.sql` and replace every documented placeholder:

- administrator email;
- Tenant name and slug;
- Organization name and slug;
- Workspace name.

Run the script once against the fresh database. It fails closed if a Tenant or Platform Super Admin already exists, or if the administrator email does not resolve to exactly one Supabase Auth user.

The bootstrap creates:

- the initial profile;
- the first Tenant;
- the initial Platform Super Admin;
- Tenant Owner membership;
- the first Organization and Org Admin membership;
- the first Workspace and Workspace Admin role;
- the user's initial active context;
- the fresh Tenant encryption-key family through BTPM's canonical database key lifecycle.

## 9. Verify encryption

A fresh BTPM installation does **not** require you to invent or paste an application-level master encryption key into an environment variable. `first_install.sql` calls the canonical `ensure_active_tenant_encryption_key_version(...)` database helper to create the Tenant's key family.

After bootstrap, sign in as the initial administrator and review **Tenant Admin → Encryption**. The page is intentionally read-only and never exposes key values, Vault identifiers or key material.

Do not copy encryption material from another BTPM deployment. Legacy-key import, re-encryption and retirement procedures are upgrade/migration concerns, not fresh-install steps.

See [configuration/ENCRYPTION.md](./configuration/ENCRYPTION.md).

## 10. Start and validate the web application

For local development:

```bash
npm run dev
```

For a production bundle:

```bash
npm run build
```

Run the repository validation appropriate to your installation:

```bash
npm test
npm run build
npm run test:mcp
```

`npm run lint` is also useful, but the initial open-source baseline contains inherited repository-wide lint debt, so whole-repository lint is advisory for the first release. Do not introduce new lint regressions in code you change.

## 11. Configure external OAuth / Connected Apps if required

You do not need a Connected App simply to use the BTPM web UI. Connected Apps are for external applications and AI/MCP clients that need governed BTPM REST or MCP access.

From Platform Administration, register the client and configure its lifecycle, OAuth client ID, approved redirect URIs, policy/consent state and supported BTPM capabilities. For an MCP client, select the BTPM MCP protected resource; the browser does not supply the audience URI. BTPM resolves it server-side from `BTPM_MCP_RESOURCE_URI`.

See [configuration/OAUTH_AND_CONNECTED_APPS.md](./configuration/OAUTH_AND_CONNECTED_APPS.md).

## 12. Configure optional tenant integrations

Optional integrations are configured after the Tenant exists. Use the Tenant Admin integration screens rather than storing provider credentials in browser environment files.

The current protected secret catalog includes:

- OpenAI;
- Azure OpenAI;
- Microsoft Graph;
- SharePoint;
- MuleSoft KPI;
- SMTP.

These secrets are stored through BTPM's protected Tenant integration-secret path. Microsoft Graph/SharePoint credentials are separate from Microsoft user-login SSO.

See [configuration/OPTIONAL_INTEGRATIONS.md](./configuration/OPTIONAL_INTEGRATIONS.md).

## 13. Production hardening checklist

Before production use:

- use a dedicated production Supabase project;
- configure the final Auth Site URL and exact redirect allowlist;
- use only HTTPS production origins;
- keep service-role and provider secrets out of the browser and source control;
- keep `BTPM_API_*` switches disabled unless the REST API is intentionally exposed;
- use an exact `BTPM_API_ALLOWED_ORIGINS` allowlist;
- set and verify the canonical `BTPM_MCP_RESOURCE_URI` before enabling MCP clients;
- review Platform Admin Connected Apps and grant only required capabilities;
- verify Tenant/Organization/Workspace membership and role containment;
- verify Tenant Admin → Encryption posture;
- configure and test only the optional integrations you actually use;
- review [SECURITY.md](../SECURITY.md) and [integrations/SECURITY_AND_ADMINISTRATION.md](./integrations/SECURITY_AND_ADMINISTRATION.md).

## 14. Configuration map

| Concern | Primary configuration location |
| --- | --- |
| Browser → Supabase | `.env` / deployment environment using `.env.example` |
| Database schema | `supabase/migrations/` |
| First Tenant/Admin/Org/Workspace | `supabase/bootstrap/first_install.sql` |
| Edge Function deployment behavior | `supabase/config.toml` |
| REST API runtime controls | Supabase Edge Function secrets/environment |
| MCP canonical resource | `BTPM_MCP_RESOURCE_URI` server-side |
| Email/password auth | Supabase Auth |
| Microsoft login | Supabase Auth Azure provider + Microsoft app registration |
| External REST/MCP OAuth clients | BTPM Platform Admin → Connected Apps |
| Tenant encryption | automatic bootstrap/database key lifecycle; posture in Tenant Admin |
| AI/Microsoft/SMTP/MuleSoft secrets | BTPM Tenant Admin → Integrations |

If a deployment option is not documented here or in the linked source-specific documentation, inspect the executable source before assuming a variable, secret or provider setting exists. The code remains authoritative for runtime contracts.
