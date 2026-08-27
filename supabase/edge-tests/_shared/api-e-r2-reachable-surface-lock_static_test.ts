// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-e-r2-reachable-surface-lock_static_test.ts', import.meta.url).href;
// API-E.R2 — Reachable-surface lock static contract test.
//
// This test is purely static and read-only. It performs no runtime database
// operation, no network call, and no SQL parsing. It validates that the
// canonical manifest at
// `docs/governance/api/evidence/API_E_REACHABLE_SURFACE_LOCK.json` is
// internally consistent and reproducible from the committed API-E.4A
// runtime-surface snapshot without re-analysing SQL.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);
const MANIFEST_URL = new URL(
  "docs/governance/api/evidence/API_E_REACHABLE_SURFACE_LOCK.json",
  REPO_ROOT,
);
const SNAPSHOT_URL = new URL(
  "docs/governance/api/evidence/API_E4A_RUNTIME_SURFACE_SNAPSHOT.json",
  REPO_ROOT,
);
const E3A_URL = new URL(
  "docs/governance/api/API_E3A_DIRECT_TABLE_READ_INVENTORY.md",
  REPO_ROOT,
);
const E4A_MD_URL = new URL(
  "docs/governance/api/API_E4A_REMAINING_DIRECT_BYPASS_INVENTORY.md",
  REPO_ROOT,
);
const FUNCTIONS_DIR = new URL("supabase/functions/", REPO_ROOT);

const EXPECTED_PMG_31: readonly string[] = [
  "append_execution_update",
  "append_kpi_update",
  "apply_backlog_item_create",
  "apply_backlog_item_update",
  "apply_governance_record_create",
  "apply_governance_record_update",
  "apply_kpi_definition_create",
  "apply_kpi_definition_update",
  "apply_phase_create",
  "apply_phase_update",
  "apply_program_create",
  "apply_program_update",
  "apply_project_create_blank",
  "apply_project_raci_add",
  "apply_project_raci_remove",
  "apply_project_status_transition",
  "apply_project_team_member_add",
  "apply_project_team_member_remove",
  "apply_project_team_member_role_update",
  "apply_project_update",
  "apply_sprint_create",
  "apply_sprint_update",
  "apply_task_assignee_set",
  "apply_task_create",
  "apply_task_execution_change",
  "apply_task_update",
  "create_dependency",
  "remove_dependency",
  "reorder_backlog_items",
  "reorder_phases",
  "reorder_tasks",
];

const EXPECTED_RISK_BLOCKER: readonly string[] = [
  "create_blocker_with_links",
  "create_risk_with_links",
  "list_decrypted_blockers",
  "list_decrypted_risks",
  "list_project_all_blockers",
  "list_project_all_risks",
  "update_blocker_with_links",
  "update_risk_with_links",
];

const EXPECTED_ADMIN_IMPORT_BASE = "commit_btpm_import_v1_core";

const APPROVED_GUARDS: readonly string[] = [
  "is_org_admin",
  "_assert_admin",
  "_assert_pm_or_admin",
  "_assert_tenant_admin_caller",
  "_assert_tenant_admin_or_super",
];

const EXPECTED_EDGE_NON_USER: readonly string[] = [
  "btpm-api-v1",
  "process-notifications",
  "run-kpi-app-scheduler-cron",
  "run-kpi-snapshot-capture-scheduler-cron",
  "send-password-reset",
];

const ALLOWED_PROTECTION_CATEGORIES: ReadonlySet<string> = new Set([
  "exact service-role bearer authentication",
  "scheduler shared-secret protection",
  "service-role-administered endpoint",
  "delegated OAuth API with gateway JWT and application authorization",
]);


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function readJson<T = unknown>(url: URL): Promise<T> {
  return JSON.parse(await Deno.readTextFile(url)) as T;
}

function assertSortedUnique(label: string, arr: readonly string[]) {
  for (let i = 1; i < arr.length; i++) {
    assert(
      arr[i - 1] < arr[i],
      `${label} must be sorted and unique; violation at index ${i}: ` +
        `"${arr[i - 1]}" vs "${arr[i]}"`,
    );
  }
}

// deno-lint-ignore no-explicit-any
type Manifest = any;

async function loadManifest(): Promise<Manifest> {
  return await readJson<Manifest>(MANIFEST_URL);
}

