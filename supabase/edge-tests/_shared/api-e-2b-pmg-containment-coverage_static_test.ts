// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-e-2b-pmg-containment-coverage_static_test.ts', import.meta.url).href;
// API-E.2B — PMG containment coverage proof (static contract test).
//
// This test statically inspects the timestamp-ordered SQL migrations and
// proves that every canonical non-admin PMG RPC in the hard-coded reviewed
// allowlist reaches the shared active-user gate (`public.is_active_user(...)`)
// in its final effective definition, and is therefore covered by API-E.2A
// OAuth containment.
//
// Scope:
//   * Read-only static inspection of `supabase/migrations/**.sql`.
//   * Covers the 31 canonical non-admin PMG RPCs in the reviewed allowlist.
//   * Explicitly excludes the Admin Import RPC `commit_btpm_import_v1_core`,
//     which is separately classified and whose OAuth-containment coverage is
//     handled by its dedicated guard.
//   * Does not touch runtime code, database state, PMG functions, RLS,
//     grants, UI, edge functions, packages, generated types, governance
//     docs, or release metadata.
//   * The allowlist below is hard-coded so that additions or removals are
//     reviewable in the diff.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);

// ---------------------------------------------------------------------------
// The single Admin Import RPC that is explicitly out of scope for this
// canonical non-admin PMG guard and covered separately.
// ---------------------------------------------------------------------------
const ADMIN_IMPORT_RPC = "commit_btpm_import_v1_core";

// ---------------------------------------------------------------------------
// Hard-coded allowlist — exactly the 31 canonical non-admin PMG RPCs.
// Admin Import is intentionally excluded and covered separately.
// ---------------------------------------------------------------------------
const PMG_RPCS_31: readonly string[] = [
  // Phase and Task planning
  "apply_phase_create",
  "apply_phase_update",
  "reorder_phases",
  "apply_task_create",
  "apply_task_update",
  "reorder_tasks",
  // Task execution and assignment
  "apply_task_execution_change",
  "append_execution_update",
  "apply_task_assignee_set",
  // Project
  "apply_project_create_blank",
  "apply_project_update",
  "apply_project_status_transition",
  // Program
  "apply_program_create",
  "apply_program_update",
  // KPI
  "apply_kpi_definition_create",
  "apply_kpi_definition_update",
  "append_kpi_update",
  // Governance
  "apply_governance_record_create",
  "apply_governance_record_update",
  // Dependency
  "create_dependency",
  "remove_dependency",
  // Project Team and RACI
  "apply_project_team_member_add",
  "apply_project_team_member_role_update",
  "apply_project_team_member_remove",
  "apply_project_raci_add",
  "apply_project_raci_remove",
  // Agile Backlog and Sprints
  "apply_backlog_item_create",
  "apply_backlog_item_update",
  "reorder_backlog_items",
  "apply_sprint_create",
  "apply_sprint_update",
];

// Mutation statement heads that must not appear before the is_active_user gate.
const MUTATION_STATEMENTS: readonly RegExp[] = [
  /\bINSERT\s+INTO\s+public\./i,
  /\bUPDATE\s+public\./i,
  /\bDELETE\s+FROM\s+public\./i,
];

// ---------------------------------------------------------------------------
// Migration loading
// ---------------------------------------------------------------------------
interface Migration {
  name: string;
  text: string;
}

