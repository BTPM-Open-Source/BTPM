/**
 * API-Q Cross-Family-C20C7 — Decision Case SharePoint Evidence Edge
 * Functions: caller-scoped record resolution BEFORE service-role access.
 *
 * Static/contract test over the two browser-only Edge Functions.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const BROWSE_PATH = new URL(
  "../../functions/browse-governance-decision-sharepoint-files/index.ts",
  import.meta.url,
);
const SELECT_PATH = new URL(
  "../../functions/select-governance-decision-sharepoint-evidence-files/index.ts",
  import.meta.url,
);
const HOOK_PATH = new URL(
  "../../../src/hooks/useGovernanceEvidenceFiles.ts",
  import.meta.url,
);
const SERVICE_PATH = new URL(
  "../../../src/lib/governanceEvidenceFileService.ts",
  import.meta.url,
);

const browse = await Deno.readTextFile(BROWSE_PATH);
const select = await Deno.readTextFile(SELECT_PATH);
const hook = await Deno.readTextFile(HOOK_PATH);
const service = await Deno.readTextFile(SERVICE_PATH);

const sources: Array<[string, string]> = [
  ["browse", browse],
  ["select", select],
];

const ix = (src: string, needle: string) => src.indexOf(needle);

Deno.test("C20C7 — both functions still require Authorization", () => {
  for (const [name, src] of sources) {
    assert(
      src.includes('req.headers.get("Authorization")'),
      `${name}: Authorization header read missing`,
    );
    assert(
      src.includes('error: "missing_auth"'),
      `${name}: missing_auth response removed`,
    );
  }
});

Deno.test("C20C7 — caller-scoped anon client carries the Authorization header", () => {
  for (const [name, src] of sources) {
    assert(
      src.includes("createClient(SUPABASE_URL, ANON_KEY, {"),
      `${name}: anon caller client missing`,
    );
    assert(
      src.includes("global: { headers: { Authorization: authHeader } }"),
      `${name}: caller client no longer forwards Authorization`,
    );
  }
});

Deno.test("C20C7 — browser-only guard preserved before business resolution", () => {
  for (const [name, src] of sources) {
    assert(
      src.includes("createSupabaseTokenVerifier(caller)"),
      `${name}: token verifier missing`,
    );
    assert(
      src.includes("assertBrowserSessionOnly(req, verifier)"),
      `${name}: assertBrowserSessionOnly missing`,
    );
    assert(src.includes("caller.auth.getUser()"), `${name}: getUser missing`);
    const guard = ix(src, "assertBrowserSessionOnly(req, verifier)");
    const summary = ix(src, "get_governance_decision_case_project_summary");
    assert(guard > 0 && summary > guard, `${name}: guard must precede resolution`);
    const getUser = ix(src, "caller.auth.getUser()");
    assert(summary > getUser, `${name}: authentication must precede resolution`);
  }
});

Deno.test("C20C7 — record scope resolved via caller-scoped protected RPC", () => {
  for (const [name, src] of sources) {
    assert(
      src.includes(
        'await caller.rpc(\n      "get_governance_decision_case_project_summary",',
      ),
      `${name}: protected summary RPC not invoked through caller client`,
    );
    assert(
      src.includes("summary?.project_id") &&
        src.includes("summary?.organization_id"),
      `${name}: authoritative scope IDs not taken from summary`,
    );
  }
  assert(
    select.includes("summary?.workspace_id"),
    "select: workspace_id must come from the protected summary",
  );
});

Deno.test("C20C7 — no service-role governance_records lookup remains", () => {
  for (const [name, src] of sources) {
    assert(
      !src.includes('.from("governance_records")'),
      `${name}: service-role governance_records read still present`,
    );
    assert(!/\brec\./.test(src), `${name}: legacy admin record variable still used`);
  }
});

Deno.test("C20C7 — protected resolution precedes every admin business query", () => {
  for (const [name, src] of sources) {
    const summary = ix(src, "get_governance_decision_case_project_summary");
    const firstAdminFrom = ix(src, "admin\n      .from(");
    const adminRpc = ix(src, "admin.rpc(");
    assert(summary > 0, `${name}: summary resolution missing`);
    if (firstAdminFrom >= 0) {
      assert(firstAdminFrom > summary, `${name}: admin read before resolution`);
    }
    if (adminRpc >= 0) {
      assert(adminRpc > summary, `${name}: admin rpc before resolution`);
    }
    // Service-role client construction also moved after caller authority.
    const adminCtor = ix(src, "createClient(SUPABASE_URL, SERVICE_ROLE)");
    assert(adminCtor > summary, `${name}: admin client constructed too early`);
  }
});

Deno.test("C20C7 — no client-supplied project/workspace/organization scope is trusted", () => {
  for (const [name, src] of sources) {
    for (const bad of [
      "body?.projectId",
      "body?.project_id",
      "body?.workspaceId",
      "body?.organizationId",
      "raw?.projectId",
      "raw?.organizationId",
    ]) {
      assert(!src.includes(bad), `${name}: client scope value ${bad} used`);
    }
  }
});

Deno.test("C20C7 — browse retains explicit caller-scoped project read authority", () => {
  assert(
    browse.includes('caller.rpc("_gov_assert_project_read", {'),
    "browse: _gov_assert_project_read removed",
  );
  const auth = ix(browse, '_gov_assert_project_read');
  for (const marker of [
    '.from("sharepoint_project_bindings")',
    "resolveTenantSharePointRuntimeConfig(",
    "resolveAndAcquireTenantMicrosoftGraph(",
    "resolveSharePointProjectRoot(",
  ]) {
    const at = ix(browse, marker);
    assert(at > auth, `browse: ${marker} must run after project authority`);
  }
});

Deno.test("C20C7 — select write authority precedes binding read, runtime and insert", () => {
  assert(
    select.includes('caller.rpc("_gov_assert_project_write", {'),
    "select: _gov_assert_project_write removed",
  );
  const auth = ix(select, "_gov_assert_project_write");
  for (const marker of [
    '.from("sharepoint_project_bindings")',
    "resolveTenantSharePointRuntimeConfig(",
    "resolveAndAcquireTenantMicrosoftGraph(",
    "resolveSharePointProjectRoot(",
    '.from("governance_record_evidence_files")',
    'admin.rpc("log_activity_event"',
  ]) {
    const at = ix(select, marker);
    assert(at > auth, `select: ${marker} must run after write authority`);
  }
});

Deno.test("C20C7 — sanitized error mapping without raw RPC detail", () => {
  for (const [name, src] of sources) {
    assert(src.includes('error: "record_not_found"'), `${name}: P0002 mapping missing`);
    assert(src.includes('error: "not_a_decision_case"'), `${name}: 22023 mapping missing`);
    assert(src.includes('error: "forbidden"'), `${name}: forbidden mapping missing`);
    assert(
      !src.includes("summaryError.message") && !src.includes("summaryError.details"),
      `${name}: raw RPC error text leaked`,
    );
    assert(
      !/note:\s*summaryError/.test(src),
      `${name}: raw RPC error surfaced in note`,
    );
    // No protected scope values logged on resolution failure.
    assert(
      !src.includes('logSafe("record_resolution_denied", { request_id: requestId, project'),
      `${name}: protected values logged on failure`,
    );
  }
});

Deno.test("C20C7 — Tenant SharePoint / Graph runtime and containment helpers remain", () => {
  for (const [name, src] of sources) {
    assert(
      src.includes("resolveTenantSharePointRuntimeConfig"),
      `${name}: Tenant SharePoint resolver missing`,
    );
    assert(
      src.includes("resolveAndAcquireTenantMicrosoftGraph"),
      `${name}: Tenant Graph resolver missing`,
    );
    assert(
      src.includes("resolveSharePointProjectRoot"),
      `${name}: project root resolver missing`,
    );
    assert(
      src.includes("graph.accessToken"),
      `${name}: single Graph token per invocation missing`,
    );
    assert(
      !/Deno\.env\.get\(\s*"(M365_|BTPM_SP_)/.test(src),
      `${name}: legacy global env read reintroduced`,
    );
  }
  assert(
    browse.includes("isSharePointItemUnderProjectRoot") &&
      browse.includes("buildSharePointProjectBreadcrumbs"),
    "browse: containment/breadcrumb helpers missing",
  );
  assert(
    select.includes("isSharePointItemUnderProjectRoot"),
    "select: containment helper missing",
  );
});

Deno.test("C20C7 — select selection limits, canonical hash and persistence preserved", () => {
  assertEquals(/const MAX_ITEMS = (\d+);/.exec(select)?.[1], "50");
  assert(
    select.includes("const canonical = `${siteId}|${driveId}|${itemId}`") &&
      select.includes("sha256Hex(canonical)"),
    "select: canonical server-owned hash changed",
  );
  assert(
    select.includes("const siteId = root.siteId;") &&
      select.includes("const driveId = root.driveId;"),
    "select: server-authoritative site/drive assignment changed",
  );
  assert(
    select.includes('.from("governance_record_evidence_files")') &&
      select.includes(".insert({"),
    "select: evidence-file insert path changed",
  );
  for (const field of [
    "item_reference_hash: refHash",
    "selected_by: userData.user.id",
    "created_by: userData.user.id",
    "updated_by: userData.user.id",
    'source_system: "sharepoint"',
    "organization_id: organizationId",
    "workspace_id: workspaceId",
    "project_id: projectId",
  ]) {
    assert(select.includes(field), `select: insert field missing (${field})`);
  }
  assert(
    !/encrypt\(/i.test(select),
    "select: TypeScript-side encryption introduced",
  );
});

Deno.test("C20C7 — activity metadata stays sanitized and no sensitive logging added", () => {
  assert(
    select.includes('_event_type: "governance_record_evidence_files_selected"'),
    "select: activity event changed",
  );
  const meta = select.slice(ix(select, "_metadata: {"), ix(select, "_workspace_id: workspaceId"));
  for (const bad of ["file_name", "sharepoint_web_url", "site_id", "drive_id", "item_id"]) {
    assert(!meta.includes(bad), `select: activity metadata leaks ${bad}`);
  }
  for (const [name, src] of sources) {
    for (const bad of ["accessToken", "graphToken", "bytes"]) {
      assert(
        !new RegExp(`logSafe\\([^)]*${bad}`).test(src),
        `${name}: ${bad} logged`,
      );
    }
  }
});

Deno.test("C20C7 — no external API / MCP / trusted / service-role auth bypass", () => {
  for (const [name, src] of sources) {
    for (const bad of [
      "resolveTrustedExecutionContext",
      "assertCapability",
      "x-btpm-service",
      "mcp",
      "client_credentials",
      "SUPABASE_SERVICE_ROLE_KEY as caller",
    ]) {
      assert(!src.includes(bad), `${name}: bypass surface ${bad} introduced`);
    }
  }
});

Deno.test("C20C7 — frontend caller contracts unchanged", () => {
  assert(
    hook.includes("useBrowseGovernanceDecisionSharePointFiles") &&
      hook.includes("useSelectGovernanceDecisionSharePointEvidenceFiles"),
    "hook: evidence file hooks changed",
  );
  assert(
    service.includes('"browse-governance-decision-sharepoint-files"') &&
      service.includes('"select-governance-decision-sharepoint-evidence-files"') &&
      service.includes("body: { recordId, folderDriveId, folderItemId }") &&
      service.includes("body: { recordId, items }"),
    "service: browser invocation payload changed",
  );
});

Deno.test("C20C7 — no database function or SQL was added by this step", () => {
  for (const [name, src] of sources) {
    assert(
      !/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(src),
      `${name}: SQL function definition embedded`,
    );
    assert(
      !/CREATE\s+POLICY|GRANT\s+/i.test(src),
      `${name}: schema/RLS statement embedded`,
    );
  }
});
