// API-Q Task Create Contract Parity Correction TCC-1 — static guard.
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename), verifies the executable
// SQL contract, and verifies the TypeScript contract parity in the canonical
// wrapper adapter and the MCP `tasks.create` tool control layer. No database
// access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Task Create Contract Parity Correction TCC-1";
// The TCC-1A correction migration reuses the TCC-1 marker prefix; this test
// stays scoped to the original TCC-1 forward migration.
const EXCLUDED_MARKER =
  "API-Q Task Create Contract Parity Correction TCC-1A";

function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && sql.slice(i, i + 2) !== "*/") i += 1;
      i += 2;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function readMigrationWithMarker(): string {
  const names: string[] = [];
  for (const entry of Deno.readDirSync(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const matches = names
    .map((name) => ({
      name,
      sql: Deno.readTextFileSync(new URL(name, MIGRATIONS_DIR)),
    }))
    .filter((f) => f.sql.includes(MARKER) && !f.sql.includes(EXCLUDED_MARKER));
  assert(matches.length > 0, "TCC-1 migration marker not found");
  return matches[matches.length - 1].sql;
}

const SQL = stripSqlComments(readMigrationWithMarker());
const FLAT = SQL.replace(/\s+/g, " ");

const TOOL_SOURCE = Deno.readTextFileSync(
  new URL("../../functions/btpm-mcp/mcp/taskCreateMutationTool.ts", import.meta.url),
);
const ADAPTER_SOURCE = Deno.readTextFileSync(
  new URL("../../functions/_shared/btpm-api/supabaseTask.ts", import.meta.url),
);

Deno.test("TCC-1: only the Task Create execution wrapper is redefined", () => {
  const defs = SQL.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+[^\s(]+/gi) ?? [];
  assertEquals(defs.length, 1, "migration must define exactly one function");
  assert(
    (defs[0] ?? "").endsWith("api_e_private.execute_v1_create_task"),
    "unexpected function defined",
  );
  assert(SQL.includes("SECURITY DEFINER"), "SECURITY DEFINER removed");
  assert(
    SQL.includes("SET search_path TO 'pg_catalog', 'public'"),
    "search_path pinning changed",
  );
  assertEquals(
    /apply_task_create\s*\(\s*_phase_id/.test(SQL),
    true,
    "canonical PMG command call changed",
  );
});

Deno.test("TCC-1: baselined-date reason returns the bounded actionable code", () => {
  assert(
    FLAT.includes(
      "IF (v_data ->> 'reason') = 'baselined_project_requires_task_dates' THEN",
    ),
    "missing bounded reason mapping",
  );
  assert(
    FLAT.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'task_dates_required');",
    ),
    "bounded code is not persisted as the idempotency failure code",
  );
  assert(
    FLAT.includes(
      "RETURN jsonb_build_object( 'ok', false, 'outcome', 'invalid', 'code', 'task_dates_required' );",
    ),
    "bounded actionable result shape changed",
  );
});

Deno.test("TCC-1: idempotency replay supports the bounded code", () => {
  assert(
    FLAT.includes("ELSIF v_claim.failure_code = 'task_dates_required' THEN"),
    "replay does not handle the persisted bounded code",
  );
  // Existing replay handling is preserved.
  assert(
    FLAT.includes("IF v_claim.failure_code = 'not_authorized' THEN"),
    "not_authorized replay removed",
  );
  assert(
    FLAT.includes("ELSIF v_claim.failure_code = 'invalid' THEN"),
    "invalid replay removed",
  );
  assert(
    FLAT.includes(
      "RAISE EXCEPTION 'execute_v1_create_task: unknown persisted failure code'",
    ),
    "unknown persisted failure code must still fail closed",
  );
});

Deno.test("TCC-1: no business rule, capability or grant is widened", () => {
  for (
    const forbidden of [
      "GRANT",
      "DROP FUNCTION",
      "is_baselined",
      "seed_post_baseline_task",
      "api_capability_catalogue",
      "service_role",
    ]
  ) {
    assertEquals(
      SQL.includes(forbidden),
      false,
      `migration must not touch ${forbidden}`,
    );
  }
  assert(SQL.includes("'tasks:create'"), "fixed capability key changed");
  assert(
    FLAT.includes("v_source NOT IN ('external_api','mcp')"),
    "execution-source selector changed",
  );
  assert(
    SQL.includes("extend_phase_window_required"),
    "Phase-window confirmation contract removed",
  );
});

Deno.test("TCC-1: adapter surfaces the bounded code with an exact keyset", () => {
  assert(
    ADAPTER_SOURCE.includes("ApiV1CreateTaskDatesRequiredResult"),
    "bounded result type missing",
  );
  assert(
    ADAPTER_SOURCE.includes('readonly code: "task_dates_required";'),
    "bounded code literal missing",
  );
  assert(
    ADAPTER_SOURCE.includes('if (data.outcome === "invalid" && "code" in data)'),
    "bounded invalid-code mapping missing",
  );
  assert(
    ADAPTER_SOURCE.includes("assertExactKeys(data, CONFLICT_KEYS)"),
    "bounded invalid-code keyset is not enforced",
  );
});

Deno.test("TCC-1: MCP tool exposes an actionable date-requirement category", () => {
  assert(
    TOOL_SOURCE.includes('| "task_dates_required"'),
    "MCP error category missing",
  );
  assert(
    TOOL_SOURCE.includes("task_dates_required:"),
    "MCP error message missing",
  );
  assert(
    /task_dates_required:\s*\n?\s*"[^"]*Start Date and Due Date are required/.test(
      TOOL_SOURCE,
    ),
    "MCP message does not state the date requirement",
  );
  assert(
    TOOL_SOURCE.includes('result.code === "task_dates_required"'),
    "MCP tool does not map the bounded wrapper code",
  );
});

