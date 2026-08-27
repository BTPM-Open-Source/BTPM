import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanMigrations, normalizeSql } from "../ossSqlContract.ts";

const migrations = await cleanMigrations();
const correction = migrations.find(({ name }) =>
  name === "20260825000033_unqualified_structural_name_read_contract.sql"
);

Deno.test("OSS unqualified structural-name contract: second approved correction exists", () => {
  assert(correction, "unqualified structural-name correction migration is missing");
});

Deno.test("OSS unqualified structural-name contract: correction is narrowly bounded", () => {
  assert(correction);
  const sql = correction.sql;
  const expectedFunctions = [
    "admin_preview_project_workspace_move",
    "add_adoption_template_tasks_to_existing_plan",
    "preview_phase_clone_blueprint",
    "preview_project_clone_blueprint",
  ];
  for (const name of expectedFunctions) {
    assert(sql.includes(`'${name}'`), `expected bounded correction function missing: ${name}`);
  }
  assert(
    !sql.includes("'generate_project_adoption_plan_from_saved_template',\n        E'(?i)(?:public"),
    "encrypted adoption template name must not be included in the replacement target rows",
  );
});

Deno.test("OSS unqualified structural-name contract: exact replacement cardinality is fail-closed", () => {
  assert(correction);
  const sql = normalizeSql(correction.sql).toLowerCase();
  assert(sql.includes("into strict original_def"), "function lookup must fail on missing or ambiguous target");
  assert(sql.includes("hit_count <> target.expected_count"), "per-target cardinality guard missing");
  assert(sql.includes("total_replacements <> 6"), "aggregate replacement cardinality guard missing");
  assert(sql.includes("remaining_total <> 2"), "residual cardinality guard missing");
});

Deno.test("OSS unqualified structural-name contract: encrypted residuals are explicitly preserved", () => {
  assert(correction);
  const sql = correction.sql;
  assert(sql.includes("adoption_templates"), "adoption_templates encrypted-name proof missing");
  assert(sql.includes("board_workflow_states"), "board workflow encrypted-name proof missing");
  assert(sql.includes("Encrypted adoption_templates.name read contract is not preserved"));
  assert(sql.includes("Encrypted board_workflow_states.name read contract is not preserved"));
});

Deno.test("OSS unqualified structural-name contract: no broad table-family expansion", () => {
  assert(correction);
  const sql = normalizeSql(correction.sql).toLowerCase();
  for (const forbiddenReplacementSurface of [
    "portfolio_items",
    "project_templates",
    "project_people_presets",
  ]) {
    assertEquals(
      sql.includes(`from public.${forbiddenReplacementSurface}`),
      false,
      `${forbiddenReplacementSurface} must not become a replacement target`,
    );
  }
});
