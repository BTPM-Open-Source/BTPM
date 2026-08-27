// API-Q Task Create Correction C1 — static guard for the baselined-Project
// Task date precondition inside public.apply_task_create.
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the
// executable SQL. No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Task Create Correction C1: baselined-Project Task date precondition";

const ACCEPTED_SIGNATURE_ARGS = [
  "_phase_id uuid",
  "_name text",
  "_description text DEFAULT NULL::text",
  "_status pm_status DEFAULT 'planned'::pm_status",
  "_priority pm_priority DEFAULT 'medium'::pm_priority",
  "_task_type task_type DEFAULT 'work_item'::task_type",
  "_start_date date DEFAULT NULL::date",
  "_due_date date DEFAULT NULL::date",
  "_estimated_hours numeric DEFAULT NULL::numeric",
  "_sort_order integer DEFAULT NULL::integer",
  "_correlation_id text DEFAULT NULL::text",
  "_idempotency_key text DEFAULT NULL::text",
];

/** Remove SQL line/block comments (executable SQL only). */
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
    .filter((f) => f.sql.includes(MARKER));
  assert(matches.length > 0, "Correction C1 migration marker not found");
  return matches[matches.length - 1].sql;
}

const RAW_SQL = readMigrationWithMarker();
const SQL = stripSqlComments(RAW_SQL);

Deno.test("C1: replaces public.apply_task_create with its accepted signature", () => {
  assert(
    SQL.includes("CREATE OR REPLACE FUNCTION public.apply_task_create("),
    "apply_task_create is not redefined",
  );
  for (const arg of ACCEPTED_SIGNATURE_ARGS) {
    assert(SQL.includes(arg), `missing accepted signature argument: ${arg}`);
  }
  assert(SQL.includes("RETURNS jsonb"), "return type changed");
  assert(SQL.includes("SECURITY DEFINER"), "SECURITY DEFINER removed");
  assert(
    SQL.includes("SET search_path TO 'pg_catalog', 'public'"),
    "search_path pinning changed",
  );
});

Deno.test("C1: baseline state is read from public.projects.is_baselined", () => {
  assert(
    /v_project_is_baselined\s+boolean\s*;/.test(SQL),
    "missing v_project_is_baselined declaration",
  );
  assert(
    /SELECT\s+p\.is_baselined\s+INTO\s+v_project_is_baselined\s+FROM\s+public\.projects\s+p\s+WHERE\s+p\.id\s*=\s*v_project_id/
      .test(SQL.replace(/\s+/g, " ")),
    "baseline state is not read for the authoritative v_project_id",
  );
});

Deno.test("C1: baselined Project with missing dates returns bounded invalid result", () => {
  const flat = SQL.replace(/\s+/g, " ");
  assert(
    flat.includes(
      "IF COALESCE(v_project_is_baselined, false) = true AND (_start_date IS NULL OR _due_date IS NULL) THEN",
    ),
    "missing canonical baselined + missing-date condition",
  );
  const guardIndex = flat.indexOf(
    "IF COALESCE(v_project_is_baselined, false) = true",
  );
  const guardBlock = flat.slice(guardIndex, guardIndex + 500);
  assert(
    guardBlock.includes(
      "RETURN public.pmg_build_result( 'invalid'::public.pmg_command_status, 'apply_task_create', 'task', NULL, v_project_id, jsonb_build_object('reason','baselined_project_requires_task_dates'), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, NULL )",
    ),
    "baseline precondition does not return the canonical bounded PMG invalid result",
  );
  assert(
    !/RAISE\s+EXCEPTION[^;]*baselined/i.test(SQL),
    "baseline precondition must not raise an exception",
  );
});

Deno.test("C1: precondition precedes sibling locking, sort shifting and Task INSERT", () => {
  const flat = SQL.replace(/\s+/g, " ");
  const guardIndex = flat.indexOf(
    "SELECT p.is_baselined INTO v_project_is_baselined",
  );
  const lockIndex = flat.indexOf("PERFORM 1 FROM public.tasks");
  const shiftIndex = flat.indexOf("UPDATE public.tasks SET sort_order");
  const insertIndex = flat.indexOf("INSERT INTO public.tasks");
  assert(guardIndex > 0, "baseline read not found");
  assert(lockIndex > guardIndex, "sibling locking precedes baseline read");
  assert(shiftIndex > guardIndex, "sort shifting precedes baseline read");
  assert(insertIndex > guardIndex, "Task INSERT precedes baseline read");

  // Authorization must still precede the baseline read.
  const authIndex = flat.indexOf("public.has_project_pm_authority(v_actor");
  assert(
    authIndex > 0 && authIndex < guardIndex,
    "baseline read must follow caller authorization",
  );
  const canWriteIndex = flat.indexOf("public.can_write_demo(v_actor");
  assert(
    canWriteIndex > 0 && canWriteIndex < guardIndex,
    "baseline read must follow workspace write authority",
  );
});

Deno.test("C1: seed_post_baseline_task trigger is neither removed nor weakened", () => {
  assertEquals(
    /seed_post_baseline_task/i.test(SQL),
    false,
    "migration must not touch seed_post_baseline_task or its trigger",
  );
  assertEquals(
    /DROP\s+TRIGGER/i.test(SQL),
    false,
    "migration must not drop triggers",
  );
  assertEquals(
    /ALTER\s+TABLE\s+public\.tasks\s+DISABLE\s+TRIGGER/i.test(SQL),
    false,
    "migration must not disable triggers on public.tasks",
  );
});

Deno.test("C1: existing Phase-window confirmation logic remains present", () => {
  assert(
    SQL.includes("task_start_before_phase_start"),
    "phase start confirmation removed",
  );
  assert(
    SQL.includes("task_due_after_phase_end"),
    "phase end confirmation removed",
  );
  assert(
    SQL.includes("extend_phase_window_required"),
    "phase window confirmation code removed",
  );
  assert(
    SQL.includes("'confirmation_required'::public.pmg_command_status"),
    "confirmation_required status removed",
  );
  // Other preserved validations.
  for (
    const reason of [
      "name_blank",
      "estimated_hours_negative",
      "start_after_due",
      "sort_order_negative",
    ]
  ) {
    assert(SQL.includes(reason), `preserved validation missing: ${reason}`);
  }
  assert(
    SQL.includes("'tasks:create'"),
    "exact-capability containment removed",
  );
  assert(
    SQL.includes("v_trusted_channel NOT IN ('external_api','mcp')"),
    "trusted-source derivation changed",
  );
  assert(
    SQL.includes("public.pmg_record_command_audit("),
    "PMG audit removed",
  );
});

Deno.test("C1: no API/MCP wrapper or Task Create contract is widened", () => {
  for (
    const forbidden of [
      "mcp_v1_create_task",
      "api_v1_create_task",
      "execute_v1_create_task",
      "api_idempotency_registry",
      "service_role",
      "GRANT",
      "api_capability_catalogue",
    ]
  ) {
    assertEquals(
      SQL.includes(forbidden),
      false,
      `migration must not touch ${forbidden}`,
    );
  }
  // Only apply_task_create is (re)defined.
  const defs = SQL.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+[^\s(]+/gi) ?? [];
  assertEquals(defs.length, 1, "migration must define exactly one function");
  assert(
    (defs[0] ?? "").endsWith("public.apply_task_create"),
    "unexpected function defined",
  );

});
