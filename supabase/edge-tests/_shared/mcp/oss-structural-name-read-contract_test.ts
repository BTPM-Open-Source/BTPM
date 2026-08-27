import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanMigrations, normalizeSql } from "../ossSqlContract.ts";

const migrations = await cleanMigrations();
const correction = migrations.find(({ name }) =>
  name === "20260825000032_structural_name_read_contract.sql"
);

Deno.test("OSS structural-name contract: clean correction migration exists", () => {
  assert(correction, "structural-name correction migration is missing");
});

Deno.test("OSS structural-name contract: only canonical plaintext structural tables are catalog-discovered", () => {
  assert(correction);
  const sql = normalizeSql(correction.sql);
  for (const table of ["workspaces", "programs", "projects", "phases", "tasks"]) {
    assert(sql.includes(table), `catalog repair must include ${table}`);
  }
  for (const encryptedNameSurface of [
    "portfolio_items",
    "project_templates",
    "project_people_presets",
    "board_workflow_states",
  ]) {
    assert(
      !new RegExp(`\\(workspaces\\|programs\\|projects\\|phases\\|tasks\\|${encryptedNameSurface}\\)`).test(sql),
      `encrypted-name surface ${encryptedNameSurface} must not enter the structural discovery set`,
    );
  }
});

Deno.test("OSS structural-name contract: record-variable exceptions are explicit and bounded", () => {
  assert(correction);
  const sql = correction.sql;
  const expected = [
    "admin_preview_project_workspace_move",
    "apply_program_update",
    "get_decrypted_phase",
    "preview_phase_clone_blueprint",
    "preview_task_clone_blueprint",
  ];
  for (const name of expected) {
    assert(sql.includes(`'${name}'`), `explicit structural-name function missing: ${name}`);
  }
  const valuesBlock = sql.match(/FROM \(VALUES([\s\S]*?)\) AS x\(proname, expressions\)/);
  assert(valuesBlock, "explicit record-variable VALUES block missing");
  assertEquals(
    [...valuesBlock[1].matchAll(/\('([a-z0-9_]+)'/g)].map((m) => m[1]).sort(),
    [...expected].sort(),
  );
});

Deno.test("OSS structural-name contract: migration is fail-closed", () => {
  assert(correction);
  const sql = normalizeSql(correction.sql);
  assert(sql.includes("INTO STRICT original_def"), "explicit function lookup must fail on missing/ambiguous function");
  assert(sql.includes("hit_count <> 1"), "explicit expression cardinality guard missing");
  assert(sql.includes("remaining_count <> 0"), "post-repair structural decrypt guard missing");
  assert(sql.includes("replacement_count = 0 OR function_count = 0"), "zero-match guard missing");
});
