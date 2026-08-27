// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-e-3a-direct-table-read-inventory_static_test.ts', import.meta.url).href;
// API-E.3A — Direct-Table-Read Containment Inventory (static contract test).
//
// This test is inventory-only. It statically verifies that:
//
//   1. The hard-coded Category A allowlist below contains exactly 62
//      unique, alphabetically sorted table names.
//   2. The inventory document
//      `docs/governance/api/API_E3A_DIRECT_TABLE_READ_INVENTORY.md`
//      declares the same Category A set (parsed from the fenced
//      allowlist block).
//   3. Every Category A table exists in the timestamp-ordered
//      `supabase/migrations/**.sql` baseline with:
//         - a `CREATE TABLE public.<name>` statement,
//         - an `ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY`
//           statement,
//         - at least one `CREATE POLICY ... ON public.<name> FOR SELECT
//           ... TO ... (authenticated | PUBLIC)` statement.
//   4. The Category A allowlist does not include any API-C / API-D
//      control table, `auth.*`, `storage.*`, audit-only server table
//      (from an explicit forbidden set), or `btpm_import_batches`.
//   5. No API-E.3 migration or restrictive OAuth read policy has been
//      introduced by this step — the repository must contain no
//      migration whose text carries an "API-E.3" containment marker.
//
// This test does not touch runtime code, database state, RLS, grants,
// UI, edge functions, packages, generated types, or release metadata.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const INVENTORY_DOC = new URL(
  "../../../docs/governance/api/API_E3A_DIRECT_TABLE_READ_INVENTORY.md",
  __BTPM_SRC_BASE__,
);

// ---------------------------------------------------------------------------
// Hard-coded Category A allowlist — 62 alphabetically sorted names.
// Mirrors the fenced block in the inventory document.
// ---------------------------------------------------------------------------
const CATEGORY_A_ALLOWLIST: readonly string[] = [
  "activity_events",
  "adoption_initiatives",
  "adoption_object_links",
  "adoption_plans",
  "adoption_template_initiatives",
  "adoption_template_tasks",
  "adoption_templates",
  "backlog_items",
  "blockers",
  "board_workflow_states",
  "comments",
  "decision_case_ai_run_files",
  "decision_case_ai_runs",
  "dependencies",
  "entity_object_links",
  "entity_user_links",
  "execution_updates",
  "generated_operational_documents",
  "governance_cadences",
  "governance_record_brief_versions",
  "governance_record_btpm_context_links",
  "governance_record_copilot_data_packages",
  "governance_record_cross_project_links",
  "governance_record_decision_outcomes",
  "governance_record_decisions",
  "governance_record_evidence_files",
  "governance_record_evidence_references",
  "governance_record_links",
  "governance_record_stakeholder_packages",
  "governance_records",
  "kpi_app_external_kpis",
  "kpi_app_mappings",
  "kpi_definitions",
  "kpi_schedule_policies",
  "kpi_snapshots",
  "kpi_updates",
  "phases",
  "portfolio_item_team_members",
  "portfolio_items",
  "programs",
  "project_benefits",
  "project_closure_summaries",
  "project_lessons_learned_documents",
  "project_people_preset_members",
  "project_people_presets",
  "project_stakeholders",
  "project_team_members",
  "project_templates",
  "projects",
  "raci_assignments",
  "risks",
  "roadmap_story_ai_run_files",
  "roadmap_story_ai_runs",
  "roadmap_story_pack_external_files",
  "roadmap_story_pack_notes",
  "roadmap_story_pack_sources",
  "roadmap_story_pack_versions",
  "roadmap_story_packs",
  "sharepoint_project_bindings",
  "sprints",
  "task_assignments",
  "tasks",
];

// Tables that must NEVER appear in the Category A allowlist.
const FORBIDDEN_IN_ALLOWLIST: readonly string[] = [
  // API-C / API-D control substrate
  "api_clients",
  "api_client_policy_versions",
  "api_organization_client_enablements",
  "api_workspace_client_enablements",
  "api_user_policy_acknowledgements",
  "api_capability_grants",
  "api_consent_audit_events",
  // Admin Import (separately governed under PMG §2.10 / API-E.2C)
  "btpm_import_batches",
  // Audit / server-only tables
  "admin_authority_audit",
  "pmg_command_audit",
  "tenant_secret_access_audit",
  "outbound_email_events",
  "email_payload_snapshots",
  "platform_background_jobs",
  "tenant_background_jobs",
  "tenant_scheduler_runs",
  "kpi_app_scheduler_runs",
  "kpi_app_scheduler_run_items",
  "kpi_app_submission_attempts",
  "kpi_app_submission_outbox",
  "kpi_snapshot_capture_runs",
  "kpi_snapshot_capture_run_items",
  "tenant_import_temp_objects",
  "tenant_storage_objects",
];

