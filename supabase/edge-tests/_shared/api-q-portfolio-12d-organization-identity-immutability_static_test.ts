// API-Q Portfolio-12D — Portfolio Organization Identity Immutability
// (durable focused static test).
//
// Repository/static test only: it locates the committed forward-only migration
// by the unique trigger/function identifiers it introduces (never by a
// hardcoded timestamped filename) and verifies the structural invariant.
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const TRIGGER_NAME = "portfolio_items_00_assert_organization_immutable";
const FUNCTION_NAME = "trg_portfolio_items_assert_organization_immutable";

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

const found: { name: string; text: string }[] = [];
for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
  if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
  const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
  if (text.includes(TRIGGER_NAME)) found.push({ name: entry.name, text });
}

Deno.test("12D: exactly one migration introduces the immutability guard", () => {
  assertEquals(found.length, 1, `expected 1 migration, found ${found.length}`);
});

const sql = stripSqlComments(found[0]?.text ?? "");
const normalized = sql.replace(/\s+/g, " ");

Deno.test("12D-1: trigger targets public.portfolio_items", () => {
  assert(
    new RegExp(
      `CREATE TRIGGER ${TRIGGER_NAME}[\\s\\S]*?ON public\\.portfolio_items`,
      "i",
    ).test(sql),
    "trigger must be created on public.portfolio_items",
  );
});

Deno.test("12D-2: trigger is BEFORE UPDATE OF organization_id", () => {
  assert(
    /BEFORE UPDATE OF organization_id ON public\.portfolio_items/i.test(normalized),
    "trigger timing/event must be BEFORE UPDATE OF organization_id",
  );
  assert(
    !new RegExp(`CREATE TRIGGER ${TRIGGER_NAME}[\\s\\S]*?AFTER`, "i").test(sql),
    "trigger must not be AFTER",
  );
});

Deno.test("12D-3: trigger is row-level", () => {
  assert(
    /FOR EACH ROW/i.test(normalized),
    "trigger must be FOR EACH ROW",
  );
  assert(
    !/FOR EACH STATEMENT/i.test(normalized),
    "trigger must not be statement-level",
  );
});

Deno.test("12D-4: function compares NEW/OLD organization_id with IS DISTINCT FROM", () => {
  assert(
    /NEW\.organization_id IS DISTINCT FROM OLD\.organization_id/i.test(normalized),
    "immutability condition must use IS DISTINCT FROM",
  );
});

Deno.test("12D-5: changed Organization raises a bounded deterministic exception", () => {
  assert(
    /RAISE EXCEPTION 'portfolio_organization_immutable:/i.test(normalized),
    "must raise a deterministic, prefixed exception",
  );
  assert(
    /USING ERRCODE = '42501'/i.test(normalized),
    "must raise with a deterministic SQLSTATE",
  );
});

Deno.test("12D-6: function returns NEW when Organization is unchanged", () => {
  assert(/RETURN NEW;/i.test(normalized), "function must return NEW otherwise");
  // Return NEW must be outside the rejection branch.
  const body = normalized.slice(normalized.indexOf("BEGIN"));
  const raiseIdx = body.indexOf("RAISE EXCEPTION");
  const endIfIdx = body.indexOf("END IF");
  const returnIdx = body.indexOf("RETURN NEW");
  assert(raiseIdx > -1 && endIfIdx > raiseIdx && returnIdx > endIfIdx,
    "RETURN NEW must follow the END IF of the rejection branch");
});

Deno.test("12D-7: INSERT is not intercepted", () => {
  assert(
    !new RegExp(`CREATE TRIGGER ${TRIGGER_NAME}[\\s\\S]*?INSERT`, "i").test(sql),
    "guard trigger must not fire on INSERT",
  );
});

Deno.test("12D-8: trigger function is invoker-rights, deterministic search_path, plpgsql", () => {
  assert(new RegExp(`FUNCTION public\\.${FUNCTION_NAME}\\(`, "i").test(normalized));
  assert(/LANGUAGE plpgsql/i.test(normalized));
  assert(/SET search_path = public/i.test(normalized));
  assert(
    !/SECURITY DEFINER/i.test(normalized),
    "guard must not be SECURITY DEFINER",
  );
});

Deno.test("12D-9: existing Portfolio encryption/timestamp triggers are untouched", () => {
  assert(
    !/trg_encrypt_portfolio_item_fields/i.test(normalized),
    "must not modify the Portfolio encryption trigger function",
  );
  assert(
    !/portfolio_items_encrypt_fields/i.test(normalized),
    "must not drop/replace the Portfolio encryption trigger",
  );
  assert(
    !/portfolio_items_set_updated_at/i.test(normalized),
    "must not drop/replace the updated_at trigger",
  );
  assert(
    !/btpm_encrypt|btpm_decrypt/i.test(normalized),
    "must not touch encryption helpers",
  );
});

Deno.test("12D-10: canonical Portfolio writers are not redefined", () => {
  for (const fn of [
    "admin_update_portfolio_item",
    "admin_create_portfolio_item",
    "admin_archive_portfolio_item",
    "admin_assign_projects_to_portfolio",
    "execute_v1_update_portfolio",
    "execute_v1_create_portfolio",
  ]) {
    assert(
      !new RegExp(fn, "i").test(normalized),
      `migration must not redefine ${fn}`,
    );
  }
});

Deno.test("12D-11: no RLS/grant/DML/backfill changes", () => {
  for (const forbidden of [
    /CREATE POLICY/i,
    /DROP POLICY/i,
    /ALTER POLICY/i,
    /ROW LEVEL SECURITY/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bINSERT INTO\b/i,
    /\bUPDATE public\./i,
    /\bDELETE FROM\b/i,
  ]) {
    assert(!forbidden.test(normalized), `forbidden statement present: ${forbidden}`);
  }
});

Deno.test("12D-12: trigger name sorts before the encryption trigger", () => {
  assert(
    TRIGGER_NAME < "portfolio_items_encrypt_fields",
    "guard must fire before portfolio_items_encrypt_fields",
  );
});
