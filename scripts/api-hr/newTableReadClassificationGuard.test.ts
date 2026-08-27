// API-HR.18 — tests for the New public Table Read-Classification Guard.
//
// Pure/synthetic only. No database, no network, no Git mutation.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  ALLOWED_POSTURES,
  APPROVED_EXPLICITLY_PUBLIC_TABLES,
  checkOauthContainment,
  CLASSIFICATIONS,
  evaluateMigration,
  findCreatedPublicTables,
  GuardBlocked,
  hasRlsEnabled,
  isMigrationPath,
  isSafeGitRef,
  MigrationInput,
  ORDINARY_POSTURES,
  parseClassificationMarkers,
  parseCliArgs,
  ReasonCode,
  runGuard,
} from "./newTableReadClassificationGuard.ts";

const PATH = "supabase/migrations/20260808120000_test.sql";

function migration(headSql: string, baseSql: string | null = null): MigrationInput {
  return { path: PATH, headSql, baseSql };
}

function reasons(input: MigrationInput): ReasonCode[] {
  return evaluateMigration(input).violations.map((v) => v.reason);
}

function containment(table: string): string {
  return `
CREATE POLICY api_e_oauth_read_containment
ON public.${table}
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  api_e_private.jwt_client_id() IS NULL
  OR api_e_private.assert_trusted_context()
);`;
}

function rls(table: string): string {
  return `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`;
}

function protectedTable(cls: string, posture: string, table = "example_records"): string {
  return `
-- API-HR-READ-CLASSIFICATION: public.${table} | class=${cls} | ordinary=${posture}
CREATE TABLE public.${table} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
GRANT SELECT ON public.${table} TO authenticated;
${rls(table)}
${containment(table)}
`;
}

/* ---------------------------- contract shape ---------------------------- */

Deno.test("frozen classification and posture vocabularies", () => {
  assertEquals([...CLASSIFICATIONS], [
    "pm_business_data",
    "identity_membership_control",
    "server_only",
    "explicitly_public",
  ]);
  assertEquals([...ORDINARY_POSTURES], [
    "intentional_direct_rls",
    "protected_rpc_only",
    "no_authenticated_read_path",
    "explicitly_public",
  ]);
  assertEquals([...ALLOWED_POSTURES.server_only], ["no_authenticated_read_path"]);
  assertEquals([...ALLOWED_POSTURES.explicitly_public], ["explicitly_public"]);
  assertEquals([...APPROVED_EXPLICITLY_PUBLIC_TABLES], []);
});

/* ------------------------------ pass cases ------------------------------ */

Deno.test("no changed migrations passes", () => {
  const r = runGuard([]);
  assertEquals(r.changedMigrations, 0);
  assertEquals(r.newPublicTables, 0);
  assertEquals(r.violations.length, 0);
});

Deno.test("alter-only migration passes with no candidate", () => {
  const sql = `ALTER TABLE public.projects ADD COLUMN nickname text;`;
  const e = evaluateMigration(migration(sql));
  assertEquals(e.newTables, []);
  assertEquals(e.violations, []);
});

Deno.test("new pm_business_data table with marker, RLS and containment passes", () => {
  const e = evaluateMigration(migration(protectedTable("pm_business_data", "protected_rpc_only")));
  assertEquals(e.newTables, ["public.example_records"]);
  assertEquals(e.violations, []);
  assertEquals(e.accepted[0].class, "pm_business_data");
});

Deno.test("new identity_membership_control table with containment passes", () => {
  const e = evaluateMigration(
    migration(protectedTable("identity_membership_control", "intentional_direct_rls", "example_memberships")),
  );
  assertEquals(e.violations, []);
});

