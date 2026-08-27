// API-Q Phase Create Contract Parity Correction PCC-1 — static guard.
//
// Repository/static test only: it locates the committed PCC-1 migration by its
// unique marker (never by a hardcoded timestamped filename) and verifies the
// executable SQL plus the bounded TypeScript surface.
//
// No database access, no network access, no Edge invocation, no Phase creation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Phase Create Contract Parity Correction PCC-1";

/** Remove SQL line/block comments (executable SQL only). */
function stripSqlComments(sql: string): string {
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
    out += sql[i];
    i++;
  }
  return out;
}

async function loadMigration(): Promise<{ name: string; text: string }> {
  const found: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(MARKER)) found.push({ name: entry.name, text });
  }
  assert(found.length >= 1, "expected the PCC-1 migration to be committed");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

// ---------------------------------------------------------------------------
// A. Canonical PMG precondition
// ---------------------------------------------------------------------------

Deno.test("PCC-1: exactly two functions are redefined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(new Set(created), new Set([
    "public.apply_phase_create",
    "api_e_private.execute_v1_create_phase",
  ]));
  assertEquals(created.length, 2);
});

Deno.test("PCC-1: canonical command keeps its exact signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_phase_create\(_project_id uuid, _name text, _description text DEFAULT NULL::text, _status pm_status DEFAULT 'planned'::pm_status, _phase_type phase_type DEFAULT 'work_item'::phase_type, _start_date date DEFAULT NULL::date, _target_end_date date DEFAULT NULL::date, _sort_order integer DEFAULT NULL::integer, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "apply_phase_create signature must be unchanged",
  );
  assert(sql.includes("SECURITY DEFINER"));
  assert(sql.includes("SET search_path TO 'pg_catalog', 'public'"));
});

Deno.test("PCC-1: the authoritative Project read includes is_baselined", () => {
  assert(
    /SELECT id, organization_id, workspace_id, start_date, target_end_date, is_baselined\s+INTO v_project\s+FROM public\.projects/
      .test(sql),
    "the structural Project read must provide is_baselined",
  );
});

Deno.test("PCC-1: baselined Project + missing either date yields the canonical reason", () => {
  assert(
    /IF COALESCE\(v_project\.is_baselined, false\) = true\s*\n\s*AND \(_start_date IS NULL OR _target_end_date IS NULL\) THEN/
      .test(sql),
    "both missing-date cases must share one canonical precondition",
  );
  assert(
    sql.includes("jsonb_build_object('reason','baselined_project_requires_phase_dates')"),
    "the canonical reason must be exact",
  );
  const reasonAt = sql.indexOf("baselined_project_requires_phase_dates");
  const invalidStatusAt = sql.lastIndexOf(
    "'invalid'::public.pmg_command_status",
    reasonAt,
  );
  assert(invalidStatusAt > 0, "the precondition must return a PMG invalid result");
});

Deno.test("PCC-1: the precondition precedes sibling locking, shifting and INSERT", () => {
  const precondition = sql.indexOf("COALESCE(v_project.is_baselined, false) = true");
  const lock = sql.indexOf("FOR UPDATE");
  const shift = sql.indexOf("SET sort_order = sort_order + 1");
  const insert = sql.indexOf("INSERT INTO public.phases");
  assert(precondition > 0, "the precondition must exist");
  for (const [label, at] of [
    ["sibling locking", lock],
    ["sibling sort shifting", shift],
    ["Phase INSERT", insert],
  ] as const) {
    assert(at > 0, `${label} must still exist`);
    assert(precondition < at, `the precondition must precede ${label}`);
  }
});

Deno.test("PCC-1: non-baselined Projects still allow null Phase dates", () => {
  assert(
    !/_start_date IS NULL\s*THEN\s*RETURN[\s\S]{0,200}name_blank/.test(sql),
    "dates must not become unconditionally mandatory",
  );
  // No unconditional date requirement exists: every NULL-date rejection is
  // guarded by the baselined condition.
  const guards = sql.match(/_start_date IS NULL OR _target_end_date IS NULL/g) ?? [];
  assertEquals(guards.length, 1, "exactly one conditional date guard may exist");
});

