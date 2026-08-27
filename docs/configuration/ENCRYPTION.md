# Encryption configuration

BTPM's fresh-install encryption model is Tenant-versioned and is initialized by the database lifecycle. A new operator should not generate an arbitrary application master key and should not copy encryption material from another deployment.

## Fresh-install key creation

After the migration baseline is installed and the first Supabase Auth user exists, run:

```text
supabase/bootstrap/first_install.sql
```

The bootstrap creates the initial Tenant and then calls:

```sql
public.ensure_active_tenant_encryption_key_version(_tenant_id)
```

That is the canonical fresh-install path for preparing the Tenant encryption-key family.

There is no documented fresh-install requirement to set an `ENCRYPTION_KEY`, `BTPM_ENCRYPTION_KEY` or similar browser/server environment variable. Do not invent one.

## What the operator supplies

For a fresh installation, the operator supplies only the normal bootstrap identity/context values:

- administrator email;
- Tenant name/slug;
- Organization name/slug;
- Workspace name.

Encryption material is not a bootstrap placeholder.

## Verification

After bootstrap, sign into BTPM with the initial administrator and open:

**Tenant Admin → Encryption**

The page is a posture/verification surface. It intentionally never displays:

- encryption-key values;
- Vault identifiers;
- raw key material.

Verify that the Tenant has an active key version and that the installation reports the expected Tenant-versioned encryption posture.

## Fresh deployment versus migrated deployment

A fresh OSS installation should have no legacy Organization key material to import from another system.

Do not copy historical BTPM encryption keys, encrypted values or key references from an existing deployment merely to initialize a new environment. Fresh environments must create their own Tenant key lifecycle.

The repository contains migration-era compatibility and posture logic because BTPM itself evolved from older encryption models. Terms such as legacy Organization keys, v1 import, business-record re-encryption, runtime caller migration and key-retirement readiness apply to upgrades/migrations, not to the normal clean-install bootstrap.

## Key rotation and retirement

Treat rotation, re-encryption and key retirement as security-sensitive operational changes. Do not perform them by editing database rows or deleting Vault/key metadata manually.

For existing deployments with legacy material:

- preserve read compatibility until migration is verified;
- migrate runtime writers before retirement;
- verify no legacy/unreadable encrypted values remain;
- retain rollback compatibility until a separate retirement review authorizes removal.

The Tenant Admin encryption page exposes posture to support this review but is intentionally not a raw key-management console.

## Environment separation

Every independent BTPM environment should have its own Supabase project and its own encryption lifecycle. In particular:

- do not share production and test key material;
- do not import a production key into a developer project;
- do not export raw key material into source control, CI logs or browser configuration;
- do not use a common manually chosen master password across deployments.

## Backup and recovery

Encryption-key availability is part of application data recoverability. Configure Supabase/database backup and recovery according to your organization's requirements and test recovery in a non-production environment.

A database backup strategy must account for the protected key lifecycle as well as encrypted business records; backing up ciphertext without the corresponding protected key state is not sufficient for recovery.

## Security rules

- Key material must remain server-side and protected.
- The browser must never receive a raw encryption key.
- Encryption does not replace Tenant/Organization/Workspace/Project authorization.
- RLS and protected function boundaries remain required around encrypted data.
- Do not downgrade encrypted paths to plaintext to simplify an integration or migration.
- Review any change to encryption functions, key lifecycle, protected narrative/data fields or SECURITY DEFINER encryption paths as a high-risk security change.

For the overall first-install sequence, see [../SETUP.md](../SETUP.md).
