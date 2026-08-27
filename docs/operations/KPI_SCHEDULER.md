# KPI Scheduler Operations

BTPM uses two server-side scheduler wrappers for recurring KPI processing:

- `run-kpi-snapshot-capture-scheduler-cron` — captures automatic KPI snapshots.
- `run-kpi-app-scheduler-cron` — processes KPI App auto-submit work after snapshot capture.

The recurring cron schedule only invokes the wrappers. KPI schedule policies remain the authority for deciding which KPIs are actually due on a given day.

## Required server-side controls

Configure these four Edge Function secrets in the deployment environment:

- `KPI_SNAPSHOT_SCHEDULER_SECRET`
- `KPI_SNAPSHOT_SCHEDULER_ENABLED`
- `KPI_APP_SCHEDULER_SECRET`
- `KPI_APP_SCHEDULER_ENABLED`

The two `*_ENABLED` values must equal the literal string `true` for their wrappers to proceed. Scheduler shared-secret values must never be committed to the repository, migration files, cron command text, or logs.

The two shared-secret values must also be stored in Supabase Vault under the matching names so scheduled database jobs can obtain them at execution time without embedding plaintext secrets in `cron.job`.

## Database prerequisites

Enable the required extensions in the target Supabase/PostgreSQL deployment:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA cron TO postgres;
```

## Store scheduler secrets in Vault

Store the same values used by the Edge Function environment. Example:

```sql
SELECT vault.create_secret(
  '<snapshot-scheduler-secret>',
  'KPI_SNAPSHOT_SCHEDULER_SECRET',
  'BTPM snapshot scheduler shared secret'
);

SELECT vault.create_secret(
  '<kpi-app-scheduler-secret>',
  'KPI_APP_SCHEDULER_SECRET',
  'BTPM KPI App scheduler shared secret'
);
```

The Vault and Edge Function values must match exactly or the wrappers reject scheduled invocations.

## Schedule the jobs

Replace `<project-ref>` with the Supabase project reference for the deployment. Do not hard-code one deployment's project reference into reusable configuration.

```sql
-- Automatic snapshot capture runs first.
SELECT cron.schedule(
  'run-kpi-snapshot-capture-scheduler-cron',
  '0 5 * * *',
  $cmd$
    SELECT net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/run-kpi-snapshot-capture-scheduler-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-snapshot-scheduler-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'KPI_SNAPSHOT_SCHEDULER_SECRET')
      ),
      body := '{}'::jsonb
    );
  $cmd$
);

-- KPI App processing runs after snapshot capture.
SELECT cron.schedule(
  'run-kpi-app-scheduler-cron',
  '0 6 * * *',
  $cmd$
    SELECT net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/run-kpi-app-scheduler-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-scheduler-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'KPI_APP_SCHEDULER_SECRET')
      ),
      body := '{}'::jsonb
    );
  $cmd$
);
```

The example cadence is daily because BTPM's schedule-policy layer decides whether weekly, monthly, quarterly, or yearly work is due. Keep snapshot capture before KPI App submission so the downstream path sees the latest eligible snapshot state.

## Verify

Use the BTPM KPI Scheduling diagnostics surface or the read-only `kpi_scheduler_diagnostics()` RPC. Confirm both expected jobs are configured and active, then confirm successful run history after the first scheduled invocation.

Useful database checks include:

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'run-kpi-snapshot-capture-scheduler-cron',
  'run-kpi-app-scheduler-cron'
);
```

Do not expose cron command text, Vault plaintext, authorization headers, or secret values in diagnostics or support output.

## Disable or remove

To disable execution without removing the cron jobs, set the corresponding `*_ENABLED` Edge Function value to anything other than `true`.

To remove the jobs entirely:

```sql
SELECT cron.unschedule('run-kpi-snapshot-capture-scheduler-cron');
SELECT cron.unschedule('run-kpi-app-scheduler-cron');
```

Changing scheduler configuration must not change KPI formulas, calculation semantics, snapshot source-of-truth rules, tenant/workspace containment, or the security checks inside the scheduler/orchestrator paths.