// ---------------------------------------------------------------------------
// 1. Structural validation
// ---------------------------------------------------------------------------
Deno.test("API-E.R2: manifest JSON is valid and uses fixed schema_version 1", async () => {
  const m = await loadManifest();
  assertEquals(m.schema_version, 1);
  assertEquals(m.step, "API-E.R2");
  assertEquals(
    m.snapshot_source,
    "docs/governance/api/evidence/API_E4A_RUNTIME_SURFACE_SNAPSHOT.json",
  );
});

Deno.test("API-E.R2: every recorded array is sorted and unique", async () => {
  const m = await loadManifest();

  const pmgBases = m.pmg_command_rpcs.entries.map((e: {base_name: string}) => e.base_name);
  assertSortedUnique("pmg_command_rpcs.entries[].base_name", pmgBases);
  for (const e of m.pmg_command_rpcs.entries) {
    assertSortedUnique(`pmg entry ${e.base_name}.signatures`, e.signatures);
  }

  assertSortedUnique(
    "admin_import.signatures",
    m.admin_import.signatures,
  );

  const rbBases = m.risk_blocker_rpcs.entries.map((e: {base_name: string}) => e.base_name);
  assertSortedUnique("risk_blocker_rpcs.entries[].base_name", rbBases);
  for (const e of m.risk_blocker_rpcs.entries) {
    assertSortedUnique(`rb entry ${e.base_name}.signatures`, e.signatures);
  }

  assertSortedUnique(
    "category_a_direct_read_tables.tables",
    m.category_a_direct_read_tables.tables,
  );

  const catASigs = m.category_a_rpc_candidates.entries.map(
    (e: {signature: string}) => e.signature,
  );
  assertSortedUnique("category_a_rpc_candidates.entries[].signature", catASigs);

  const adminSigs = m.admin_guarded_rpc_candidates.entries.map(
    (e: {signature: string}) => e.signature,
  );
  assertSortedUnique("admin_guarded_rpc_candidates.entries[].signature", adminSigs);

  assertSortedUnique(
    "edge_functions_user_session.names",
    m.edge_functions_user_session.names,
  );
  const nonUserNames = m.edge_functions_non_user.entries.map(
    (e: {name: string}) => e.name,
  );
  assertSortedUnique("edge_functions_non_user.entries[].name", nonUserNames);
});

// ---------------------------------------------------------------------------
// 2. PMG-31 manifest contract and Admin Import separation
// ---------------------------------------------------------------------------
Deno.test("API-E.R2: PMG list is exactly the reviewed 31-name allowlist", async () => {
  const m = await loadManifest();
  const bases: string[] = m.pmg_command_rpcs.entries.map((e: {base_name: string}) => e.base_name);
  assertEquals(bases.length, 31);
  assertEquals(bases, [...EXPECTED_PMG_31]);
});

Deno.test("API-E.R2: Admin Import is separate and not duplicated in PMG-31", async () => {
  const m = await loadManifest();
  assertEquals(m.admin_import.base_name, EXPECTED_ADMIN_IMPORT_BASE);
  assertEquals(m.admin_import.containment_gate, "public.is_org_admin");
  const bases: string[] = m.pmg_command_rpcs.entries.map((e: {base_name: string}) => e.base_name);
  assert(
    !bases.includes(EXPECTED_ADMIN_IMPORT_BASE),
    "Admin Import base name must not appear inside the PMG-31 list",
  );
});

// ---------------------------------------------------------------------------
// 3. Risk / Blocker names are exact
// ---------------------------------------------------------------------------
Deno.test("API-E.R2: Risk/Blocker set is exactly the 8 expected base names", async () => {
  const m = await loadManifest();
  const bases: string[] = m.risk_blocker_rpcs.entries.map((e: {base_name: string}) => e.base_name);
  assertEquals(bases, [...EXPECTED_RISK_BLOCKER]);
});

// ---------------------------------------------------------------------------
// 4. Category A tables — 62 exactly, matches E3A fenced inventory
// ---------------------------------------------------------------------------
async function extractE3ACategoryATables(): Promise<string[]> {
  const md = await Deno.readTextFile(E3A_URL);
  // Section 3 rows follow the pattern: | <n> | `<table>` | ...
  const re = /^\|\s*\d+\s*\|\s*`([a-z_][a-z0-9_]*)`/gm;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) names.add(m[1]);
  return [...names].sort();
}

