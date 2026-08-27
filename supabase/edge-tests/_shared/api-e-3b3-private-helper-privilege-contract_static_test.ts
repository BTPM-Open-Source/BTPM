// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-e-3b3-private-helper-privilege-contract_static_test.ts', import.meta.url).href;
// API-E.3B3 — Private helper privilege contract for the OAuth read-containment gate.
//
// Repository-only static contract test. Verifies that a single API-E.3B3
// migration adds exactly the minimum browser-role privileges required for
// the API-E.3B1/E.3B2 restrictive SELECT policies to evaluate:
//
//   api_e_private.jwt_client_id() IS NULL OR api_e_private.assert_trusted_context()
//
// under the `authenticated` role, and that the migration does NOT expose
// `api_e_private.authorize_and_establish(...)` to any browser role, does NOT
// alter any table/policy/function-body/other grant, and does NOT modify
// release metadata.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);
// API-E.R1: RELEASE_META constant removed with the obsolete release-metadata baseline test.

const CONDITION =
  "api_e_private.jwt_client_id() IS NULL OR api_e_private.assert_trusted_context()";

// The frozen 62-table Category A allowlist (E.3B1 = 1..31, E.3B2 = 32..62).
const CATEGORY_A_TABLES: readonly string[] = [
  "activity_events", "adoption_initiatives", "adoption_object_links",
  "adoption_plans", "adoption_template_initiatives", "adoption_template_tasks",
  "adoption_templates", "backlog_items", "blockers", "board_workflow_states",
  "comments", "decision_case_ai_run_files", "decision_case_ai_runs",
  "dependencies", "entity_object_links", "entity_user_links",
  "execution_updates", "generated_operational_documents",
  "governance_cadences", "governance_record_brief_versions",
  "governance_record_btpm_context_links",
  "governance_record_copilot_data_packages",
  "governance_record_cross_project_links",
  "governance_record_decision_outcomes", "governance_record_decisions",
  "governance_record_evidence_files", "governance_record_evidence_references",
  "governance_record_links", "governance_record_stakeholder_packages",
  "governance_records", "kpi_app_external_kpis",
  "kpi_app_mappings", "kpi_definitions", "kpi_schedule_policies",
  "kpi_snapshots", "kpi_updates", "phases", "portfolio_item_team_members",
  "portfolio_items", "programs", "project_benefits",
  "project_closure_summaries", "project_lessons_learned_documents",
  "project_people_preset_members", "project_people_presets",
  "project_stakeholders", "project_team_members", "project_templates",
  "projects", "raci_assignments", "risks", "roadmap_story_ai_run_files",
  "roadmap_story_ai_runs", "roadmap_story_pack_external_files",
  "roadmap_story_pack_notes", "roadmap_story_pack_sources",
  "roadmap_story_pack_versions", "roadmap_story_packs",
  "sharepoint_project_bindings", "sprints", "task_assignments", "tasks",
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

async function loadE3B3Migration(): Promise<Migration> {
  const all = await loadMigrations();
  const hits = all.filter((m) => /API-E\.3B3\b/.test(m.text));
  assertEquals(
    hits.length,
    1,
    `expected exactly one API-E.3B3 migration; got ${hits.length}`,
  );
  return hits[0];
}

async function loadPolicyMigration(marker: RegExp): Promise<Migration> {
  const all = await loadMigrations();
  const hits = all.filter((m) => marker.test(m.text) && !/API-E\.3B3\b/.test(m.text));
  assertEquals(hits.length, 1, `expected exactly one ${marker} migration`);
  return hits[0];
}

// ---------------------------------------------------------------------------
// 1. Required grants present, exactly.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B3 — grants schema USAGE and EXECUTE on the two read-side helpers to authenticated",
  async () => {
    const mig = await loadE3B3Migration();
    const required: RegExp[] = [
      /GRANT\s+USAGE\s+ON\s+SCHEMA\s+api_e_private\s+TO\s+authenticated\s*;/i,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+api_e_private\.jwt_client_id\s*\(\s*\)\s+TO\s+authenticated\s*;/i,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+api_e_private\.assert_trusted_context\s*\(\s*\)\s+TO\s+authenticated\s*;/i,
    ];
    for (const re of required) {
      assert(re.test(mig.text), `API-E.3B3: required grant missing: ${re}`);
    }
  },
);

