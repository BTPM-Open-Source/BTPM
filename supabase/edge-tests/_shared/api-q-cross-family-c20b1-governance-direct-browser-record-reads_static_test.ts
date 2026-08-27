/**
 * API-Q Cross-Family-C20B1 — Governance Direct Browser Record Reads
 * Outer OAuth / Authentication Boundary Closure — focused static contract test.
 *
 * Target migration:
 *   supabase/migrations/20260820075407_2416cea5-a2d7-4c3a-a589-c65a05ba76bf.sql
 *
 * Proves for exactly six outer Governance read RPCs:
 *   - exact signatures/defaults, RETURNS, language, volatility,
 *     SECURITY DEFINER, search_path preserved
 *   - OAuth gate is the first executable security operation
 *   - resolver failure maps to 'unresolved_client'
 *   - non-null client_id rejects with 42501
 *   - no OAuth/API/MCP/trusted/service-role bypass
 *   - exactly one auth.uid() resolution, after the OAuth gate
 *   - null/inactive rejection before the first protected/business lookup
 *   - authoritative target lookup retained
 *   - _gov_assert_project_read after target resolution, before decrypt /
 *     nested protected reads / Decision Case payload construction
 *   - no GRANT/REVOKE, no schema/RLS/trigger/encryption/business-DML drift
 *   - exactly six functions redefined
 */
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIGRATION =
  "supabase/migrations/20260820075407_2416cea5-a2d7-4c3a-a589-c65a05ba76bf.sql";

const FUNCTIONS = [
  {
    name: "get_governance_record_detail",
    signature: "public.get_governance_record_detail(_record_id uuid)",
    firstLookup: "FROM governance_records WHERE id = _record_id",
    govCall: "PERFORM _gov_assert_project_read(_row.project_id);",
    decisionCaseCheck: null as string | null,
  },
  {
    name: "get_governance_record_decision_outcome",
    signature: "public.get_governance_record_decision_outcome(_record_id uuid)",
    firstLookup: "FROM public.governance_records WHERE id = _record_id",
    govCall: "PERFORM public._gov_assert_project_read(_row.project_id);",
    decisionCaseCheck:
      "Decision outcomes are only available for decision cases",
  },
  {
    name: "list_governance_record_brief_versions",
    signature: "public.list_governance_record_brief_versions(_record_id uuid)",
    firstLookup: "FROM public.governance_records WHERE id = _record_id",
    govCall: "PERFORM public._gov_assert_project_read(_row.project_id);",
    decisionCaseCheck: "Brief versions are only available for decision cases",
  },
  {
    name: "list_governance_record_evidence_references",
    signature:
      "public.list_governance_record_evidence_references(_record_id uuid, _include_archived boolean DEFAULT false)",
    firstLookup: "FROM governance_records WHERE id = _record_id",
    govCall: "PERFORM _gov_assert_project_read(_row.project_id);",
    decisionCaseCheck:
      "Evidence references are only available for decision cases",
  },
  {
    name: "list_governance_record_evidence_files",
    signature:
      "public.list_governance_record_evidence_files(_record_id uuid, _include_archived boolean DEFAULT false)",
    firstLookup: "FROM governance_records WHERE id = _record_id",
    govCall: "PERFORM _gov_assert_project_read(_row.project_id);",
    decisionCaseCheck: "Evidence files are only available for decision cases",
  },
  {
    name: "list_governance_record_stakeholder_packages",
    signature:
      "public.list_governance_record_stakeholder_packages(_record_id uuid)",
    firstLookup: "FROM public.governance_records WHERE id = _record_id",
    govCall: "PERFORM public._gov_assert_project_read(_row.project_id);",
    decisionCaseCheck:
      "Stakeholder packages are only available for decision cases",
  },
] as const;

const sql = await Deno.readTextFile(MIGRATION);

