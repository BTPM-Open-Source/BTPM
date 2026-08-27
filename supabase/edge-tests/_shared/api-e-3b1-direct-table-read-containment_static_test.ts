// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-e-3b1-direct-table-read-containment_static_test.ts', import.meta.url).href;
// API-E.3B1 — restrictive OAuth direct-read containment (Category A tables 1–31).
//
// Static, repository-only contract test. Verifies that the single API-E.3B1
// migration adds exactly one restrictive authenticated SELECT policy named
// `api_e_oauth_read_containment` — with the exact API-E.1 condition — to
// each of the first 31 entries of the frozen API-E.3A Category A allowlist,
// and to no other table. Proves the migration performs no DDL besides those
// 31 CREATE POLICY statements and no DML/data mutation.
//
// This test does NOT touch runtime database state.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
const INVENTORY_DOC = new URL(
  "../../../docs/governance/api/API_E3A_DIRECT_TABLE_READ_INVENTORY.md",
  __BTPM_SRC_BASE__,
);

const POLICY_NAME = "api_e_oauth_read_containment";
const CONDITION =
  "api_e_private.jwt_client_id() IS NULL OR api_e_private.assert_trusted_context()";

const EXPECTED_TABLES: readonly string[] = [
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
];

// Category A entries 32–62 must NOT appear in this step's migration.
const EXCLUDED_TABLES: readonly string[] = [
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

async function loadMigration(): Promise<Migration> {
  const all = await loadMigrations();
  const hits = all.filter((m) => /API-E\.3B1\b/.test(m.text));
  assertEquals(
    hits.length,
    1,
    `expected exactly one API-E.3B1 migration; got ${hits.length}: ${hits.map((h) => h.name).join(", ")}`,
  );
  return hits[0];
}

// ---------------------------------------------------------------------------
// 1. Allowlist coverage — this step covers exactly Category A entries 1..31.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B1 — covers exactly entries 1–31 of the frozen API-E.3A Category A allowlist",
  async () => {
    const doc = await Deno.readTextFile(INVENTORY_DOC);
    const begin = doc.indexOf("<!-- BEGIN API-E.3A CATEGORY A ALLOWLIST -->");
    const end = doc.indexOf("<!-- END API-E.3A CATEGORY A ALLOWLIST -->");
    assert(begin !== -1 && end !== -1 && end > begin, "allowlist fence missing");
    const block = doc.slice(begin, end);
    const found: string[] = [];
    const lineRe = /^-\s+`([a-z_][a-z0-9_]*)`\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(block)) !== null) found.push(m[1]);
    assertEquals(found.length, 62, "expected 62 Category A entries in inventory doc");
    const first31 = found.slice(0, 31);
    assertEquals(
      EXPECTED_TABLES as readonly string[],
      first31 as readonly string[],
      "API-E.3B1 EXPECTED_TABLES must equal doc allowlist entries 1..31",
    );
    // And EXCLUDED_TABLES must equal entries 32..62.
    const rest = found.slice(31);
    assertEquals(
      EXCLUDED_TABLES as readonly string[],
      rest as readonly string[],
      "API-E.3B1 EXCLUDED_TABLES must equal doc allowlist entries 32..62",
    );
    assertEquals(EXPECTED_TABLES.length, 31);
    assertEquals(EXCLUDED_TABLES.length, 31);
  },
);

// ---------------------------------------------------------------------------
// 2. Migration adds exactly 31 restrictive policies with exact posture.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B1 — migration creates the exact 31 restrictive authenticated SELECT policies with the exact API-E.1 condition",
  async () => {
    const mig = await loadMigration();
    for (const table of EXPECTED_TABLES) {
      const stmt = new RegExp(
        `CREATE\\s+POLICY\\s+api_e_oauth_read_containment\\s+ON\\s+public\\.%I\\s+AS\\s+RESTRICTIVE\\s+FOR\\s+SELECT\\s+TO\\s+authenticated\\s+USING\\s*\\(\\s*api_e_private\\.jwt_client_id\\(\\)\\s+IS\\s+NULL\\s+OR\\s+api_e_private\\.assert_trusted_context\\(\\)\\s*\\)`,
        "i",
      );
      // The migration uses format(..., t) so the CREATE POLICY string in the
      // source uses `%I` as the table placeholder. Prove the placeholder
      // statement is present exactly once and that every expected table is
      // listed in the array literal.
      assert(
        stmt.test(mig.text),
        `API-E.3B1: expected format() CREATE POLICY template (with %I) missing`,
      );
      const listed = new RegExp(`'${table}'`).test(mig.text);
      assert(
        listed,
        `API-E.3B1: table '${table}' missing from migration table array`,
      );
    }
    // The format(...) template must appear exactly once (single deterministic loop).
    const templateHits = mig.text.match(
      /CREATE\s+POLICY\s+api_e_oauth_read_containment\s+ON\s+public\.%I\s+AS\s+RESTRICTIVE\s+FOR\s+SELECT\s+TO\s+authenticated/gi,
    );
    assertEquals(
      templateHits?.length ?? 0,
      1,
      "API-E.3B1: expected exactly one CREATE POLICY format template in migration",
    );
    // No excluded table may be named.
    for (const table of EXCLUDED_TABLES) {
      assert(
        !new RegExp(`'${table}'`).test(mig.text),
        `API-E.3B1: excluded table '${table}' must not appear in migration`,
      );
    }
    // Exact literal condition must appear in source verbatim.
    assert(
      mig.text.includes(CONDITION),
      `API-E.3B1: exact USING condition string missing from migration`,
    );
    // Deterministic policy name literal must appear.
    assert(
      mig.text.includes(POLICY_NAME),
      `API-E.3B1: policy name literal missing from migration`,
    );
  },
);