Deno.test("valid server_only table passes", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_server_state | class=server_only | ordinary=no_authenticated_read_path
CREATE TABLE public.example_server_state (
  id uuid PRIMARY KEY
);
REVOKE ALL ON TABLE public.example_server_state FROM anon, authenticated;
GRANT ALL ON public.example_server_state TO service_role;
${rls("example_server_state")}
`;
  assertEquals(reasons(migration(sql)), []);
});

/* ------------------------------ marker cases ---------------------------- */

Deno.test("missing marker fails", () => {
  const sql = `CREATE TABLE public.example_records (id uuid);\n${rls("example_records")}`;
  assertEquals(reasons(migration(sql)), ["classification_marker_missing"]);
});

Deno.test("duplicate marker fails", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_records | class=pm_business_data | ordinary=protected_rpc_only
-- API-HR-READ-CLASSIFICATION: public.example_records | class=pm_business_data | ordinary=protected_rpc_only
CREATE TABLE public.example_records (id uuid);
${rls("example_records")}
${containment("example_records")}
`;
  assertEquals(reasons(migration(sql)), ["classification_marker_duplicate"]);
});

Deno.test("malformed marker fails", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION public.example_records class=pm_business_data
CREATE TABLE public.example_records (id uuid);
${rls("example_records")}
`;
  const r = reasons(migration(sql));
  assert(r.includes("classification_marker_malformed"));
  assert(r.includes("classification_marker_missing"));
});

Deno.test("orphan marker fails", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.other_table | class=pm_business_data | ordinary=protected_rpc_only
${protectedTable("pm_business_data", "protected_rpc_only")}
`;
  assertEquals(reasons(migration(sql)), ["classification_marker_orphaned"]);
});

Deno.test("unknown classification fails", () => {
  assertEquals(
    reasons(migration(protectedTable("mystery_class", "protected_rpc_only"))),
    ["classification_unknown"],
  );
});

Deno.test("unknown ordinary posture fails", () => {
  assertEquals(
    reasons(migration(protectedTable("pm_business_data", "wide_open"))),
    ["ordinary_posture_unknown"],
  );
});

Deno.test("invalid class/posture combination fails", () => {
  assertEquals(
    reasons(migration(protectedTable("server_only", "intentional_direct_rls"))),
    ["classification_posture_mismatch"],
  );
  assertEquals(
    reasons(migration(protectedTable("pm_business_data", "explicitly_public"))),
    ["classification_posture_mismatch"],
  );
});

/* --------------------------- structural cases --------------------------- */

Deno.test("new protected table without RLS fails", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_records | class=pm_business_data | ordinary=protected_rpc_only
CREATE TABLE public.example_records (id uuid);
${containment("example_records")}
`;
  assertEquals(reasons(migration(sql)), ["new_public_table_rls_not_enabled"]);
});

Deno.test("pm table without OAuth containment fails", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_records | class=pm_business_data | ordinary=protected_rpc_only
CREATE TABLE public.example_records (id uuid);
${rls("example_records")}
`;
  assertEquals(reasons(migration(sql)), ["oauth_read_containment_missing"]);
});

Deno.test("identity/control table without containment fails", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_memberships | class=identity_membership_control | ordinary=protected_rpc_only
CREATE TABLE public.example_memberships (id uuid);
${rls("example_memberships")}
`;
  assertEquals(reasons(migration(sql)), ["oauth_read_containment_missing"]);
});

Deno.test("permissive containment policy is rejected", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_records | class=pm_business_data | ordinary=protected_rpc_only
CREATE TABLE public.example_records (id uuid);
${rls("example_records")}
CREATE POLICY api_e_oauth_read_containment ON public.example_records
FOR SELECT TO authenticated
USING (api_e_private.jwt_client_id() IS NULL OR api_e_private.assert_trusted_context());
`;
  assertEquals(reasons(migration(sql)), ["oauth_read_containment_malformed"]);
});

Deno.test("containment policy with wrong predicate is rejected", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_records | class=pm_business_data | ordinary=protected_rpc_only
CREATE TABLE public.example_records (id uuid);
${rls("example_records")}
CREATE POLICY api_e_oauth_read_containment ON public.example_records
AS RESTRICTIVE FOR SELECT TO authenticated
USING (true);
`;
  assertEquals(reasons(migration(sql)), ["oauth_read_containment_malformed"]);
});

Deno.test("server_only with authenticated SELECT grant fails", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_server_state | class=server_only | ordinary=no_authenticated_read_path
CREATE TABLE public.example_server_state (id uuid);
GRANT SELECT ON public.example_server_state TO authenticated;
REVOKE ALL ON public.example_server_state FROM anon, authenticated;
${rls("example_server_state")}
`;
  assertEquals(reasons(migration(sql)), ["server_only_client_read_grant"]);
});