Deno.test("TCC-1: startDate and dueDate descriptions state the requirement", () => {
  for (const field of ["Planned Task start date", "Planned Task due date"]) {
    assert(TOOL_SOURCE.includes(field), `missing description for ${field}`);
  }
  const described = TOOL_SOURCE.match(
    /REQUIRED when the parent Project is baselined/g,
  ) ?? [];
  assertEquals(
    described.length,
    2,
    "both startDate and dueDate must document the baselined requirement",
  );
});

// ---------------------------------------------------------------------------
// TCC-1A — MCP discoverability completion.
// ---------------------------------------------------------------------------

const REGISTRY_SOURCE = Deno.readTextFileSync(
  new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
);

Deno.test("TCC-1A: exact actionable task_dates_required MCP message", () => {
  assert(
    TOOL_SOURCE.includes(
      '"Start Date and Due Date are required when creating a Task in a baselined Project. Read the parent Phase planning dates and retry with a new idempotency key."',
    ),
    "exact task_dates_required message missing",
  );
});

Deno.test("TCC-1A: exact tasks.create registry description", () => {
  assert(
    REGISTRY_SOURCE.includes(
      '"Creates one Task in a Phase through the canonical API mutation contract. Tasks created in baselined Projects require both planned start and due dates."',
    ),
    "exact tasks.create registry description missing",
  );
});

Deno.test("TCC-1A: startDate and dueDate remain optional at the MCP schema level", () => {
  for (const field of ["startDate", "dueDate"]) {
    const re = new RegExp(
      `${field}: z\\s*\\.string\\(\\)\\s*\\.nullable\\(\\)\\s*\\.optional\\(\\)`,
    );
    assert(re.test(TOOL_SOURCE), `${field} must stay nullable and optional`);
  }
});

Deno.test("TCC-1A: both date descriptions retain the conditional baseline requirement", () => {
  const conditional = TOOL_SOURCE.match(
    /REQUIRED when the parent Project is baselined/g,
  ) ?? [];
  assertEquals(conditional.length, 2, "both date descriptions must be conditional");
});
