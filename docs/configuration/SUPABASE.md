# Supabase configuration

BTPM uses Supabase for PostgreSQL, Auth and Edge Functions. Start with a new project when validating a fresh open-source installation.

## Project creation and repository link

Create a Supabase project and retain its project reference. The repository ships with a safe placeholder in `supabase/config.toml`:

```toml
project_id = "your-project-ref"
```

For the deployment checkout, link the Supabase CLI to your project and use your project reference locally. Do not commit a private or production project reference to a public repository.

A typical operator flow is:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

Always inspect the migration list before approving a push. The `supabase/migrations/` directory is the canonical clean first-install baseline.

## Browser configuration

The browser application needs only the public Supabase connection values described in `.env.example`:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_PROJECT_ID
```

The Supabase publishable/anon key is expected to be exposed to the browser. Security must therefore come from Auth, RLS, SECURITY DEFINER boundaries and BTPM authorization logic—not from treating the browser key as a secret.

The Supabase **service-role key is never a browser value**. Never expose it in `VITE_*`, client-side JavaScript, screenshots, logs or a public repository.

## Database baseline

Apply the migrations to an empty database before running the bootstrap script. The bootstrap is not a migration; it is an operator-run first-install step after the schema exists and after the initial Auth user has been created.

The bootstrap file is:

```text
supabase/bootstrap/first_install.sql
```

It intentionally refuses to run after a Tenant or Platform Super Admin already exists.

## Edge Functions

Deploy the functions required by your chosen feature set using the Supabase CLI. Keep the repository `supabase/config.toml` function sections aligned with deployment behavior.

Several BTPM functions deliberately use:

```toml
verify_jwt = false
```

This does **not** mean the function is public or unauthenticated. In those functions, authentication is performed inside the function or through a separate signed-secret boundary because the gateway verifier is not the authoritative BTPM control for that endpoint. Review the function source before changing this setting.

Never copy `verify_jwt = false` to another function merely to make a request succeed.

## Supabase-provided server environment

Supabase Edge Functions use standard project-side values including:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

BTPM code reads these values server-side. `SUPABASE_SERVICE_ROLE_KEY` is privileged and must remain available only to trusted server execution paths.

## Auth URLs

Configure the Supabase Auth Site URL to your BTPM web origin and allow the exact application redirect URLs needed by the deployed app. Important BTPM routes include:

```text
https://<your-btpm-host>/auth/callback
https://<your-btpm-host>/reset-password
```

Add development equivalents only for environments you intentionally support.

For Microsoft sign-in, the Microsoft application registration should use the callback URL required by the Supabase Azure provider (normally the Supabase Auth callback endpoint for your project). Supabase Auth then redirects the authenticated browser to BTPM's `/auth/callback` URL supplied by the application.

See [AUTHENTICATION_AND_SSO.md](./AUTHENTICATION_AND_SSO.md).

## RLS and privileged paths

Do not disable RLS or broaden database grants as an installation shortcut. BTPM relies on a combination of:

- Supabase Auth identity;
- Tenant / Organization / Workspace / Project containment;
- RLS;
- narrowly scoped SECURITY DEFINER functions;
- delegated-user operations;
- service-role usage only inside protected server paths.

A successful frontend build does not prove these boundaries are correct.

## Storage and other Supabase features

Storage policies and other required database objects are installed by the repository baseline. Do not manually recreate them from an older BTPM deployment unless a repository document explicitly instructs you to do so.

## Production guidance

For production:

- use a dedicated production project rather than reusing the initial validation project;
- keep production project references and service credentials outside the public repository;
- configure exact Auth redirects and API CORS origins;
- review every Edge Function that uses privileged credentials;
- back up and monitor the database according to your organization's requirements;
- treat changes to RLS, SECURITY DEFINER functions, service-role usage and encryption as security-sensitive changes.
