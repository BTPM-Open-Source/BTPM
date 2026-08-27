// PBI 7.1A — Zero-Push Active-Source Contract.
//
// Regression guard: the retired Power BI REST/Push runtime must not silently
// return to active source or generated Supabase database types.
// Direct-reporting (PostgreSQL Import) identifiers must remain intact.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

const RETIRED_PATHS = [
  // Frontend
  "src/components/admin/PowerBiSyncObservabilityPanel.tsx",
  "src/lib/powerBiValidationService.ts",
  "src/lib/powerBiProvisioningService.ts",
  "src/lib/powerBiManualSyncService.ts",
  "src/lib/powerBiBridgeQaService.ts",
  "src/lib/powerBiSyncObservabilityService.ts",
  // Edge Functions
  "supabase/functions/powerbi-validate",
  "supabase/functions/powerbi-provision-semantic-model",
  "supabase/functions/powerbi-manual-sync",
  "supabase/functions/powerbi-bridge-qa",
  // Shared runtime helpers
  "supabase/functions/_shared/tenantPowerBi.ts",
  "supabase/functions/_shared/powerBiClient.ts",
  "supabase/functions/_shared/powerBiValidateHelpers.ts",
];

const RETIRED_TYPE_IDENTIFIERS = [
  "powerbi_bridge_connections",
  "powerbi_bridge_contract_versions",
  "powerbi_sync_runs",
  "powerbi_sync_run_events",
  "get_powerbi_bridge_connection",
  "upsert_powerbi_bridge_connection",
  "create_powerbi_sync_run",
  "update_powerbi_sync_run_status",
  "log_powerbi_sync_run_event",
  "get_powerbi_sync_observability",
  "fact_powerbi_refresh_runs",
];

const PRESERVED_TYPE_IDENTIFIERS = [
  "powerbi_data_scope_rules",
  "get_powerbi_effective_scope",
  "get_powerbi_data_scope",
  "set_powerbi_workspace_scope",
  "bulk_set_powerbi_workspace_scope",
  "tenant_admin_get_powerbi_reporting_readiness",
  "service_manage_powerbi_reporting_identity",
];

Deno.test("zero-push — retired Power BI REST/Push source paths are absent", async () => {
  const present: string[] = [];
  for (const p of RETIRED_PATHS) {
    if (await pathExists(p)) present.push(p);
  }
  assert(
    present.length === 0,
    `Retired Power BI Push source paths must not exist: ${present.join(", ")}`,
  );
});

Deno.test("zero-push — generated Supabase types omit retired Power BI Push identifiers", async () => {
  const src = await Deno.readTextFile("src/integrations/supabase/types.ts");
  const offenders = RETIRED_TYPE_IDENTIFIERS.filter((id) => src.includes(id));
  assert(
    offenders.length === 0,
    `Generated types still expose retired Power BI Push identifiers: ${offenders.join(", ")}`,
  );
});

Deno.test("zero-push — generated Supabase types preserve Direct-reporting identifiers", async () => {
  const src = await Deno.readTextFile("src/integrations/supabase/types.ts");
  const missing = PRESERVED_TYPE_IDENTIFIERS.filter((id) => !src.includes(id));
  assert(
    missing.length === 0,
    `Direct-reporting identifiers missing from generated types: ${missing.join(", ")}`,
  );
});