// ---------------------------------------------------------------------------
// 2. Reassert revokes present for schema + helpers.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B3 — reasserts anon/PUBLIC have no access to schema or the two helpers",
  async () => {
    const mig = await loadE3B3Migration();
    const required: RegExp[] = [
      /REVOKE\s+ALL\s+ON\s+SCHEMA\s+api_e_private\s+FROM\s+PUBLIC\s*;/i,
      /REVOKE\s+ALL\s+ON\s+SCHEMA\s+api_e_private\s+FROM\s+anon\s*;/i,
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+api_e_private\.jwt_client_id\s*\(\s*\)\s+FROM\s+PUBLIC\s*;/i,
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+api_e_private\.jwt_client_id\s*\(\s*\)\s+FROM\s+anon\s*;/i,
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+api_e_private\.assert_trusted_context\s*\(\s*\)\s+FROM\s+PUBLIC\s*;/i,
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+api_e_private\.assert_trusted_context\s*\(\s*\)\s+FROM\s+anon\s*;/i,
    ];
    for (const re of required) {
      assert(re.test(mig.text), `API-E.3B3: required revoke missing: ${re}`);
    }
  },
);

// ---------------------------------------------------------------------------
// 3. authorize_and_establish(...) remains revoked from all browser roles.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B3 — reasserts authorize_and_establish(...) is revoked from PUBLIC, anon, and authenticated",
  async () => {
    const mig = await loadE3B3Migration();
    const sig = String.raw`api_e_private\.authorize_and_establish\s*\(\s*text\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)`;
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      const re = new RegExp(
        `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${sig}\\s+FROM\\s+${role}\\s*;`,
        "i",
      );
      assert(re.test(mig.text), `API-E.3B3: missing REVOKE ... FROM ${role} on authorize_and_establish`);
    }
    // And it must NOT be granted to any browser role.
    const grantRe = new RegExp(
      `GRANT\\s+[^;]*ON\\s+FUNCTION\\s+${sig}\\s+TO\\s+(?:authenticated|anon|PUBLIC)`,
      "i",
    );
    assert(!grantRe.test(mig.text), "API-E.3B3: authorize_and_establish must not be granted to any browser role");
  },
);

// ---------------------------------------------------------------------------
// 4. No other api_e_private function may be granted; no broad grants.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B3 — grants only the two whitelisted helpers, no GRANT ALL, no default privileges",
  async () => {
    const mig = await loadE3B3Migration();
    const scrubbed = mig.text.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

    // Collect every GRANT ... ON FUNCTION api_e_private.<name>(...) statement.
    const grantFnRe = /GRANT\s+[A-Z ,]+\s+ON\s+FUNCTION\s+api_e_private\.([a-z_][a-z0-9_]*)\s*\(/gi;
    let m: RegExpExecArray | null;
    const grantedFns: string[] = [];
    while ((m = grantFnRe.exec(scrubbed)) !== null) grantedFns.push(m[1]);
    const uniqueGranted = [...new Set(grantedFns)].sort();
    assertEquals(
      uniqueGranted,
      ["assert_trusted_context", "jwt_client_id"],
      "API-E.3B3: only jwt_client_id and assert_trusted_context may be granted",
    );

    // No GRANT ALL anywhere.
    assert(!/\bGRANT\s+ALL\b/i.test(scrubbed), "API-E.3B3: GRANT ALL is forbidden");

    // No ALTER DEFAULT PRIVILEGES.
    assert(
      !/\bALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(scrubbed),
      "API-E.3B3: default-privilege changes are forbidden",
    );

    // No role creation/modification.
    for (const kw of [/\bCREATE\s+ROLE\b/i, /\bALTER\s+ROLE\b/i, /\bDROP\s+ROLE\b/i]) {
      assert(!kw.test(scrubbed), `API-E.3B3: role DDL forbidden (${kw})`);
    }
  },
);