async function loadMigrations(): Promise<Migration[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort(); // timestamp-prefixed → lexical sort == chronological order
  const out: Migration[] = [];
  for (const name of names) {
    out.push({
      name,
      text: await Deno.readTextFile(new URL(name, MIGRATIONS_DIR)),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Function body extraction
// ---------------------------------------------------------------------------
interface EffectiveDefinition {
  rpc: string;
  migration: string;
  header: string; // from CREATE OR REPLACE ... up to the AS $tag$
  body: string; // between the opening $tag$ and matching closing $tag$
  fullDefinition: string; // header + body + closing tag
}

function findAllCreateOffsets(text: string, rpc: string): number[] {
  // Match: CREATE OR REPLACE FUNCTION public.<rpc>(
  //   allowing any whitespace between tokens and before '('.
  const re = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${rpc}\\s*\\(`,
    "gi",
  );
  const offsets: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) offsets.push(m.index);
  return offsets;
}

function extractDefinitionAt(text: string, startIdx: number): {
  header: string;
  body: string;
  full: string;
} | null {
  // Find opening $tag$ after startIdx (tag may be empty or an identifier).
  const openRe = /AS\s+\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  openRe.lastIndex = startIdx;
  const openMatch = openRe.exec(text);
  if (!openMatch) return null;
  const tag = openMatch[1] ?? "";
  const closeMarker = `$${tag}$`;
  const bodyStart = openMatch.index + openMatch[0].length;
  const bodyEnd = text.indexOf(closeMarker, bodyStart);
  if (bodyEnd === -1) return null;
  const header = text.slice(startIdx, openMatch.index + openMatch[0].length);
  const body = text.slice(bodyStart, bodyEnd);
  const full = text.slice(startIdx, bodyEnd + closeMarker.length);
  return { header, body, full };
}

function resolveEffectiveDefinition(
  rpc: string,
  migrations: Migration[],
): EffectiveDefinition {
  // Walk migrations newest → oldest; use the LAST create offset in the
  // newest migration that defines the RPC.
  for (let i = migrations.length - 1; i >= 0; i--) {
    const mig = migrations[i];
    const offsets = findAllCreateOffsets(mig.text, rpc);
    if (offsets.length === 0) continue;
    const startIdx = offsets[offsets.length - 1];
    const extracted = extractDefinitionAt(mig.text, startIdx);
    if (!extracted) {
      throw new Error(
        `Could not extract $tag$-delimited body for ${rpc} in ${mig.name}`,
      );
    }
    return {
      rpc,
      migration: mig.name,
      header: extracted.header,
      body: extracted.body,
      fullDefinition: extracted.full,
    };
  }
  throw new Error(`No CREATE OR REPLACE FUNCTION public.${rpc}(...) found`);
}

// ---------------------------------------------------------------------------
// Assertions on a single RPC
// ---------------------------------------------------------------------------
function firstMutationIndex(body: string): number {
  let earliest = -1;
  for (const re of MUTATION_STATEMENTS) {
    const m = re.exec(body);
    if (m && (earliest === -1 || m.index < earliest)) earliest = m.index;
  }
  return earliest;
}

function assertRpcContract(def: EffectiveDefinition): void {
  // 1) SECURITY DEFINER in header
  assert(
    /\bSECURITY\s+DEFINER\b/i.test(def.header),
    `${def.rpc}: SECURITY DEFINER missing in effective header`,
  );

  // 2) Fixed search_path in header
  assert(
    /\bSET\s+search_path\b/i.test(def.header),
    `${def.rpc}: fixed SET search_path missing in effective header`,
  );

  // 3) Body invokes is_active_user(...) before any data-mutation statement.
  const gateRe = /\bpublic\.is_active_user\s*\(|\bis_active_user\s*\(/;
  const gateMatch = gateRe.exec(def.body);
  assert(
    gateMatch !== null,
    `${def.rpc}: body does not invoke is_active_user(...) — not covered by API-E.2A OAuth containment`,
  );
  const mutationIdx = firstMutationIndex(def.body);
  if (mutationIdx !== -1) {
    assert(
      gateMatch!.index < mutationIdx,
      `${def.rpc}: is_active_user(...) gate appears after first public.* mutation`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
Deno.test("API-E.2B — allowlist has exactly 31 unique canonical non-admin PMG RPC names", () => {
  assertEquals(
    PMG_RPCS_31.length,
    31,
    "hard-coded allowlist must contain exactly 31 entries",
  );
  const unique = new Set(PMG_RPCS_31);
  assertEquals(
    unique.size,
    31,
    "hard-coded allowlist must contain 31 unique names",
  );
  assert(
    !unique.has(ADMIN_IMPORT_RPC),
    `allowlist must not include the Admin Import RPC '${ADMIN_IMPORT_RPC}'`,
  );
});

Deno.test(
  "API-E.2B — every canonical PMG RPC final definition satisfies API-E.2A containment contract",
  async () => {
    const migrations = await loadMigrations();
    assert(migrations.length > 0, "no migrations found");

    const definitions = new Map<string, EffectiveDefinition>();
    for (const rpc of PMG_RPCS_31) {
      const def = resolveEffectiveDefinition(rpc, migrations);
      definitions.set(rpc, def);
    }

    // Each RPC's effective definition must appear exactly once in its
    // defining migration (i.e. that migration re-defines it at most once
    // and no later migration supersedes it — resolveEffectiveDefinition
    // already picks the last migration containing the RPC, so we just
    // assert the count is exactly 1 within that migration).
    for (const rpc of PMG_RPCS_31) {
      const def = definitions.get(rpc)!;
      const mig = migrations.find((m) => m.name === def.migration)!;
      const offsets = findAllCreateOffsets(mig.text, rpc);
      assertEquals(
        offsets.length,
        1,
        `${rpc}: effective defining migration must declare it exactly once (found ${offsets.length} in ${def.migration})`,
      );
    }

    // Per-RPC contract assertions.
    for (const rpc of PMG_RPCS_31) {
      assertRpcContract(definitions.get(rpc)!);
    }
  },
);

Deno.test(
  "API-E.2B — this static test does not itself alter EXECUTE grant posture",
  async () => {
    // The test file must not contain SQL that changes GRANT/REVOKE EXECUTE
    // on any of the 31 canonical PMG RPCs. This is a self-check: the test
    // performs only static reads.
    const selfPath = new URL(__BTPM_SELF_URL__);
    const self = await Deno.readTextFile(selfPath);
    for (const rpc of PMG_RPCS_31) {
      const grantRe = new RegExp(
        `(GRANT|REVOKE)\\s+EXECUTE[^;]*\\bpublic\\.${rpc}\\b`,
        "i",
      );
      assert(
        !grantRe.test(self),
        `this test must not contain GRANT/REVOKE EXECUTE for ${rpc}`,
      );
    }
  },
);
