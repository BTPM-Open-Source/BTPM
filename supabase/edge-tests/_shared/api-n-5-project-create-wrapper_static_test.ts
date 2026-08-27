// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-n-5-project-create-wrapper_static_test.ts', import.meta.url).href;
// API-N.5-C1 — static contract guard for the committed Blank Project create
// external command database architecture.
//
// This is a repository/static test only. It locates the committed API-N.5
// migration by its unique marker (never by a hardcoded timestamped filename)
// and verifies the executable SQL of the single accepted wrapper
// `public.api_v1_create_project`.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const MARKER = "API-N.5 — Blank Project create external command";

/** Remove SQL line/block comments and string literals (executable SQL only). */
function stripSqlCommentsAndStrings(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    if (sql[i] === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += " '' ";
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

async function loadN5Migration(): Promise<{ name: string; text: string }> {
  const found: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(MARKER)) found.push({ name: entry.name, text });
  }
  assertEquals(found.length, 1, "expected exactly one API-N.5 migration");
  return found[0];
}

/** Isolate the body of the api_v1_create_project function definition. */
function wrapperBody(sql: string): string {
  const at = sql.indexOf("CREATE OR REPLACE FUNCTION public.api_v1_create_project");
  assert(at >= 0, "wrapper definition not found");
  const start = sql.indexOf("$function$", at);
  assert(start > at, "wrapper body opening tag not found");
  const end = sql.indexOf("$function$", start + 10);
  assert(end > start, "wrapper body closing tag not found");
  return sql.slice(start + 10, end);
}

// ---------------------------------------------------------------------------
// 6. Capability catalogue assertions
// ---------------------------------------------------------------------------