// ---------------------------------------------------------------------------
// Migration loading (timestamp-ordered).
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
  names.sort();
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
// Regex helpers.
// ---------------------------------------------------------------------------
function createTableRe(name: string): RegExp {
  return new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?public\\.${name}\\b`,
    "i",
  );
}

function enableRlsRe(name: string): RegExp {
  return new RegExp(
    `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?public\\.${name}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    "i",
  );
}

// Match CREATE POLICY blocks referencing this table with a SELECT command
// and a role list containing authenticated or PUBLIC.
function hasAuthenticatedSelectPolicy(text: string, name: string): boolean {
  const blockRe = new RegExp(
    `CREATE\\s+POLICY[\\s\\S]*?ON\\s+public\\.${name}\\b[\\s\\S]*?;`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const block = m[0];
    // Must be SELECT (or FOR ALL, which covers SELECT).
    const isSelect = /\bFOR\s+SELECT\b/i.test(block) ||
      /\bFOR\s+ALL\b/i.test(block);
    if (!isSelect) continue;
    const toAuthenticated = /\bTO\s+[^;]*\bauthenticated\b/i.test(block);
    const toPublic = /\bTO\s+[^;]*\bPUBLIC\b/i.test(block);
    // Absence of TO clause defaults to PUBLIC.
    const hasToClause = /\bTO\s+/i.test(block);
    if (toAuthenticated || toPublic || !hasToClause) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
Deno.test("API-E.3A — allowlist has exactly 62 unique alphabetically sorted names", () => {
  assertEquals(
    CATEGORY_A_ALLOWLIST.length,
    62,
    "Category A allowlist must contain exactly 62 entries",
  );
  const unique = new Set(CATEGORY_A_ALLOWLIST);
  assertEquals(unique.size, 62, "Category A allowlist must be unique");
  const sorted = [...CATEGORY_A_ALLOWLIST].sort();
  assertEquals(
    CATEGORY_A_ALLOWLIST,
    sorted as readonly string[],
    "Category A allowlist must be alphabetically sorted",
  );
});

Deno.test("API-E.3A — allowlist excludes API-C/API-D control, audit-only, and Admin Import tables", () => {
  for (const forbidden of FORBIDDEN_IN_ALLOWLIST) {
    assert(
      !CATEGORY_A_ALLOWLIST.includes(forbidden),
      `Category A allowlist must not include forbidden table '${forbidden}'`,
    );
  }
});

Deno.test("API-E.3A — allowlist does not name any auth/storage/reserved schema table", () => {
  // All entries must be bare `public` schema names — no schema-qualified
  // names such as `auth.users` or `storage.objects`.
  for (const name of CATEGORY_A_ALLOWLIST) {
    assert(
      !name.includes("."),
      `Category A entry '${name}' must be an unqualified public-schema table`,
    );
    assert(
      !name.startsWith("auth_") && !name.startsWith("storage_"),
      `Category A entry '${name}' must not shadow an auth/storage schema table`,
    );
  }
});

Deno.test(
  "API-E.3A — inventory document declares the same Category A set",
  async () => {
    const doc = await Deno.readTextFile(INVENTORY_DOC);
    const begin = doc.indexOf("<!-- BEGIN API-E.3A CATEGORY A ALLOWLIST -->");
    const end = doc.indexOf("<!-- END API-E.3A CATEGORY A ALLOWLIST -->");
    assert(begin !== -1 && end !== -1 && end > begin, "allowlist fence missing");
    const block = doc.slice(begin, end);
    const lineRe = /^-\s+`([a-z_][a-z0-9_]*)`\s*$/gm;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(block)) !== null) found.push(m[1]);
    const foundSet = new Set(found);

    assertEquals(
      found.length,
      CATEGORY_A_ALLOWLIST.length,
      `inventory doc allowlist must have exactly ${CATEGORY_A_ALLOWLIST.length} entries; got ${found.length}`,
    );
    assertEquals(
      foundSet.size,
      found.length,
      "inventory doc allowlist must contain unique names",
    );
    const expected = new Set(CATEGORY_A_ALLOWLIST);
    for (const name of expected) {
      assert(
        foundSet.has(name),
        `inventory doc allowlist missing '${name}'`,
      );
    }
    for (const name of foundSet) {
      assert(
        expected.has(name),
        `inventory doc allowlist has unexpected entry '${name}'`,
      );
    }
    // Also assert alphabetically sorted in the doc.
    const sorted = [...found].sort();
    assertEquals(
      found,
      sorted,
      "inventory doc allowlist must be alphabetically sorted",
    );
  },
);