// ---------------------------------------------------------------------------
// 5. No forbidden DDL/DML anywhere in the migration.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B3 — migration performs no table/policy/function-body change and no DML",
  async () => {
    const mig = await loadE3B3Migration();
    const scrubbed = mig.text.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    const forbidden: RegExp[] = [
      /\bCREATE\s+POLICY\b/i,
      /\bALTER\s+POLICY\b/i,
      /\bDROP\s+POLICY\b/i,
      /\bALTER\s+TABLE\b/i,
      /\bDROP\s+TABLE\b/i,
      /\bCREATE\s+TABLE\b/i,
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
      /\bDROP\s+FUNCTION\b/i,
      /\bALTER\s+FUNCTION\b/i,
      /\bCREATE\s+TRIGGER\b/i,
      /\bDROP\s+TRIGGER\b/i,
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+public\./i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /\bCREATE\s+SCHEMA\b/i,
      /\bDROP\s+SCHEMA\b/i,
    ];
    for (const re of forbidden) {
      assert(!re.test(scrubbed), `API-E.3B3: forbidden statement matched ${re}`);
    }
    // Grants outside api_e_private are forbidden.
    const strayGrant = /\bGRANT\s+[^;]*\bON\s+(?:SCHEMA|FUNCTION|TABLE|SEQUENCE)\s+(?!api_e_private\b)/i;
    assert(
      !strayGrant.test(scrubbed),
      "API-E.3B3: grants outside api_e_private are forbidden",
    );
  },
);

// ---------------------------------------------------------------------------
// 6. The frozen E.3B1/E.3B2 policies still call the exact two helpers.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B3 — API-E.3B1 and API-E.3B2 policy migrations still invoke the exact two helpers across all 62 Category A tables",
  async () => {
    const b1 = await loadPolicyMigration(/API-E\.3B1\b/);
    const b2 = await loadPolicyMigration(/API-E\.3B2\b/);
    for (const mig of [b1, b2]) {
      assert(
        mig.text.includes(CONDITION),
        `${mig.name}: exact USING condition string missing`,
      );
    }
    // Every one of the 62 tables must still be listed in one of the two migrations.
    for (const t of CATEGORY_A_TABLES) {
      const inB1 = new RegExp(`'${t}'`).test(b1.text);
      const inB2 = new RegExp(`'${t}'`).test(b2.text);
      assert(
        inB1 !== inB2, // exclusive-or: appears in exactly one
        `Category A table '${t}' must appear in exactly one of E.3B1/E.3B2 (b1=${inB1}, b2=${inB2})`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// 7. API-E.R1: Removed obsolete assertion pinning release metadata to the
//    APP_VERSION 1.5.63 / BUILD_VERSION 1.5.63+20260722T052100Z baseline.
//    Release metadata is regenerated on each build and is not an OAuth
//    containment / private-helper privilege invariant.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 8. Self-audit — this static test performs no runtime database change and
//    does not touch Edge functions, config, UI, or package files.
// ---------------------------------------------------------------------------
Deno.test(
  "API-E.3B3 — this static test performs no runtime database, edge, config, UI, or package change",
  async () => {
    const self = await Deno.readTextFile(new URL(__BTPM_SELF_URL__));
    const banned = [
      /["'`]\s*ALTER\s+TABLE\s+/i,
      /["'`]\s*GRANT\s+[A-Z][^"'`]*TO\b/i,
      /["'`]\s*REVOKE\s+[A-Z][^"'`]*FROM\b/i,
      /["'`]\s*DROP\s+POLICY\b/i,
      /["'`]\s*INSERT\s+INTO\s+/i,
      /["'`]\s*UPDATE\s+public\./i,
      /["'`]\s*DELETE\s+FROM\s+/i,
    ];
    for (const re of banned) {
      assert(!re.test(self), `API-E.3B3 test must not contain executable SQL matching ${re}`);
    }
  },
);
