// Open-source publication clean-history SQL regression suite.
//
// The publication candidate intentionally contains only the final forward-only
// schema/migration set. Historical API-Q migration-step tests are development
// evidence, not distributable current-state contracts. This suite replaces that
// history coupling with fail-closed semantic checks over the final SQL state.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allFunctionDefinitions,
  cleanMigrations,
  currentFunction,
  functionAclStatements,
  hasFunctionAcl,
  normalizeSql,
  sqlCorpus,
} from "../ossSqlContract.ts";

const migrations = await cleanMigrations();
const corpus = await sqlCorpus();
const hardenedSearchPath = /SET\s+search_path\s+TO\s+'?pg_catalog'?\s*,\s*'?public'?/i;

Deno.test("OSS SQL-1: publication migrations are clean-history and forward-only", () => {
  assert(migrations.length > 0, "clean publication migration set must not be empty");
  for (const { name } of migrations) {
    assert(
      /^20260825\d{6}_[a-z0-9_]+\.sql$/.test(name),
      `unexpected publication migration filename: ${name}`,
    );
    assert(
      !/^20\d{12}_[0-9a-f]{8}-[0-9a-f-]{27}\.sql$/i.test(name),
      `private-history UUID migration leaked into publication set: ${name}`,
    );
  }
});

Deno.test("OSS SQL-2: canonical PMG Risk/Blocker commands exist exactly once", async () => {
  for (const name of [
    "apply_risk_create",
    "apply_risk_update",
    "apply_blocker_create",
    "apply_blocker_update",
  ]) {
    const definitions = await allFunctionDefinitions(name);
    assertEquals(definitions.length, 1, `${name} must have one canonical definition`);
    const definition = normalizeSql(definitions[0]);
    assert(definition.includes("SECURITY DEFINER"), `${name} must remain SECURITY DEFINER`);
    assert(hardenedSearchPath.test(definition), `${name} must keep the hardened search_path`);
  }
});

Deno.test("OSS SQL-3: raw Risk/Blocker PMG commands stay non-public", async () => {
  for (const name of ["create_risk_with_links", "create_blocker_with_links"]) {
    assert(
      await hasFunctionAcl(name, { action: "REVOKE", role: "PUBLIC", privilege: "ALL" }),
      `${name}: PUBLIC revoke missing`,
    );
    assert(
      !(await hasFunctionAcl(name, { action: "GRANT", role: "anon" })),
      `${name}: raw PMG command must not be directly executable by anon`,
    );
    assert(
      !(await hasFunctionAcl(name, { action: "GRANT", role: "authenticated" })),
      `${name}: raw PMG command must not be directly executable by authenticated`,
    );
    assert(
      await hasFunctionAcl(name, { action: "GRANT", role: "service_role" }),
      `${name}: service_role grant missing`,
    );
  }
});

Deno.test("OSS SQL-4: API and MCP Risk/Blocker wrappers remain delegated-user surfaces", async () => {
  for (const name of [
    "api_v1_create_risk",
    "mcp_v1_create_risk",
    "api_v1_update_risk",
    "mcp_v1_update_risk",
    "api_v1_create_blocker",
    "mcp_v1_create_blocker",
    "api_v1_update_blocker",
    "mcp_v1_update_blocker",
  ]) {
    const definition = await currentFunction(name);
    assert(definition.length > 0, `${name}: definition missing`);
    assert(
      await hasFunctionAcl(name, { action: "REVOKE", role: "PUBLIC", privilege: "ALL" }),
      `${name}: PUBLIC revoke missing`,
    );
    assert(
      !(await hasFunctionAcl(name, { action: "GRANT", role: "anon" })),
      `${name}: anon must not receive direct EXECUTE`,
    );
    assert(
      await hasFunctionAcl(name, { action: "GRANT", role: "authenticated" }),
      `${name}: authenticated grant missing`,
    );
  }
});

Deno.test("OSS SQL-5: private API executors stay unreachable by app roles", async () => {
  const privateExecutorNames = Array.from(
    new Set(
      [...corpus.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+api_e_private\.(execute_v1_[a-z0-9_]+)\s*\(/gi)]
        .map((match) => match[1]),
    ),
  ).sort();
  assert(privateExecutorNames.length > 0, "private API executor inventory must not be empty");

  for (const name of privateExecutorNames) {
    const definition = normalizeSql(await currentFunction(name, { schema: "api_e_private" }));
    assert(definition.includes("SECURITY DEFINER"), `${name}: SECURITY DEFINER missing`);
    assert(hardenedSearchPath.test(definition), `${name}: hardened search_path missing`);

    for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
      assert(
        await hasFunctionAcl(name, {
          action: "REVOKE",
          role,
          privilege: "ALL",
          schema: "api_e_private",
        }),
        `${name}: ${role} revoke missing`,
      );
    }

    const aclStatements = await functionAclStatements(name, "api_e_private");
    assert(
      !aclStatements.some((statement) =>
        /^GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\b/i.test(normalizeSql(statement))
      ),
      `${name}: private executor must not have an EXECUTE grant`,
    );
  }
});

Deno.test("OSS SQL-6: MCP wrapper inventory is explicit and paired with REST where applicable", async () => {
  const mcpNames = Array.from(
    new Set(
      [...corpus.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(mcp_v1_[a-z0-9_]+)\s*\(/gi)]
        .map((match) => match[1]),
    ),
  ).sort();
  assert(mcpNames.length > 0, "MCP database-wrapper inventory must not be empty");

  for (const mcpName of mcpNames) {
    const definition = await currentFunction(mcpName);
    assert(definition.length > 0, `${mcpName}: current definition missing`);
    const restName = mcpName.replace(/^mcp_v1_/, "api_v1_");
    const restDefinitions = await allFunctionDefinitions(restName);
    if (restDefinitions.length > 0) {
      assertEquals(restDefinitions.length, 1, `${restName}: expected one canonical REST definition`);
    }
  }
});

Deno.test("OSS SQL-7: no blanket PUBLIC execute grant is introduced for API/MCP wrappers", () => {
  assert(
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.(?:api_v1_|mcp_v1_)[^;]*\s+TO\s+PUBLIC\s*;/i.test(corpus),
    "API/MCP wrappers must never grant EXECUTE to PUBLIC",
  );
});

Deno.test("OSS SQL-8: trusted MCP provenance remains represented in final canonical SQL", () => {
  for (const token of [
    "authorize_and_establish_mcp",
    "source_channel",
    "delegation_mode",
    "mcp",
  ]) {
    assert(corpus.includes(token), `canonical SQL is missing trusted MCP token: ${token}`);
  }
});

Deno.test("OSS SQL-9: encryption/decryption remains database-owned", () => {
  assert(/btpm_encrypt/i.test(corpus), "canonical encryption function/reference missing");
  assert(/btpm_decrypt/i.test(corpus), "canonical decryption function/reference missing");
  assert(/tenant_encryption/i.test(corpus), "tenant encryption substrate missing");
});
