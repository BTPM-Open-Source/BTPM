# BTPM clean baseline dependency manifest

## Public schema identity

The clean first-install public schema committed as `supabase/migrations/20260825000002_public_schema.sql` is the hosted-Supabase portable form of the accepted current-state reconstruction.

- Portable public-schema SHA-256: `e9a4bdcbd3ab5b67aaf09c344f39f23f1d5cb395b86177b44bb6c19811bf0d92`
- Git blob SHA: `ecad1ac2dea0d39f1e75f76ff3de070afdf9e323`
- Size: `3,597,447` bytes

The preceding canonical reconstruction had SHA-256 `fbfad376819475fb2f2c31eb54a240b5763590fffc7ae13cec7b2ec123de7bf0`. The portable form differs only by removal of `ALTER DEFAULT PRIVILEGES` statements that a hosted Supabase project database owner cannot portably apply. Explicit object grants/revokes remain in the schema.

The reconstruction was additionally sanitized for the private active-context tenant-slug fallback and the Supabase-provided `public` schema creation statement. It contains no deployment-specific Tenant, Organization, Workspace, user, project, Supabase project reference, credential or encryption material.

## Installation order and prerequisites

The committed migration sequence is the supported clean first-install baseline and must be applied in filename order to an empty Supabase project.

Creation-time prerequisites are:

- Supabase platform substrate: `auth`, `storage`, `vault`, `cron`, `extensions`.
- Extensions required by the retained BTPM runtime: `pgcrypto`, `vector`, `pg_cron`, `pg_net`.
  - `pgcrypto` and `vector` support the existing encryption/vector schema contracts.
  - `pg_cron` and `pg_net` support scheduled runtime functions such as notification/reporting processing.
  - The baseline installs only extension prerequisites. It contains no production cron jobs, deployment URLs, bearer tokens, credentials or private scheduler state.
- Private security schema: `api_e_private`.
- Creation-time restrictive-RLS helpers:
  - `api_e_private.jwt_client_id()`
  - `api_e_private.assert_trusted_context()`

After the public schema is installed, the subsequent migrations reconstruct the accepted private API runtime functions, Power BI reporting security substrate and storage policy contract.

## Private API runtime

The public schema references private executor/resolver functions that are installed by the post-schema migrations. These include project, phase, task, program, portfolio, risk, blocker, KPI and execution-update operations plus delegated context resolution.

`authorize_and_establish(...)` remains part of the trusted API security foundation. It depends on public API governance/containment tables and is therefore installed after the public schema.

Private API functions remain deny-by-default to browser roles and are intended to be reached only through the governed server-side integration paths.

## Reporting dependencies

The retained Power BI model uses the same PostgreSQL/Supabase database, not a separate reporting database. Its structural dependencies include:

- `pbi_reporting._scope_projects`
- `pbi_reporting_security.tenant_login_map`
- `pbi_reporting_security.tenant_login_audit`

The reporting substrate is reconstructed without Tenant login rows, credentials, production connection details or private operational state. The shared reporting role is non-login and must retain `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION` and `NOBYPASSRLS` protections.

A clean installation starts with reporting unprovisioned until an administrator deliberately uses the existing reporting lifecycle.

## Platform-schema references

The public schema references Supabase-managed/platform facilities including:

- `auth.uid`, `auth.users`
- `vault.create_secret`, `vault.decrypted_secrets`, `vault.update_secret`
- `cron.job`, `cron.job_run_details`
- `extensions.digest`, `extensions.gen_random_bytes`, `extensions.pgp_sym_decrypt`, `extensions.pgp_sym_encrypt`, `extensions.vector`, `extensions.vector_cosine_ops`
- `cron` / `pg_cron` and `net` / `pg_net` where scheduled HTTP invocation is configured after installation

No production cron target, Vault value, deployment URL, bearer token or Tenant-specific secret belongs in the baseline.

## Storage boundary

The final migration applies four deny policies on `storage.objects` for the private BTPM buckets. Supabase Storage must therefore exist before that migration is applied.

## First-install bootstrap

`supabase/bootstrap/first_install.sql` is deliberately outside `supabase/migrations/`. It is an operator-run, one-time bootstrap after the clean migration chain and after creation of the first Supabase Auth user. It creates the first Tenant / Organization / Workspace / administrator context and calls the canonical BTPM helper to generate fresh Tenant encryption-key material. It does not import legacy or deployment-specific key material.

## Validation status

Before the historical migration chain was replaced, this baseline was exercised against one clean disposable Supabase Test project. Validation covered schema creation, all public-table RLS, private API executor ACLs and containment, first-install bootstrap, fresh Tenant encryption-key creation, Power BI provisioning/isolation/lifecycle, and private Storage policy installation. The historical migrations were removed only after those checks passed.