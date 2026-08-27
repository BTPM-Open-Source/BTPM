// API-I.4 — Mutation capability activation substrate.
//
// Repository static contract test. Locates the API-I.4 migration by its unique
// marker and asserts:
//   - execution_updates:append is registered in the canonical capability
//     source of truth (public.api_capability_catalogue);
//   - api_version is v1, capability_kind is command, scope_level is workspace;
//   - it is administrator-assignable, i.e. available to the existing Connected
//     Apps grant-management path;
//   - no api_capability_grants / api_client_supported_capabilities /
//     enablement row is written, so no client receives the capability;
//   - no wildcard or generic command capability is introduced;
//   - existing read capability definitions are neither removed nor modified.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-I.4 — Register execution_updates:append command capability";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(marker)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

const RAW = await findMigrationByMarker(MARKER);
const SQL = normalize(RAW);

Deno.test("capability is registered in the canonical catalogue only", () => {
  assert(SQL.includes("insert into public.api_capability_catalogue"));
  assert(SQL.includes("'execution_updates:append'"));
  // No parallel catalogue or new capability table.
  assert(!SQL.includes("create table"));
  assert(!SQL.includes("create schema"));
});

Deno.test("frozen capability representation", () => {
  for (
    const literal of [
      "'v1'",
      "'command'",
      "'execution_updates:append'",
      "'execution_updates.append'",
      "'post'",
      "'/v1/execution-updates'",
      "'workspace'",
      "'append execution updates'",
      "'append execution updates to authorized phase or task targets.'",
      "'active'",
    ]
  ) {
    assert(SQL.includes(literal), `missing capability literal: ${literal}`);
  }
  // Workspace-scoped only.
  assert(!SQL.includes("'organization',"));
  assert(!SQL.includes("'project',"));
});

Deno.test("capability is administrator-assignable through the existing path", () => {
  const values = SQL.slice(SQL.indexOf("values ("));
  assert(values.includes("true,"), "capability must be administrator_assignable");
  assert(SQL.includes("on conflict (api_version, capability_key) do update set"));
});

Deno.test("no grant, supported-capability or enablement row is created", () => {
  for (
    const forbidden of [
      "api_capability_grants",
      "api_client_supported_capabilities",
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_clients",
      "astra",
    ]
  ) {
    assert(!SQL.includes(forbidden), `must not touch: ${forbidden}`);
  }
});

Deno.test("no wildcard or generic command capability is introduced", () => {
  for (
    const forbidden of [
      "'*'",
      "'crud'",
      "'generic_crud'",
      "'rpc'",
      "'generic_rpc'",
      "'table_access'",
      "'postgrest'",
      "'service_role'",
    ]
  ) {
    assert(!SQL.includes(forbidden), `forbidden capability literal: ${forbidden}`);
  }
  const commandKeys = [...SQL.matchAll(/'command'/g)];
  assert(commandKeys.length === 1, "exactly one command capability tuple");
});

Deno.test("existing read capabilities and protected surfaces are untouched", () => {
  for (
    const forbidden of [
      "organizations:list",
      "me:read",
      "workspaces:list",
      "projects:list",
      "projects:read",
      "authorize_and_establish",
      "append_execution_update",
      "pmg_record_command_audit",
      "api_v1_append_execution_update",
      "delete from",
      "drop ",
      "revoke ",
      "alter table",
    ]
  ) {
    assert(!SQL.includes(forbidden), `must not reference: ${forbidden}`);
  }
});
