-- BTPM OSS baseline: generic first-install bootstrap template.
--
-- PURPOSE
--   Bootstrap the first Tenant, Platform Super Admin, Organization and Workspace
--   after the clean schema has been installed and the initial Supabase Auth user
--   already exists.
--
-- SCOPE / SAFETY
--   * Operator-run installation template only; it is not an automatic migration.
--   * Intended only for a zero-Tenant / zero-Platform-Super-Admin installation.
--   * Contains no company, user, environment, project, URL, credential or secret.
--   * Replace every REPLACE_WITH_* value before running.
--   * Runs atomically in one transaction and fails closed if the installation is
--     not empty or the chosen Auth user is ambiguous/missing.

BEGIN;

DO $bootstrap$
DECLARE
  _admin_email text := 'REPLACE_WITH_ADMIN_EMAIL';
  _tenant_name text := 'REPLACE_WITH_TENANT_NAME';
  _tenant_slug text := 'replace-with-tenant-slug';
  _organization_name text := 'REPLACE_WITH_ORGANIZATION_NAME';
  _organization_slug text := 'replace-with-organization-slug';
  _workspace_name text := 'REPLACE_WITH_WORKSPACE_NAME';

  _user_id uuid;
  _tenant_id uuid;
  _organization_id uuid;
  _workspace_id uuid;
BEGIN
  IF _admin_email LIKE 'REPLACE_WITH_%'
     OR _tenant_name LIKE 'REPLACE_WITH_%'
     OR _organization_name LIKE 'REPLACE_WITH_%'
     OR _workspace_name LIKE 'REPLACE_WITH_%'
     OR _tenant_slug = 'replace-with-tenant-slug'
     OR _organization_slug = 'replace-with-organization-slug' THEN
    RAISE EXCEPTION 'Replace every REPLACE_WITH_* bootstrap value before execution';
  END IF;

  IF _tenant_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' THEN
    RAISE EXCEPTION 'Tenant slug must use lowercase letters, numbers and hyphens';
  END IF;

  IF EXISTS (SELECT 1 FROM public.tenants)
     OR EXISTS (SELECT 1 FROM public.platform_super_admins) THEN
    RAISE EXCEPTION 'Initial bootstrap is allowed only on a zero-Tenant, zero-Platform-Super-Admin installation';
  END IF;

  SELECT u.id
    INTO STRICT _user_id
    FROM auth.users u
   WHERE lower(u.email) = lower(btrim(_admin_email));

  -- A clean schema may be installed after the first Auth user already exists.
  -- Do not assume an historical auth.users trigger created public.profiles.
  INSERT INTO public.profiles (id, email, display_name, is_active, created_at, updated_at)
  SELECT u.id, u.email,
         COALESCE(NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''), u.email),
         true, now(), now()
    FROM auth.users u
   WHERE u.id = _user_id
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        is_active = true,
        updated_at = now();

  INSERT INTO public.tenants (
    name, slug, status, created_by, updated_by, metadata
  ) VALUES (
    btrim(_tenant_name), btrim(_tenant_slug), 'active', _user_id, _user_id,
    jsonb_build_object('bootstrap_source', 'oss_first_install')
  )
  RETURNING id INTO _tenant_id;

  INSERT INTO public.platform_super_admins (
    user_id, is_active, created_by, updated_by
  ) VALUES (
    _user_id, true, _user_id, _user_id
  );

  INSERT INTO public.tenant_memberships (
    tenant_id, user_id, role, status, created_by, updated_by
  ) VALUES (
    _tenant_id, _user_id, 'tenant_owner', 'active', _user_id, _user_id
  );

  INSERT INTO public.organizations (
    tenant_id, name, slug, organization_kind, environment_role, created_by
  ) VALUES (
    _tenant_id, btrim(_organization_name), btrim(_organization_slug),
    'production', 'production', _user_id
  )
  RETURNING id INTO _organization_id;

  UPDATE public.profiles
     SET organization_id = _organization_id,
         updated_at = now()
   WHERE id = _user_id;

  INSERT INTO public.organization_memberships (
    tenant_id, organization_id, user_id, role, status, created_by, updated_by
  ) VALUES (
    _tenant_id, _organization_id, _user_id, 'org_admin', 'active', _user_id, _user_id
  );

  UPDATE public.tenants
     SET default_organization_id = _organization_id,
         updated_by = _user_id,
         updated_at = now()
   WHERE id = _tenant_id;

  INSERT INTO public.workspaces (
    organization_id, name, description, is_archived, is_active, is_demo, created_by
  ) VALUES (
    _organization_id, btrim(_workspace_name), NULL, false, true, false, _user_id
  )
  RETURNING id INTO _workspace_id;

  INSERT INTO public.workspace_memberships (workspace_id, user_id)
  VALUES (_workspace_id, _user_id);

  INSERT INTO public.user_roles (user_id, role, organization_id, workspace_id)
  VALUES (_user_id, 'workspace_admin', _organization_id, _workspace_id);

  INSERT INTO public.user_active_context_preferences (
    user_id, last_active_tenant_id, last_active_organization_id,
    last_active_workspace_id, is_all_workspaces, updated_at
  ) VALUES (
    _user_id, _tenant_id, _organization_id, _workspace_id, false, now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET last_active_tenant_id = EXCLUDED.last_active_tenant_id,
        last_active_organization_id = EXCLUDED.last_active_organization_id,
        last_active_workspace_id = EXCLUDED.last_active_workspace_id,
        is_all_workspaces = false,
        updated_at = now();

  -- Create the normal fresh Tenant encryption-key family using the existing
  -- canonical BTPM key helper. No legacy key or private deployment material is
  -- imported by this bootstrap.
  PERFORM public.ensure_active_tenant_encryption_key_version(_tenant_id);

  RAISE NOTICE 'BTPM initial bootstrap completed: tenant %, organization %, workspace %',
    _tenant_id, _organization_id, _workspace_id;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'Exactly one Supabase Auth user matching the configured admin email is required';
  WHEN TOO_MANY_ROWS THEN
    RAISE EXCEPTION 'Admin email matched more than one Supabase Auth user';
END
$bootstrap$;

COMMIT;