Deno.test("PCC-1: the post-baseline trigger is not redefined or weakened", () => {
  for (const forbidden of [
    "seed_post_baseline_phase",
    "seed_post_baseline_task",
    "DROP TRIGGER",
    "DROP FUNCTION",
    "CREATE TABLE",
    "ALTER TABLE",
    "CREATE POLICY",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("PCC-1: no Project widening and no automatic retry", () => {
  assert(!/UPDATE public\.projects/.test(sql));
  assert(!sql.includes("_apply_project_extension_internal"));
  assert(!/preview/i.test(sql));
});

// ---------------------------------------------------------------------------
// B. Private executor
// ---------------------------------------------------------------------------

Deno.test("PCC-1: executor maps the canonical reason to phase_dates_required", () => {
  assert(
    /\(v_data ->> 'reason'\) = 'baselined_project_requires_phase_dates'/.test(sql),
  );
  assert(
    sql.includes(
      "api_e_private.fail_idempotency(v_claim.registry_id, 'phase_dates_required')",
    ),
    "the bounded code must be persisted through fail_idempotency",
  );
  const occurrences = sql.match(/'code', 'phase_dates_required'/g) ?? [];
  assertEquals(
    occurrences.length,
    2,
    "the bounded code is returned on first failure and on replay",
  );
});

Deno.test("PCC-1: failed replay returns the identical bounded result", () => {
  assert(
    /v_claim\.failure_code = 'phase_dates_required'/.test(sql),
    "the failed-replay branch must recognise the persisted code",
  );
  assert(sql.includes("v_claim.failure_code = 'not_authorized'"));
  assert(sql.includes("v_claim.failure_code = 'invalid'"));
});

Deno.test("PCC-1: generic invalid and Project-window behavior are unchanged", () => {
  assert(
    sql.includes("api_e_private.fail_idempotency(v_claim.registry_id, 'invalid')"),
  );
  assert(sql.includes("'code', 'extend_project_window_required'"));
  assert(sql.includes("'outcome', 'confirmation_required'"));
  assert(!sql.includes("'reason', 'baselined_project_requires_phase_dates'"));
});

Deno.test("PCC-1: trusted establishment and Project enablement are intact", () => {
  assert(sql.includes("api_e_private.authorize_and_establish("));
  assert(sql.includes("api_e_private.authorize_and_establish_mcp("));
  assert(sql.includes("api_project_client_enablements"));
  assert(sql.includes("v_source NOT IN ('external_api','mcp')"));
  assert(sql.includes("c_capability_key constant text := 'phases:create';"));
  const enablement = sql.indexOf("api_project_client_enablements");
  const claim = sql.indexOf("claim_idempotency");
  assert(
    enablement > 0 && claim > 0 && enablement < claim,
    "Project enablement must precede claim_idempotency",
  );
  const definitions = sql.match(/CREATE OR REPLACE FUNCTION public\.apply_phase_create\(/g) ?? [];
  const calls = sql.match(/public\.apply_phase_create\(/g) ?? [];
  assertEquals(calls.length - definitions.length, 1, "exactly one command call");
});

Deno.test("PCC-1: private REVOKEs are reasserted and no new GRANT exists", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_phase(text, text, uuid, text, text, text, text, date, date, integer, text, text, text, text) FROM ${role};`,
      ),
      `${role} must be revoked on the private executor`,
    );
  }
  assertEquals((sql.match(/GRANT[^;]*;/g) ?? []).filter((g) => !/REVOKE/.test(g)).length, 0);
});

Deno.test("PCC-1: public wrappers are not redefined", () => {
  assert(!sql.includes("CREATE OR REPLACE FUNCTION public.api_v1_create_phase"));
  assert(!sql.includes("CREATE OR REPLACE FUNCTION public.mcp_v1_create_phase"));
});

// ---------------------------------------------------------------------------
// C/D/E. Shared adapter, MCP control layer and advertised schema
// ---------------------------------------------------------------------------

const adapter = await Deno.readTextFile(
  new URL("../../functions/_shared/btpm-api/supabasePhase.ts", import.meta.url),
);
const tool = await Deno.readTextFile(
  new URL(
    "../../functions/btpm-mcp/mcp/phaseCreateMutationTool.ts",
    import.meta.url,
  ),
);
const registry = await Deno.readTextFile(
  new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
);

Deno.test("PCC-1: shared adapter declares the bounded create result", () => {
  assert(adapter.includes("ApiV1CreatePhaseDatesRequiredResult"));
  assert(
    /ApiV1CreatePhaseResult =\s*\|\s*ApiV1CreatePhaseSuccessResult\s*\|\s*ApiV1CreatePhaseConfirmationRequiredResult\s*\|\s*ApiV1CreatePhaseDatesRequiredResult\s*\|\s*ApiV1CreatePhaseNegativeResult/
      .test(adapter),
    "the bounded result must be part of the create union",
  );
  assert(adapter.includes("CREATE_DATES_REQUIRED_KEYS"));
  assert(
    /assertExactKeys\(data, CREATE_DATES_REQUIRED_KEYS\);\s*\n\s*if \(data\.code !== "phase_dates_required"\) internal\(\);/
      .test(adapter),
    "only the exact keyset and the exact code may be accepted",
  );
});

Deno.test("PCC-1: MCP tool registers the category and exact message", () => {
  assert(tool.includes('| "phase_dates_required"'));
  assert(
    tool.includes(
      "Start Date and Target End Date are required when creating a Phase in a baselined Project. Read the parent Project planning window, determine valid Phase dates from the user's instruction or context, and retry with a new idempotency key.",
    ),
    "the exact actionable message must be registered",
  );
  const special = tool.indexOf('result.code === "phase_dates_required"');
  const generic = tool.indexOf("mapNegativeOutcome(result.outcome)");
  assert(special > 0 && generic > 0 && special < generic,
    "the special mapping must precede generic invalid mapping");
  assert(tool.includes('category: "project_window_extension_required" as const'));
  assert(tool.includes('return "invalid_arguments";'));
});

Deno.test("PCC-1: MCP schema keeps the dates optional but discoverable", () => {
  assert(
    /startDate: z\.string\(\)\.nullable\(\)\.optional\(\)\.describe\(/.test(tool),
  );
  assert(
    /targetEndDate: z\.string\(\)\.nullable\(\)\.optional\(\)\.describe\(/.test(tool),
  );
  for (const field of ["startDate", "targetEndDate"]) {
    const at = tool.indexOf(`${field}: z.string().nullable().optional()`);
    const description = tool.slice(at, at + 400);
    assert(description.includes("ISO YYYY-MM-DD"));
    assert(description.includes("non-baselined"));
    assert(description.includes("baselined"));
  }
  assert(!/startDate: z\.string\(\),/.test(tool), "startDate must not be required");
  assert(
    !/targetEndDate: z\.string\(\),/.test(tool),
    "targetEndDate must not be required",
  );
});

Deno.test("PCC-1: phases.create registry description advertises the requirement", () => {
  assert(
    registry.includes(
      "Creates one Phase in a Project through the canonical API mutation contract. Phases created in baselined Projects require both planned start and target end dates.",
    ),
  );
});