Deno.test("API-E.R2: Category A remains exactly 62 tables and matches the E3A inventory", async () => {
  const m = await loadManifest();
  const manifestTables: string[] = m.category_a_direct_read_tables.tables;
  assertEquals(manifestTables.length, 62);
  const docTables = await extractE3ACategoryATables();
  assertEquals(docTables.length, 62);
  assertEquals(manifestTables, docTables);
});

// ---------------------------------------------------------------------------
// 5. Signatures resolved only from the committed snapshot
// ---------------------------------------------------------------------------
interface SnapshotFunction {
  signature: string;
  base_name: string;
  prosecdef: boolean;
  authenticated_execute: boolean;
  business_operations?: Array<{ relation?: string }>;
  public_relations?: string[];
  approved_gate_occurrences?: Array<{ gate?: string }>;
  assertion_guards?: Array<{ gate?: string } | string>;
  rejecting_boolean_guards?: Array<{ gate?: string } | string>;
  classification: string;
  classification_reason: string;
}
interface Snapshot {
  schema_version: number;
  functions: SnapshotFunction[];
}

async function loadSnapshot(): Promise<Snapshot> {
  return await readJson<Snapshot>(SNAPSHOT_URL);
}

function signaturesForBase(snap: Snapshot, base: string): string[] {
  return [
    ...new Set(
      snap.functions.filter((f) => f.base_name === base).map((f) => f.signature),
    ),
  ].sort();
}

Deno.test("API-E.R2: PMG-31 signatures equal the snapshot's exact overloads per base", async () => {
  const m = await loadManifest();
  const snap = await loadSnapshot();
  for (const entry of m.pmg_command_rpcs.entries) {
    const expected = signaturesForBase(snap, entry.base_name);
    assert(
      expected.length > 0,
      `PMG base ${entry.base_name} missing from snapshot`,
    );
    assertEquals(entry.signatures, expected);
  }
});

Deno.test("API-E.R2: Admin Import signatures equal the snapshot overloads", async () => {
  const m = await loadManifest();
  const snap = await loadSnapshot();
  const expected = signaturesForBase(snap, EXPECTED_ADMIN_IMPORT_BASE);
  assert(expected.length > 0, "Admin Import base missing from snapshot");
  assertEquals(m.admin_import.signatures, expected);
});

Deno.test("API-E.R2: Risk/Blocker signatures equal the snapshot overloads per base", async () => {
  const m = await loadManifest();
  const snap = await loadSnapshot();
  for (const entry of m.risk_blocker_rpcs.entries) {
    const expected = signaturesForBase(snap, entry.base_name);
    assert(
      expected.length > 0,
      `Risk/Blocker base ${entry.base_name} missing from snapshot`,
    );
    assertEquals(entry.signatures, expected);
  }
});

// ---------------------------------------------------------------------------
// 6. Category A RPC candidates — reproduced only by snapshot filter
// ---------------------------------------------------------------------------
Deno.test("API-E.R2: Category A RPC candidates reproduce from snapshot filter alone", async () => {
  const m = await loadManifest();
  const snap = await loadSnapshot();
  const catA: string[] = m.category_a_direct_read_tables.tables;
  const catASet = new Set(catA.map((t) => `public.${t}`));

  const rebuilt: Array<{
    signature: string;
    base_name: string;
    referenced_category_a_tables: string[];
    classification: string;
    classification_reason: string;
  }> = [];
  for (const f of snap.functions) {
    if (!f.authenticated_execute || !f.prosecdef) continue;
    const refs = new Set<string>();
    for (const op of f.business_operations ?? []) {
      if (op.relation && catASet.has(op.relation)) refs.add(op.relation);
    }
    for (const r of f.public_relations ?? []) {
      if (catASet.has(r)) refs.add(r);
    }
    if (refs.size === 0) continue;
    rebuilt.push({
      signature: f.signature,
      base_name: f.base_name,
      referenced_category_a_tables: [...refs]
        .map((r) => r.replace(/^public\./, ""))
        .sort(),
      classification: f.classification,
      classification_reason: f.classification_reason,
    });
  }
  rebuilt.sort((a, b) => (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));

  assertEquals(
    m.category_a_rpc_candidates.count,
    rebuilt.length,
    "manifest count for Category A RPC candidates does not match snapshot filter",
  );
  assertEquals(m.category_a_rpc_candidates.entries, rebuilt);
});