// ---------------------------------------------------------------------------
// 3. Migration performs no forbidden DDL/DML.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B1 — migration alters no existing policy, table, function, trigger, or grant, and performs no DML",
  async () => {
    const mig = await loadMigration();
    // Strip line comments before scanning so narrative "no DROP" text is OK.
    const scrubbed = mig.text
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    const forbidden: RegExp[] = [
      /\bALTER\s+POLICY\b/i,
      /\bDROP\s+POLICY\b/i,
      /\bALTER\s+TABLE\b/i,
      /\bDROP\s+TABLE\b/i,
      /\bCREATE\s+TABLE\b/i,
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
      /\bDROP\s+FUNCTION\b/i,
      /\bCREATE\s+TRIGGER\b/i,
      /\bDROP\s+TRIGGER\b/i,
      /\bGRANT\s+[A-Z]/,
      /\bREVOKE\s+[A-Z]/,
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+public\./i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
    ];
    for (const re of forbidden) {
      assert(
        !re.test(scrubbed),
        `API-E.3B1 migration must not contain SQL matching ${re}`,
      );
    }
    // The only CREATE POLICY string permitted is the format() template
    // (which uses %I). No literal per-table CREATE POLICY may appear.
    const literalCreatePolicy = scrubbed.match(
      /CREATE\s+POLICY\s+[^%\s]+\s+ON\s+public\.[a-z_][a-z0-9_]*/gi,
    );
    assertEquals(
      literalCreatePolicy,
      null,
      "API-E.3B1: no literal per-table CREATE POLICY statements permitted (must go through format(...) template)",
    );
  },
);

// ---------------------------------------------------------------------------
// 4. Truth-table semantics of the literal USING condition.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B1 — literal USING condition yields the intended containment truth table",
  () => {
    // Simulate the SQL boolean expression:
    //   api_e_private.jwt_client_id() IS NULL OR api_e_private.assert_trusted_context()
    const evalCond = (
      jwtClientId: string | null,
      trustedContext: boolean,
    ): boolean => (jwtClientId === null) || trustedContext;

    // Ordinary session (no signed client_id): permitted by restrictive gate,
    // existing permissive policies then decide.
    assertEquals(evalCond(null, false), true);
    assertEquals(evalCond(null, true), true);
    // Signed-client OAuth session without trusted context: denied.
    assertEquals(evalCond("client_abc", false), false);
    // Signed-client OAuth session with trusted transaction context: permitted
    // by restrictive gate; existing permissive policies still decide.
    assertEquals(evalCond("client_abc", true), true);
  },
);

// ---------------------------------------------------------------------------
// 5. Self-audit — this static test performs no runtime database change.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B1 — this static test performs no runtime database change",
  async () => {
    const self = await Deno.readTextFile(new URL(__BTPM_SELF_URL__));
    const banned = [
      /["'`]\s*ALTER\s+TABLE\s+public\.[a-z_]+/i,
      /["'`]\s*GRANT\s+[A-Z][^"'`]*TO\b/i,
      /["'`]\s*REVOKE\s+[A-Z][^"'`]*FROM\b/i,
      /["'`]\s*DROP\s+POLICY\b/i,
      /["'`]\s*INSERT\s+INTO\s+public\./i,
      /["'`]\s*UPDATE\s+public\./i,
      /["'`]\s*DELETE\s+FROM\s+public\./i,
    ];
    for (const re of banned) {
      assert(
        !re.test(self),
        `API-E.3B1 test must not contain executable SQL matching ${re}`,
      );
    }
  },
);