/** Slice the migration text belonging to one function body. */
function bodyOf(signature: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${signature}`);
  assert(start >= 0, `function not redefined: ${signature}`);
  const end = sql.indexOf("END; $function$", start);
  assert(end > start, `unterminated body: ${signature}`);
  return sql.slice(start, end + "END; $function$".length);
}

Deno.test("C20B1: exactly six functions redefined and no others", () => {
  const defs = [...sql.matchAll(/CREATE OR REPLACE FUNCTION\s+([^\s(]+)\(/g)]
    .map((m) => m[1]);
  assertEquals(defs.length, 6, `expected 6 definitions, got ${defs.length}`);
  const expected = FUNCTIONS.map((f) => `public.${f.name}`).sort();
  assertEquals([...defs].sort(), expected);
});

Deno.test("C20B1: exact signatures and defaults preserved", () => {
  for (const f of FUNCTIONS) {
    assert(
      sql.includes(`CREATE OR REPLACE FUNCTION ${f.signature}`),
      `signature drift for ${f.name}`,
    );
  }
  // both boolean-arg readers keep DEFAULT false
  assertEquals(
    [...sql.matchAll(/_include_archived boolean DEFAULT false/g)].length,
    2,
  );
});

Deno.test("C20B1: return/property/search_path contract preserved", () => {
  for (const f of FUNCTIONS) {
    const body = bodyOf(f.signature);
    assert(/\n\s*RETURNS jsonb\n/.test(body), `RETURNS drift ${f.name}`);
    assert(/\n\s*LANGUAGE plpgsql\n/.test(body), `LANGUAGE drift ${f.name}`);
    assert(
      /\n\s*STABLE SECURITY DEFINER\n/.test(body),
      `volatility/secdef drift ${f.name}`,
    );
    assert(
      body.includes("SET search_path TO 'public', 'extensions'"),
      `search_path drift ${f.name}`,
    );
  }
});

Deno.test("C20B1: OAuth gate is the first executable security operation", () => {
  for (const f of FUNCTIONS) {
    const body = bodyOf(f.signature);
    const beginIdx = body.indexOf("\nBEGIN\n");
    assert(beginIdx > 0, `no outer BEGIN in ${f.name}`);
    const exec = body.slice(beginIdx);

    const resolver = exec.indexOf("api_e_private.jwt_client_id()");
    assert(resolver > 0, `missing OAuth resolver in ${f.name}`);

    // nothing else executes first
    for (const forbidden of [
      "auth.uid()",
      "public.is_active_user",
      "SELECT * INTO _row",
      "_gov_assert_project_read",
      "btpm_decrypt",
    ]) {
      const at = exec.indexOf(forbidden);
      assert(
        at === -1 || at > resolver,
        `${forbidden} precedes OAuth gate in ${f.name}`,
      );
    }
  }
});

Deno.test("C20B1: resolver failure maps to unresolved_client", () => {
  for (const f of FUNCTIONS) {
    const body = bodyOf(f.signature);
    assert(
      /BEGIN\s+v_client_id := api_e_private\.jwt_client_id\(\);\s+EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';\s+END;/
        .test(body),
      `fail-closed resolver envelope missing in ${f.name}`,
    );
  }
});

Deno.test("C20B1: non-null client_id rejects with 42501", () => {
  for (const f of FUNCTIONS) {
    const body = bodyOf(f.signature);
    assert(
      /IF v_client_id IS NOT NULL THEN\s+RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';\s+END IF;/
        .test(body),
      `OAuth denial missing/incorrect in ${f.name}`,
    );
  }
});

Deno.test("C20B1: no OAuth/API/MCP/trusted/service-role bypass", () => {
  const forbidden = [
    "trusted",
    "source_channel",
    "capability",
    "service_role",
    "connected_app",
    "mcp",
    "is_api_caller",
    "IS NULL OR v_client_id",
    "v_client_id IS NULL AND",
  ];
  for (const f of FUNCTIONS) {
    const body = bodyOf(f.signature).toLowerCase();
    for (const token of forbidden) {
      assert(
        !body.includes(token.toLowerCase()),
        `possible bypass token "${token}" in ${f.name}`,
      );
    }
  }
});

Deno.test("C20B1: exactly one auth.uid() resolution, after the OAuth gate", () => {
  for (const f of FUNCTIONS) {
    const body = bodyOf(f.signature);
    assertEquals(
      [...body.matchAll(/auth\.uid\(\)/g)].length,
      1,
      `auth.uid() must resolve exactly once in ${f.name}`,
    );
    assert(
      body.indexOf("auth.uid()") >
        body.indexOf("v_client_id IS NOT NULL"),
      `auth.uid() resolved before OAuth gate in ${f.name}`,
    );
    // not initialized in DECLARE
    const declare = body.slice(
      body.indexOf("DECLARE"),
      body.indexOf("\nBEGIN\n"),
    );
    assert(
      !declare.includes("auth.uid()"),
      `auth.uid() initialized in DECLARE of ${f.name}`,
    );
    assert(
      declare.includes("v_client_id text;") &&
        declare.includes("v_caller uuid;"),
      `required declarations missing in ${f.name}`,
    );
  }
});

Deno.test("C20B1: null/inactive rejection precedes first protected lookup", () => {
  for (const f of FUNCTIONS) {
    const body = bodyOf(f.signature);
    assert(
      /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';\s+END IF;/
        .test(body),
      `auth/active gate missing in ${f.name}`,
    );
    const gate = body.indexOf("public.is_active_user(v_caller)");
    const lookup = body.indexOf(f.firstLookup);
    assert(lookup > 0, `authoritative lookup missing in ${f.name}`);
    assert(
      gate < lookup,
      `active-user gate does not precede first business lookup in ${f.name}`,
    );
  }
});

Deno.test("C20B1: authoritative lookup and missing-row behavior retained", () => {
  for (const f of FUNCTIONS) {
    const body = bodyOf(f.signature);
    assert(body.includes(f.firstLookup), `lookup drift in ${f.name}`);
    assert(
      body.includes(
        "IF NOT FOUND THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'; END IF;",
      ),
      `missing-row behavior drift in ${f.name}`,
    );
  }
});

Deno.test("C20B1: _gov_assert_project_read after target resolution, before decrypt/child reads/type checks", () => {
  for (const f of FUNCTIONS) {
    const body = bodyOf(f.signature);
    const lookup = body.indexOf(f.firstLookup);
    const gov = body.indexOf(f.govCall);
    assert(gov > 0, `_gov_assert_project_read call drift in ${f.name}`);
    assert(gov > lookup, `authority check precedes target lookup in ${f.name}`);

    const decrypt = body.indexOf("btpm_decrypt");
    assert(
      decrypt === -1 || decrypt > gov,
      `decrypt precedes project authority in ${f.name}`,
    );

    if (f.decisionCaseCheck) {
      const typeCheck = body.indexOf(f.decisionCaseCheck);
      assert(typeCheck > 0, `Decision Case check missing in ${f.name}`);
      assert(
        typeCheck > gov,
        `Decision Case check precedes project authority in ${f.name}`,
      );
    }
  }
});

Deno.test("C20B1: detail reader keeps cadence + child reads after authority", () => {
  const body = bodyOf(FUNCTIONS[0].signature);
  const gov = body.indexOf(FUNCTIONS[0].govCall);
  for (const child of [
    "FROM governance_cadences WHERE id = _row.cadence_id",
    "FROM governance_record_decisions d",
    "FROM governance_record_links l",
  ]) {
    const at = body.indexOf(child);
    assert(at > gov, `child read "${child}" precedes project authority`);
  }
  assert(body.includes("ORDER BY d.created_at ASC"));
  assert(body.includes("ORDER BY l.created_at ASC"));
  assert(body.includes("'has_sharepoint_evidence'"));
});

Deno.test("C20B1: result field / ordering semantics preserved", () => {
  // decision outcome: null-if-none semantics
  const outcome = bodyOf(FUNCTIONS[1].signature);
  assert(outcome.includes("RETURN _result; -- NULL if none"));
  assert(outcome.includes("FROM public.governance_record_decision_outcomes o"));

  // brief versions + stakeholder packages: current-first, version desc
  for (const sig of [FUNCTIONS[2].signature, FUNCTIONS[5].signature]) {
    const body = bodyOf(sig);
    assert(
      body.includes(
        "jsonb_agg(payload ORDER BY current_sort, version_number_v DESC)",
      ),
      "version ordering drift",
    );
    assert(body.includes("is_current THEN 0 ELSE 1 END AS current_sort"));
  }

  // evidence references + files: include-archived filter and relevance ordering
  for (const f of [FUNCTIONS[3], FUNCTIONS[4]]) {
    const body = bodyOf(f.signature);
    const alias = f.name.endsWith("references") ? "e" : "f";
    assert(
      body.includes(
        `(_include_archived OR ${alias}.archived_at IS NULL)`,
      ),
      `include-archived filter drift in ${f.name}`,
    );
    assert(
      body.includes(
        `CASE ${alias}.relevance_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END ASC`,
      ),
      `relevance ordering drift in ${f.name}`,
    );
  }
  assert(
    bodyOf(FUNCTIONS[3].signature).includes(
      "e.evidence_date DESC NULLS LAST",
    ),
  );
  assert(bodyOf(FUNCTIONS[4].signature).includes("f.selected_at DESC"));
  assert(bodyOf(FUNCTIONS[4].signature).includes("'item_reference_hash'"));
});

Deno.test("C20B1: no GRANT/REVOKE and no schema/RLS/trigger/DML drift", () => {
  // strip leading SQL line comments so documentation prose is not scanned
  const executable = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const forbidden = [
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /CREATE TABLE/i,
    /ALTER TABLE/i,
    /DROP TABLE/i,
    /CREATE POLICY/i,
    /DROP POLICY/i,
    /ROW LEVEL SECURITY/i,
    /CREATE TRIGGER/i,
    /DROP TRIGGER/i,
    /CREATE SCHEMA/i,
    /\bINSERT INTO\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE FROM\b/i,
    /ALTER FUNCTION/i,
    /DROP FUNCTION/i,
    /ALTER DATABASE/i,
  ];
  for (const re of forbidden) {
    assert(!re.test(executable), `forbidden statement present: ${re}`);
  }
  // non-goal functions must not be touched
  for (const name of [
    "_gov_assert_project_read(",
    "_gov_assert_project_write(",
  ]) {
    assert(
      !executable.includes(`CREATE OR REPLACE FUNCTION public.${name}`),
      `non-goal helper redefined: ${name}`,
    );
  }
});

Deno.test("C20B1: frontend callers unchanged (RPC names still referenced)", async () => {
  const hooks: Array<[string, string]> = [
    ["src/hooks/useProjectGovernance.ts", "get_governance_record_detail"],
    [
      "src/hooks/useGovernanceDecisionOutcome.ts",
      "get_governance_record_decision_outcome",
    ],
    [
      "src/hooks/useGovernanceBriefVersions.ts",
      "list_governance_record_brief_versions",
    ],
    [
      "src/hooks/useGovernanceEvidenceReferences.ts",
      "list_governance_record_evidence_references",
    ],
    [
      "src/hooks/useGovernanceEvidenceFiles.ts",
      "list_governance_record_evidence_files",
    ],
    [
      "src/hooks/useGovernanceStakeholderPackages.ts",
      "list_governance_record_stakeholder_packages",
    ],
  ];
  for (const [path, rpc] of hooks) {
    const src = await Deno.readTextFile(path);
    assert(src.includes(rpc), `frontend caller drift: ${path} -> ${rpc}`);
  }
});