// ---------------------------------------------------------------------------
// 7. Admin-guarded RPC candidates — reproduced only by snapshot filter
// ---------------------------------------------------------------------------
Deno.test("API-E.R2: Admin-guarded RPC candidates reproduce from snapshot guard filter alone", async () => {
  const m = await loadManifest();
  const snap = await loadSnapshot();
  const approved = new Set(APPROVED_GUARDS);
  assertEquals(m.admin_guarded_rpc_candidates.approved_guards, APPROVED_GUARDS);

  const rebuilt: Array<{
    signature: string;
    base_name: string;
    guard_names: string[];
    classification: string;
    classification_reason: string;
  }> = [];
  for (const f of snap.functions) {
    if (!f.authenticated_execute) continue;
    const guards = new Set<string>();
    for (const occ of f.approved_gate_occurrences ?? []) {
      if (occ.gate && approved.has(occ.gate)) guards.add(occ.gate);
    }
    for (const ag of f.assertion_guards ?? []) {
      const g = typeof ag === "string" ? ag : ag.gate;
      if (g && approved.has(g)) guards.add(g);
    }
    for (const rg of f.rejecting_boolean_guards ?? []) {
      const g = typeof rg === "string" ? rg : rg.gate;
      if (g && approved.has(g)) guards.add(g);
    }
    if (guards.size === 0) continue;
    rebuilt.push({
      signature: f.signature,
      base_name: f.base_name,
      guard_names: [...guards].sort(),
      classification: f.classification,
      classification_reason: f.classification_reason,
    });
  }
  rebuilt.sort((a, b) => (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));

  assertEquals(m.admin_guarded_rpc_candidates.count, rebuilt.length);
  assertEquals(m.admin_guarded_rpc_candidates.entries, rebuilt);
});

// ---------------------------------------------------------------------------
// 8. Edge universe — matches the actual repository tree, exact split
// ---------------------------------------------------------------------------
async function enumerateEdgeFunctions(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(FUNCTIONS_DIR)) {
    if (!entry.isDirectory) continue;
    if (entry.name === "_shared") continue;
    // Confirm an index.ts exists in the directory.
    try {
      const stat = await Deno.stat(
        new URL(`${entry.name}/index.ts`, FUNCTIONS_DIR),
      );
      if (stat.isFile) names.push(entry.name);
    } catch {
      // no index.ts — skip
    }
  }
  return names.sort();
}

Deno.test("API-E.R2: Edge universe equals the current supabase/functions/*/index.ts tree", async () => {
  const m = await loadManifest();
  const treeNames = await enumerateEdgeFunctions();
  const userSession: string[] = m.edge_functions_user_session.names;
  const nonUser: string[] = m.edge_functions_non_user.entries.map(
    (e: { name: string }) => e.name,
  );

  assertEquals(userSession.length, 57, "user-session Edge count must be 57");
  assertEquals(nonUser.length, 5, "non-user Edge count must be 5");

  assertEquals(nonUser, [...EXPECTED_EDGE_NON_USER]);

  const overlap = userSession.filter((n) => nonUser.includes(n));
  assertEquals(overlap, [], "user-session and non-user Edge sets must be disjoint");

  const union = [...userSession, ...nonUser].sort();
  assertEquals(
    union,
    treeNames,
    "manifest Edge universe must equal the repository index.ts tree exactly",
  );

  // Every non-user entry must carry an allowed protection category.
  for (const entry of m.edge_functions_non_user.entries) {
    assert(
      ALLOWED_PROTECTION_CATEGORIES.has(entry.protection_category),
      `Edge non-user ${entry.name} carries unknown protection_category ` +
        `"${entry.protection_category}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// 9. Locked user-session set must equal the E4A markdown fenced block
// ---------------------------------------------------------------------------
Deno.test("API-E.R2: user-session Edge set matches the E4A fenced requires_edge_gate block", async () => {
  const m = await loadManifest();
  const md = await Deno.readTextFile(E4A_MD_URL);
  const fenceRe = /```edge-requires-gate\n([\s\S]*?)\n```/;
  const fence = fenceRe.exec(md);
  assert(fence, "E4A markdown missing edge-requires-gate fenced block");
  const docNames = fence[1]
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort();
  assertEquals(docNames.length, 57);
  assertEquals(m.edge_functions_user_session.names, docNames);
});