Deno.test(
  "API-E.3A — every Category A table has CREATE TABLE, ENABLE RLS, and authenticated/PUBLIC SELECT policy in migrations",
  async () => {
    const migrations = await loadMigrations();
    assert(migrations.length > 0, "no migrations found");
    const missing: string[] = [];
    for (const name of CATEGORY_A_ALLOWLIST) {
      const createRe = createTableRe(name);
      const rlsRe = enableRlsRe(name);
      let hasCreate = false;
      let hasRls = false;
      let hasSelectPolicy = false;
      for (const mig of migrations) {
        if (!hasCreate && createRe.test(mig.text)) hasCreate = true;
        if (!hasRls && rlsRe.test(mig.text)) hasRls = true;
        if (!hasSelectPolicy && hasAuthenticatedSelectPolicy(mig.text, name)) {
          hasSelectPolicy = true;
        }
        if (hasCreate && hasRls && hasSelectPolicy) break;
      }
      if (!hasCreate) missing.push(`${name}: no CREATE TABLE public.${name}`);
      if (!hasRls) missing.push(`${name}: no ENABLE ROW LEVEL SECURITY`);
      if (!hasSelectPolicy) {
        missing.push(
          `${name}: no CREATE POLICY ... ON public.${name} FOR SELECT TO authenticated/PUBLIC`,
        );
      }
    }
    assertEquals(
      missing,
      [],
      `Category A tables missing baseline artifacts:\n  ${missing.join("\n  ")}`,
    );
  },
);

Deno.test(
  "API-E.3A — no API-E.3B restrictive containment migration has been introduced by this inventory step",
  async () => {
    const migrations = await loadMigrations();
    const offenders: string[] = [];
    // A restrictive OAuth read-containment migration would be branded with
    // an explicit `API-E.3B` header comment or use the marker phrase
    // "API-E.3B" in its restrictive policy DDL. Ambient references in
    // narrative comments from earlier phases (e.g. API-E.1 mentioning
    // "API-E.3 command wrappers") are permitted.
    const restrictiveMarkerRe =
      /(^\s*--[^\n]*API-E\.3B\b)|(\bAPI-E\.3B[^A-Za-z0-9]+RESTRICTIVE\b)/im;
    for (const mig of migrations) {
      if (restrictiveMarkerRe.test(mig.text)) offenders.push(mig.name);
    }
    assertEquals(
      offenders,
      [],
      `no restrictive API-E.3B migration may exist at the API-E.3A freeze; offenders:\n  ${offenders.join("\n  ")}`,
    );
  },
);

Deno.test(
  "API-E.3A — this static test performs no runtime database change",
  async () => {
    const self = await Deno.readTextFile(new URL(__BTPM_SELF_URL__));
    // The test file must not contain any executable SQL string
    // terminated by a semicolon that would resemble a runnable statement
    // (all SQL-shaped tokens in this file live inside JS regex literals
    // or Markdown-style comments describing the expected shape).
    const banned = [
      /["'`]\s*ALTER\s+TABLE\s+public\.[a-z_]+\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i,
      /["'`]\s*GRANT\s+[^"'`]+\s+TO\s+[^"'`]+;/i,
      /["'`]\s*REVOKE\s+[^"'`]+;/i,
    ];
    for (const re of banned) {
      assert(
        !re.test(self),
        `API-E.3A test must not contain executable SQL matching ${re}`,
      );
    }
  },
);