Deno.test("API-N.5: exactly one capability catalogue registration for projects:create", async () => {
  const { text } = await loadN5Migration();
  const exec = stripSqlCommentsAndStrings(text);

  assertEquals(
    (text.match(/INSERT\s+INTO\s+public\.api_capability_catalogue/gi) ?? [])
      .length,
    1,
    "expected exactly one capability catalogue insert",
  );
  assertEquals(
    (text.match(/'projects:create'/g) ?? []).length >= 1,
    true,
  );

  const values = text.slice(text.indexOf("VALUES"));
  for (
    const literal of [
      "'v1'",
      "'command'",
      "'projects:create'",
      "'projects.create'",
      "'POST'",
      "'/v1/projects'",
      "'workspace'",
      "true",
      "'active'",
    ]
  ) {
    assert(values.includes(literal), `catalogue row missing ${literal}`);
  }

  // No supported-capability, grant or project enablement writes at all.
  for (
    const relation of [
      "api_client_supported_capabilities",
      "api_capability_grants",
      "api_project_client_enablements",
    ]
  ) {
    assert(
      !new RegExp(
        `(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+[a-z_]*\\.?${relation}`,
        "i",
      ).test(exec),
      `migration must not write ${relation}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 7. Wrapper contract assertions
// ---------------------------------------------------------------------------

Deno.test("API-N.5: exactly one wrapper definition with the fixed typed signature", async () => {
  const { text } = await loadN5Migration();
  const exec = stripSqlCommentsAndStrings(text);

  assertEquals(
    (exec.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.api_v1_create_project\s*\(/gi,
    ) ?? []).length,
    1,
    "expected exactly one wrapper definition",
  );

  const at = exec.indexOf("public.api_v1_create_project");
  const header = exec.slice(at, exec.indexOf("$function$", at));
  for (
    const param of [
      "_expected_oauth_client_id text",
      "_workspace_id uuid",
      "_name text",
      "_program_id uuid",
      "_delivery_model text",
      "_request_id text",
      "_correlation_id text",
      "_idempotency_key text",
      "_payload_hash text",
    ]
  ) {
    assert(header.includes(param), `signature missing ${param}`);
  }

  assert(/RETURNS\s+jsonb/i.test(header), "must RETURN jsonb");
  assert(/LANGUAGE\s+plpgsql/i.test(header), "must be LANGUAGE plpgsql");
  assert(/SECURITY\s+DEFINER/i.test(header), "must be SECURITY DEFINER");
  assert(/SET\s+search_path\s+TO/i.test(header), "must fix search_path");

  const searchPath = text.slice(
    text.indexOf("SET search_path", text.indexOf("api_v1_create_project")),
  ).split("\n")[0];
  assert(searchPath.includes("pg_catalog"), "search_path must include pg_catalog");
  assert(searchPath.includes("public"), "search_path must include public");
});

Deno.test("API-N.5: capability identity is hardcoded, never caller-controlled", async () => {
  const { text } = await loadN5Migration();
  const body = wrapperBody(text);

  for (
    const decl of [
      /c_api_version\s+constant\s+text\s*:=\s*'v1'/i,
      /c_capability_kind\s+constant\s+text\s*:=\s*'command'/i,
      /c_capability_key\s+constant\s+text\s*:=\s*'projects:create'/i,
    ]
  ) {
    assert(decl.test(body), `missing hardcoded constant: ${decl}`);
  }

  // No capability name parameter exists in the signature.
  const header = text.slice(
    text.indexOf("public.api_v1_create_project"),
    text.indexOf("$function$"),
  );
  assert(!/_capability_key\s+text/i.test(header));
  assert(!/_capability_kind\s+text/i.test(header));
  assert(!/_api_version\s+text/i.test(header));
});

// ---------------------------------------------------------------------------
// 8. Authorization and containment assertions
// ---------------------------------------------------------------------------

Deno.test("API-N.5: Organization is derived server-side from an active Workspace", async () => {
  const { text } = await loadN5Migration();
  const body = stripSqlCommentsAndStrings(wrapperBody(text));

  assert(
    /FROM\s+public\.workspaces/i.test(body),
    "wrapper must read public.workspaces",
  );
  assert(
    /w\.id\s*=\s*_workspace_id/i.test(body),
    "workspace lookup must key on _workspace_id",
  );
  assert(
    /organization_id/i.test(body),
    "wrapper must derive organization_id",
  );
  assert(
    /is_active\s+IS\s+TRUE/i.test(body) &&
      /is_archived\s+IS\s+NOT\s+TRUE/i.test(body),
    "workspace must be active and non-archived",
  );

  // No caller-supplied Tenant or Organization inputs.
  const header = text.slice(
    text.indexOf("public.api_v1_create_project"),
    text.indexOf("$function$"),
  );
  assert(!/_tenant_id/i.test(header), "no caller-supplied tenant id");
  assert(!/_organization_id/i.test(header), "no caller-supplied organization id");
});

Deno.test("API-N.5: trusted API-E context is established and verified before execution", async () => {
  const { text } = await loadN5Migration();
  const body = stripSqlCommentsAndStrings(wrapperBody(text));

  const authorizeAt = body.indexOf("api_e_private.authorize_and_establish");
  assert(authorizeAt >= 0, "must call api_e_private.authorize_and_establish");

  const claimAt = body.indexOf("api_e_private.claim_idempotency");
  assert(claimAt > authorizeAt, "authorization must precede idempotency claim");

  const pmgAt = body.indexOf("public.apply_project_create_blank");
  assert(pmgAt > claimAt, "idempotency claim must precede canonical execution");

  assert(
    body.includes("c_capability_key") && body.includes("c_capability_kind"),
    "authorize_and_establish must use the fixed capability identity",
  );
  assert(
    wrapperBody(text).includes("api_e.source_channel"),
    "must verify api_e.source_channel",
  );
  assert(
    wrapperBody(text).includes("'external_api'"),
    "must require external_api source context",
  );
});

// ---------------------------------------------------------------------------
// 9. API-F idempotency assertions
// ---------------------------------------------------------------------------

Deno.test("API-N.5: idempotency uses the fixed command key and full decision handling", async () => {
  const { text } = await loadN5Migration();
  const raw = wrapperBody(text);
  const body = stripSqlCommentsAndStrings(raw);

  assert(
    /api_e_private\.claim_idempotency\s*\(\s*c_capability_key\s*,/i.test(body),
    "claim_idempotency must be called with the fixed capability key constant",
  );

  for (const decision of ["conflict", "pending", "replay", "execute"]) {
    assert(
      raw.includes(`'${decision}'`),
      `missing idempotency decision handling: ${decision}`,
    );
  }

  assert(
    body.includes("api_e_private.complete_idempotency"),
    "successful execution must complete idempotency",
  );
  assert(
    body.includes("api_e_private.fail_idempotency"),
    "bounded canonical failures must fail idempotency",
  );

  // Replay must return before the canonical command is ever invoked.
  const replayAt = raw.indexOf("'replay'");
  const pmgAt = body.indexOf("public.apply_project_create_blank");
  assert(replayAt >= 0 && pmgAt >= 0);
  const replayBlock = raw.slice(replayAt, raw.indexOf("'execute'", replayAt));
  assert(
    !replayBlock.includes("apply_project_create_blank"),
    "replay path must not invoke the canonical command again",
  );
});

// ---------------------------------------------------------------------------
// 10. Canonical business-path assertions
// ---------------------------------------------------------------------------

Deno.test("API-N.5: the wrapper calls exactly the canonical PMG command", async () => {
  const { text } = await loadN5Migration();
  const body = stripSqlCommentsAndStrings(wrapperBody(text));

  const calls = body.match(/public\.apply_project_create_blank\s*\(/g) ?? [];
  assertEquals(calls.length, 1, "exactly one canonical PMG call expected");
  assert(
    /:=\s*public\.apply_project_create_blank\s*\(/.test(body),
    "the canonical PMG call must be executable inside the wrapper body",
  );

  assert(
    !/public\.create_blank_project\s*\(/i.test(body),
    "must not call public.create_blank_project directly",
  );
  assert(
    !/INSERT\s+INTO\s+public\.projects\b/i.test(body),
    "must not insert into public.projects",
  );
  assert(
    !/UPDATE\s+public\.projects\b/i.test(body),
    "must not update public.projects",
  );
  assert(!/\bEXECUTE\b/i.test(body), "no dynamic SQL / PLpgSQL EXECUTE");
  assert(!/\bformat\s*\(/i.test(body), "no SQL text construction");
  assert(!/regprocedure/i.test(body), "no function-OID dispatch");
});

// ---------------------------------------------------------------------------
// 11. No Project auto-enablement (acceptance-critical)
// ---------------------------------------------------------------------------

Deno.test("API-N.5: no executable Project auto-enablement path exists", async () => {
  const { text } = await loadN5Migration();
  const exec = stripSqlCommentsAndStrings(text);

  assert(
    !/api_project_client_enablements/i.test(exec),
    "executable SQL must never reference api_project_client_enablements",
  );
  assert(
    !/enable_project[a-z_]*\s*\(/i.test(exec),
    "no Project-enablement RPC call permitted",
  );
  assert(
    !/(INSERT\s+INTO|UPDATE)\s+[a-z_.]*enablement/i.test(exec),
    "no enablement writes permitted",
  );
});

// ---------------------------------------------------------------------------
// 12. Bounded result + privilege assertions
// ---------------------------------------------------------------------------

Deno.test("API-N.5: the external success result is bounded to ok/outcome/projectId", async () => {
  const { text } = await loadN5Migration();
  const raw = wrapperBody(text);

  const successAt = raw.indexOf("'outcome', 'applied'");
  assert(successAt > 0, "applied result object not found");
  const start = raw.lastIndexOf("jsonb_build_object", successAt);
  const block = raw.slice(start, raw.indexOf(")", successAt) + 1);

  const keys = [...block.matchAll(/'([A-Za-z]+)'\s*,/g)].map((m) => m[1])
    .filter((k) => k !== "applied");
  assertEquals(new Set(keys), new Set(["ok", "outcome", "projectId"]));

  assert(raw.includes("'outcome', 'replayed'"), "replayed semantics required");

  // No leakage of narrative / name / encrypted / internal identifiers.
  for (
    const forbidden of [
      "'name'",
      "'projectName'",
      "'narrative'",
      "'tenantId'",
      "'tenant_id'",
      "'organizationId'",
      "'organization_id'",
      "'capability'",
      "'grant'",
      "btpm_decrypt",
    ]
  ) {
    const jsonKeys = [...raw.matchAll(/jsonb_build_object\(([\s\S]*?)\)/g)]
      .map((m) => m[1]).join("|");
    assert(
      !jsonKeys.includes(forbidden),
      `external result must not expose ${forbidden}`,
    );
  }
});

Deno.test("API-N.5: wrapper privilege posture is fail-closed", async () => {
  const { text } = await loadN5Migration();
  const exec = stripSqlCommentsAndStrings(text);

  assert(
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.api_v1_create_project[\s\S]*?FROM\s+PUBLIC/i
      .test(exec),
    "must REVOKE ALL FROM PUBLIC",
  );
  assert(
    /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.api_v1_create_project[\s\S]*?FROM\s+anon/i
      .test(exec),
    "must REVOKE ALL FROM anon",
  );
  assert(
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.api_v1_create_project[\s\S]*?TO\s+authenticated/i
      .test(exec),
    "must GRANT EXECUTE TO authenticated",
  );
  assert(
    !/service_role/i.test(exec),
    "no service-role external business execution path permitted",
  );
});