Deno.test("server_only with authenticated SELECT policy fails", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_server_state | class=server_only | ordinary=no_authenticated_read_path
CREATE TABLE public.example_server_state (id uuid);
REVOKE ALL ON public.example_server_state FROM anon, authenticated;
${rls("example_server_state")}
CREATE POLICY ess_read ON public.example_server_state FOR SELECT TO authenticated USING (true);
`;
  assertEquals(reasons(migration(sql)), ["server_only_client_select_policy"]);
});

Deno.test("server_only with PUBLIC select policy fails", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_server_state | class=server_only | ordinary=no_authenticated_read_path
CREATE TABLE public.example_server_state (id uuid);
REVOKE ALL ON public.example_server_state FROM PUBLIC;
${rls("example_server_state")}
CREATE POLICY ess_read ON public.example_server_state FOR SELECT USING (true);
`;
  assertEquals(reasons(migration(sql)), ["server_only_client_select_policy"]);
});

Deno.test("server_only without explicit client revoke fails", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_server_state | class=server_only | ordinary=no_authenticated_read_path
CREATE TABLE public.example_server_state (id uuid);
GRANT ALL ON public.example_server_state TO service_role;
${rls("example_server_state")}
`;
  assertEquals(reasons(migration(sql)), ["server_only_client_revoke_missing"]);
});

Deno.test("explicitly_public fails against the empty allowlist", () => {
  const sql = `
-- API-HR-READ-CLASSIFICATION: public.example_public | class=explicitly_public | ordinary=explicitly_public
CREATE TABLE public.example_public (id uuid);
${rls("example_public")}
`;
  assertEquals(reasons(migration(sql)), ["explicit_public_not_preapproved"]);
});

/* ------------------------------ SQL parsing ----------------------------- */

Deno.test("non-public schema table is ignored", () => {
  assertEquals(findCreatedPublicTables("CREATE TABLE api_e_private.foo (id uuid);").tables, []);
});

Deno.test("views and materialized views are ignored", () => {
  const scan = findCreatedPublicTables(
    "CREATE VIEW public.v AS SELECT 1; CREATE MATERIALIZED VIEW public.mv AS SELECT 1;",
  );
  assertEquals(scan.tables, []);
  assertEquals(scan.unrecognized, false);
});

Deno.test("CREATE TABLE inside a line or block comment is ignored", () => {
  const scan = findCreatedPublicTables(`
-- CREATE TABLE public.commented (id uuid);
/* CREATE TABLE public.blocked (id uuid); */
ALTER TABLE public.projects ADD COLUMN x text;
`);
  assertEquals(scan.tables, []);
  assertEquals(scan.unrecognized, false);
});

Deno.test("CREATE TABLE inside a SQL string is ignored", () => {
  const scan = findCreatedPublicTables(
    "SELECT 'CREATE TABLE public.stringy (id uuid)' AS ddl;",
  );
  assertEquals(scan.tables, []);
});

Deno.test("CREATE TABLE inside a dollar-quoted body is ignored", () => {
  const scan = findCreatedPublicTables(`
CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  CREATE TABLE public.inner_table (id uuid);
END;
$$;
`);
  assertEquals(scan.tables, []);
  assertEquals(scan.unrecognized, false);
});

Deno.test("quoted public identifier is detected", () => {
  assertEquals(
    findCreatedPublicTables('CREATE TABLE "public"."quoted_tbl" (id uuid);').tables,
    ["public.quoted_tbl"],
  );
});

Deno.test("IF NOT EXISTS, UNLOGGED and CREATE TABLE AS are detected", () => {
  assertEquals(
    findCreatedPublicTables("CREATE TABLE IF NOT EXISTS public.a (id uuid);").tables,
    ["public.a"],
  );
  assertEquals(
    findCreatedPublicTables("CREATE UNLOGGED TABLE public.b (id uuid);").tables,
    ["public.b"],
  );
  assertEquals(
    findCreatedPublicTables("CREATE TABLE public.c AS SELECT 1 AS n;").tables,
    ["public.c"],
  );
});

Deno.test("unqualified top-level CREATE TABLE fails closed", () => {
  const scan = findCreatedPublicTables("CREATE TABLE ambiguous_tbl (id uuid);");
  assertEquals(scan.tables, []);
  assertEquals(scan.unrecognized, true);
  assertEquals(reasons(migration("CREATE TABLE ambiguous_tbl (id uuid);")), [
    "unrecognized_public_create_table",
  ]);
});

Deno.test("RLS and containment helpers tolerate quoted identifiers", () => {
  assert(hasRlsEnabled('ALTER TABLE "public"."t" ENABLE ROW LEVEL SECURITY;', "public.t"));
  assertEquals(checkOauthContainment(containment("t"), "public.t"), "ok");
  assertEquals(checkOauthContainment("", "public.t"), "missing");
});

Deno.test("marker parser reports malformed lines", () => {
  const scan = parseClassificationMarkers(`
-- API-HR-READ-CLASSIFICATION: public.a | class=server_only | ordinary=no_authenticated_read_path
-- API-HR-READ-CLASSIFICATION: other.a | class=server_only | ordinary=no_authenticated_read_path
-- API-HR-READ-CLASSIFICATION broken
`);
  assertEquals(scan.markers.length, 1);
  assertEquals(scan.malformed, 2);
});

/* --------------------------- base/head diffing -------------------------- */

Deno.test("historical CREATE TABLE present in both versions is not new", () => {
  const historical = `CREATE TABLE public.old_table (id uuid);`;
  const e = evaluateMigration(
    migration(`${historical}\nCOMMENT ON TABLE public.old_table IS 'x';`, historical),
  );
  assertEquals(e.newTables, []);
  assertEquals(e.violations, []);
});

Deno.test("table inserted into an existing migration between base and head is detected", () => {
  const historical = `CREATE TABLE public.old_table (id uuid);`;
  const e = evaluateMigration(
    migration(`${historical}\nCREATE TABLE public.sneaky (id uuid);`, historical),
  );
  assertEquals(e.newTables, ["public.sneaky"]);
  assertEquals(e.violations.map((v) => v.reason), ["classification_marker_missing"]);
});

/* -------------------------------- CLI ---------------------------------- */

Deno.test("CLI parses explicit base and head refs", () => {
  assertEquals(parseCliArgs(["--base", "HEAD~1", "--head", "HEAD"]), {
    base: "HEAD~1",
    head: "HEAD",
  });
});

Deno.test("unsafe or malformed git refs are rejected as blocked", () => {
  for (const ref of ["--upload-pack=evil", "a;rm -rf /", "$(id)", "", "a b"]) {
    assertEquals(isSafeGitRef(ref), false, ref);
  }
  assertThrows(
    () => parseCliArgs(["--base", "--upload-pack=x", "--head", "HEAD"]),
    GuardBlocked,
  );
  assertThrows(() => parseCliArgs(["--base", "HEAD~1"]), GuardBlocked);
  assertThrows(() => parseCliArgs(["--bogus", "x"]), GuardBlocked);
});

Deno.test("only top-level supabase migration sql paths are inspected", () => {
  assert(isMigrationPath("supabase/migrations/20260101000000_x.sql"));
  assertEquals(isMigrationPath("supabase/functions/foo/index.ts"), false);
  assertEquals(isMigrationPath("supabase/migrations/nested/x.sql"), false);
  assertEquals(isMigrationPath("docs/x.sql"), false);
});

Deno.test("runGuard aggregates counts across migrations", () => {
  const r = runGuard([
    migration(protectedTable("pm_business_data", "protected_rpc_only")),
    { path: "supabase/migrations/2_b.sql", headSql: "CREATE TABLE public.z (id uuid);", baseSql: null },
  ]);
  assertEquals(r.changedMigrations, 2);
  assertEquals(r.newPublicTables, 2);
  assertEquals(r.violations.map((v) => v.reason), ["classification_marker_missing"]);
});
