/**
 * API-Q Cross-Family-C18 — focused static contract test.
 *
 * Targets (browser read RPCs redefined by the C18 migration):
 *   public.get_decrypted_program(uuid)
 *   public.list_decrypted_workspace_programs(uuid)
 *   public.list_decrypted_program_projects(uuid)
 *   public.list_decrypted_project_team(uuid)
 *   public.list_project_raci(uuid)
 *   public.list_project_stakeholders(uuid)
 *
 * Proves, from the migration source:
 *  - the signed external-OAuth gate is the first executable security operation;
 *  - jwt_client_id() failure maps to 'unresolved_client';
 *  - any non-null client id is denied with 42501;
 *  - auth.uid() is resolved exactly once into v_caller (never in DECLARE);
 *  - null / inactive callers are denied before any business read;
 *  - authoritative scope is resolved before canonical Organization membership;
 *  - is_user_org_member is user-first and runs before btpm_decrypt;
 *  - existing browser read-authority helpers are preserved;
 *  - per-target missing-object / unauthorized behavior is preserved;
 *  - result fields / ordering / fallbacks are structurally preserved;
 *  - Project Team + RACI profile email/avatar use safe readable-value handling;
 *  - no GRANT/REVOKE, no schema/RLS/trigger/business-DML drift.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  new URL(
    "../../migrations/20260820025037_e5c0a73d-82ed-49b6-a5df-5d6cace3abd6.sql",
    import.meta.url,
  );

const SQL = Deno.readTextFileSync(MIGRATION);

const TARGETS = [
  "public.get_decrypted_program(_program_id uuid)",
  "public.list_decrypted_workspace_programs(_workspace_id uuid)",
  "public.list_decrypted_program_projects(_program_id uuid)",
  "public.list_decrypted_project_team(_project_id uuid)",
  "public.list_project_raci(_project_id uuid)",
  "public.list_project_stakeholders(_project_id uuid)",
] as const;

function bodyOf(signature: string): string {
  const marker = `CREATE OR REPLACE FUNCTION ${signature}`;
  const start = SQL.indexOf(marker);
  assert(start >= 0, `missing definition for ${signature}`);
  const end = SQL.indexOf("$function$;", start + marker.length);
  assert(end > start, `unterminated definition for ${signature}`);
  return SQL.slice(start, end + "$function$;".length);
}

const BODIES = new Map(TARGETS.map((t) => [t, bodyOf(t)]));

Deno.test("C18 redefines exactly the six target functions", () => {
  const created = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION\s+([a-z_.]+)\(/g)]
    .map((m) => m[1]);
  assertEquals(created.length, 6);
  assertEquals(
    new Set(created),
    new Set([
      "public.get_decrypted_program",
      "public.list_decrypted_workspace_programs",
      "public.list_decrypted_program_projects",
      "public.list_decrypted_project_team",
      "public.list_project_raci",
      "public.list_project_stakeholders",
    ]),
  );
  // No other DDL/DML object kinds are touched.
  for (const forbidden of [
    /\bCREATE\s+TABLE\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bDROP\s+(TABLE|FUNCTION|POLICY|TRIGGER)\b/i,
    /\bCREATE\s+POLICY\b/i,
    /\bCREATE\s+TRIGGER\b/i,
    /^\s*(INSERT|UPDATE|DELETE)\s+/im,
  ]) {
    assert(!forbidden.test(SQL), `forbidden statement matched ${forbidden}`);
  }
});

Deno.test("C18 adds no GRANT or REVOKE", () => {
  assert(!/\bGRANT\b/i.test(SQL));
  assert(!/\bREVOKE\b/i.test(SQL));
});

Deno.test("OAuth gate is the first executable security operation in every target", () => {
  for (const [name, body] of BODIES) {
    const exec = body.slice(body.indexOf("\nBEGIN"));
    const gate = exec.indexOf("api_e_private.jwt_client_id()");
    assert(gate > 0, `${name}: missing jwt_client_id gate`);

    // Nothing security/business relevant may precede the gate.
    const before = exec.slice(0, gate);
    for (const earlier of [
      "auth.uid()",
      "is_active_user",
      "is_user_org_member",
      "btpm_decrypt",
      "SELECT",
      "can_read_project",
      "has_project_access",
      "is_workspace_member",
      "is_org_admin",
    ]) {
      assert(
        !before.includes(earlier),
        `${name}: ${earlier} appears before the OAuth gate`,
      );
    }

    assert(
      /EXCEPTION WHEN OTHERS THEN\s*\n?\s*v_client_id := 'unresolved_client';/
        .test(body),
      `${name}: jwt_client_id failure does not map to unresolved_client`,
    );
    assert(
      /IF v_client_id IS NOT NULL THEN\s*\n?\s*RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/
        .test(body),
      `${name}: non-null client id is not denied with 42501`,
    );
    // No trusted-context / capability / channel escape hatch.
    for (const escape of [
      "source_channel",
      "trusted",
      "capability",
      "mcp",
      "is_api",
      "rest",
    ]) {
      assert(
        !body.toLowerCase().includes(escape),
        `${name}: OAuth gate has an escape hatch (${escape})`,
      );
    }
  }
});

Deno.test("auth.uid() resolved once into v_caller, never in DECLARE", () => {
  for (const [name, body] of BODIES) {
    const declare = body.slice(body.indexOf("DECLARE"), body.indexOf("\nBEGIN"));
    assert(!declare.includes("auth.uid()"), `${name}: auth.uid() in DECLARE`);
    assert(declare.includes("v_client_id text;"), `${name}: v_client_id missing`);
    assert(declare.includes("v_caller uuid;"), `${name}: v_caller missing`);

    const occurrences = body.split("auth.uid()").length - 1;
    assertEquals(occurrences, 1, `${name}: auth.uid() called ${occurrences} times`);
    assert(body.includes("v_caller := auth.uid();"), `${name}: no single resolution`);
    assert(
      /IF v_caller IS NULL THEN\s*\n?\s*RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/
        .test(body),
      `${name}: null caller not denied`,
    );
    assert(
      /IF NOT public\.is_active_user\(v_caller\) THEN\s*\n?\s*RAISE EXCEPTION 'Account is deactivated' USING ERRCODE = '42501';/
        .test(body),
      `${name}: inactive caller not denied`,
    );

    // auth + active precede every protected read / decrypt.
    const activeAt = body.indexOf("is_active_user(v_caller)");
    for (const later of ["btpm_decrypt", "is_user_org_member"]) {
      const at = body.indexOf(later);
      assert(at > activeAt, `${name}: ${later} precedes the active-user check`);
    }
  }
});

Deno.test("authoritative scope precedes canonical Organization membership, which precedes decrypt", () => {
  const scopeQuery: Record<string, string> = {
    "public.get_decrypted_program(_program_id uuid)":
      "FROM public.programs WHERE id = _program_id",
    "public.list_decrypted_workspace_programs(_workspace_id uuid)":
      "FROM public.workspaces w WHERE w.id = _workspace_id",
    "public.list_decrypted_program_projects(_program_id uuid)":
      "FROM public.programs WHERE id = _program_id",
    "public.list_decrypted_project_team(_project_id uuid)":
      "FROM public.projects WHERE id = _project_id",
    "public.list_project_raci(_project_id uuid)":
      "FROM public.projects pr WHERE pr.id = _project_id",
    "public.list_project_stakeholders(_project_id uuid)":
      "FROM public.projects pr WHERE pr.id = _project_id",
  };

  for (const [name, body] of BODIES) {
    const scopeAt = body.indexOf(scopeQuery[name]);
    assert(scopeAt > 0, `${name}: authoritative scope lookup missing`);

    const memberAt = body.indexOf("public.is_user_org_member(v_caller,");
    assert(memberAt > scopeAt, `${name}: org membership check precedes scope lookup`);

    const decryptAt = body.indexOf("btpm_decrypt");
    assert(decryptAt > memberAt, `${name}: btpm_decrypt precedes org containment`);
  }
});

Deno.test("preserved browser read-authority rules per target", () => {
  const program = BODIES.get("public.get_decrypted_program(_program_id uuid)")!;
  assert(program.includes("public.is_workspace_member(v_caller, v_prog.workspace_id)"));
  assert(program.includes("public.is_org_admin(v_caller, v_prog.organization_id)"));

  const wsPrograms = BODIES.get(
    "public.list_decrypted_workspace_programs(_workspace_id uuid)",
  )!;
  assert(wsPrograms.includes("public.is_workspace_member(v_caller, _workspace_id)"));
  assert(wsPrograms.includes("public.is_org_admin(v_caller, _org_id)"));

  const progProjects = BODIES.get(
    "public.list_decrypted_program_projects(_program_id uuid)",
  )!;
  assert(progProjects.includes("public.is_workspace_member(v_caller, _ws_id)"));
  assert(progProjects.includes("public.is_org_admin(v_caller, _org_id)"));

  const team = BODIES.get("public.list_decrypted_project_team(_project_id uuid)")!;
  assert(team.includes("public.can_read_project_or_demo(v_caller, _project_id)"));

  const raci = BODIES.get("public.list_project_raci(_project_id uuid)")!;
  assert(raci.includes("public.can_read_project(v_caller, _project_id)"));

  const stake = BODIES.get("public.list_project_stakeholders(_project_id uuid)")!;
  assert(stake.includes("public.can_read_project(v_caller, _project_id)"));

  // No write / PM / can_write_demo gate is introduced anywhere.
  for (const [name, body] of BODIES) {
    for (const writeGate of ["can_write_demo", "has_pm_authority", "_assert_pm_or_admin"]) {
      assert(!body.includes(writeGate), `${name}: write gate ${writeGate} introduced`);
    }
  }
});

Deno.test("preserved missing-object / unauthorized behavior per target", () => {
  const program = BODIES.get("public.get_decrypted_program(_program_id uuid)")!;
  assert(!program.includes("Program not found"));
  assert(program.includes("RAISE EXCEPTION 'Access denied'"));

  const wsPrograms = BODIES.get(
    "public.list_decrypted_workspace_programs(_workspace_id uuid)",
  )!;
  assert(!wsPrograms.includes("Workspace not found"));
  assert(/IF _org_id IS NULL THEN\s*\n?\s*RAISE EXCEPTION 'Access denied';/.test(wsPrograms));

  const progProjects = BODIES.get(
    "public.list_decrypted_program_projects(_program_id uuid)",
  )!;
  assert(/IF _ws_id IS NULL THEN RAISE EXCEPTION 'Program not found'/.test(progProjects));

  const team = BODIES.get("public.list_decrypted_project_team(_project_id uuid)")!;
  assert(/IF NOT FOUND THEN RETURN '\[\]'::json; END IF;/.test(team));
  assert(team.includes("RAISE EXCEPTION 'Not authorized'"));

  // RACI hides existence: missing project, non-member and no-access all return [].
  const raci = BODIES.get("public.list_project_raci(_project_id uuid)")!;
  assert(!raci.includes("Project not found"));
  assert(/IF v_org IS NULL THEN RETURN '\[\]'::json; END IF;/.test(raci));
  assert(
    /IF NOT public\.is_user_org_member\(v_caller, v_org\) THEN\s*\n?\s*RETURN '\[\]'::json;/
      .test(raci),
  );
  assert(
    /IF NOT public\.can_read_project\(v_caller, _project_id\) THEN\s*\n?\s*RETURN '\[\]'::json;/
      .test(raci),
  );
  assert(raci.includes("RETURN COALESCE(_result, '[]'::json);"));

  const stake = BODIES.get("public.list_project_stakeholders(_project_id uuid)")!;
  assert(
    stake.includes("RAISE EXCEPTION 'Project not found' USING ERRCODE = 'P0002'"),
  );
  assert(
    stake.includes(
      "RAISE EXCEPTION 'Forbidden: not authorized to read this project' USING ERRCODE = '42501'",
    ),
  );
});

Deno.test("result shape, ordering and fallbacks are structurally preserved", () => {
  const program = BODIES.get("public.get_decrypted_program(_program_id uuid)")!;
  for (const field of [
    "'id'",
    "'name'",
    "'description'",
    "'status'",
    "'is_archived'",
    "'workspace_id'",
    "'organization_id'",
    "'created_by'",
    "'created_at'",
    "'updated_at'",
  ]) assert(program.includes(field), `program field ${field} missing`);

  const wsPrograms = BODIES.get(
    "public.list_decrypted_workspace_programs(_workspace_id uuid)",
  )!;
  assert(wsPrograms.includes("ORDER BY public.btpm_decrypt(pg.name, pg.organization_id)"));
  assert(wsPrograms.includes("'[]'::jsonb"));
  assert(wsPrograms.includes("WHERE pg.workspace_id = _workspace_id"));

  const progProjects = BODIES.get(
    "public.list_decrypted_program_projects(_program_id uuid)",
  )!;
  assert(progProjects.includes("p.is_archived = false"));
  assert(progProjects.includes("ORDER BY public.btpm_decrypt(p.name, p.organization_id)"));
  assert(progProjects.includes("'[]'::jsonb"));
  for (const field of ["'priority'", "'start_date'", "'target_end_date'", "'status'"]) {
    assert(progProjects.includes(field), `program project field ${field} missing`);
  }

  const team = BODIES.get("public.list_decrypted_project_team(_project_id uuid)")!;
  for (const field of [
    "'id'",
    "'project_id'",
    "'workspace_id'",
    "'organization_id'",
    "'user_id'",
    "'role_label'",
    "'canonical_role_key'",
    "'created_at'",
    "'updated_at'",
    "'display_name'",
    "'email'",
    "'avatar_url'",
  ]) assert(team.includes(field), `team field ${field} missing`);
  assert(team.includes("'[]'::json)"));

  const raci = BODIES.get("public.list_project_raci(_project_id uuid)")!;
  for (const field of [
    "ra.id",
    "ra.target_type",
    "ra.target_id",
    "ra.user_id",
    "ra.stakeholder_id",
    "ra.raci_role",
    "ra.created_at",
    "ra.updated_at",
    "ra.workspace_id",
    "ra.organization_id",
    "AS display_name",
    "AS stakeholder_type",
    "AS stakeholder_role_label",
    "AS email",
    "AS avatar_url",
  ]) assert(raci.includes(field), `raci field ${field} missing`);
  assert(raci.includes("WHERE ra.target_type = 'project' AND ra.target_id = _project_id"));
  assert(raci.includes("ORDER BY ra.created_at"));

  const stake = BODIES.get("public.list_project_stakeholders(_project_id uuid)")!;
  assert(
    stake.includes(
      "RETURNS TABLE(id uuid, stakeholder_type text, user_id uuid, external_name text, display_name text, role_label text, notes text, start_date date, created_at timestamp with time zone, created_by uuid, created_by_name text, removed_at timestamp with time zone, removed_by uuid, removed_by_name text, updated_at timestamp with time zone)",
    ),
    "stakeholder RETURNS TABLE signature drifted",
  );
  assert(
    stake.includes("ORDER BY (s.removed_at IS NOT NULL) ASC, s.created_at DESC"),
    "stakeholder ordering drifted",
  );
  assert(stake.includes("AS created_by_name"));
  assert(stake.includes("AS removed_by_name"));
});

Deno.test("Project Team profile email/avatar use safe readable-value handling", () => {
  const team = BODIES.get("public.list_decrypted_project_team(_project_id uuid)")!;
  const normalized = team.replace(/\s+/g, " ");
  assert(
    normalized.includes(
      "'email', CASE WHEN p.organization_id IS NOT NULL AND p.email IS NOT NULL THEN public.btpm_decrypt(p.email, p.organization_id) ELSE p.email END",
    ),
    "team email is not read through safe readable-value handling",
  );
  assert(
    normalized.includes(
      "'avatar_url', CASE WHEN p.organization_id IS NOT NULL AND p.avatar_url IS NOT NULL THEN public.btpm_decrypt(p.avatar_url, p.organization_id) ELSE p.avatar_url END",
    ),
    "team avatar_url still returns raw ciphertext",
  );
  // role_label uses the team-row organization; display_name the profile organization.
  assert(team.includes("public.btpm_decrypt(ptm.role_label, ptm.organization_id)"));
  assert(team.includes("public.btpm_decrypt(p.display_name, p.organization_id)"));
});

Deno.test("RACI profile email/avatar use safe readable-value handling", () => {
  const raci = BODIES.get("public.list_project_raci(_project_id uuid)")!;
  const normalized = raci.replace(/\s+/g, " ");
  assert(
    normalized.includes(
      "CASE WHEN p.organization_id IS NOT NULL AND p.avatar_url IS NOT NULL THEN public.btpm_decrypt(p.avatar_url, p.organization_id) ELSE p.avatar_url END AS avatar_url",
    ),
    "raci avatar_url still returns raw ciphertext",
  );
  assert(
    normalized.includes(
      "CASE WHEN p.organization_id IS NOT NULL AND p.email IS NOT NULL THEN public.btpm_decrypt(p.email, p.organization_id) ELSE p.email END AS email",
    ),
    "raci email is not read through safe readable-value handling",
  );
  // Stakeholder-first display name resolution preserved.
  assert(raci.includes("ps.external_name"));
  assert(raci.includes("public.btpm_decrypt(psp.display_name, psp.organization_id)"));
});

Deno.test("function properties (volatility / definer / search_path) preserved", () => {
  const expectations: Record<string, string[]> = {
    "public.get_decrypted_program(_program_id uuid)": [
      "RETURNS jsonb",
      "STABLE SECURITY DEFINER",
      "SET search_path TO 'public', 'extensions'",
    ],
    "public.list_decrypted_workspace_programs(_workspace_id uuid)": [
      "RETURNS jsonb",
      "STABLE SECURITY DEFINER",
      "SET search_path TO 'public', 'extensions'",
    ],
    "public.list_decrypted_program_projects(_program_id uuid)": [
      "RETURNS jsonb",
      "STABLE SECURITY DEFINER",
      "SET search_path TO 'public', 'extensions'",
    ],
    "public.list_decrypted_project_team(_project_id uuid)": [
      "RETURNS json",
      "STABLE SECURITY DEFINER",
      "SET search_path TO 'public'",
    ],
    "public.list_project_raci(_project_id uuid)": [
      "RETURNS json",
      "STABLE SECURITY DEFINER",
      "SET search_path TO 'public'",
    ],
    "public.list_project_stakeholders(_project_id uuid)": [
      "SECURITY DEFINER",
      "SET search_path TO 'public', 'extensions'",
    ],
  };
  for (const [name, props] of Object.entries(expectations)) {
    const body = BODIES.get(name as typeof TARGETS[number])!;
    for (const prop of props) {
      assert(body.includes(prop), `${name}: property drift, missing ${prop}`);
    }
  }
  // Stakeholder reader stays VOLATILE (no STABLE marker added).
  assert(
    !BODIES.get("public.list_project_stakeholders(_project_id uuid)")!
      .includes("STABLE SECURITY DEFINER"),
  );
});

Deno.test("frontend callers still reference the same RPC names", async () => {
  const files: Record<string, string[]> = {
    "src/hooks/usePrograms.ts": [
      "get_decrypted_program",
      "list_decrypted_workspace_programs",
      "list_decrypted_program_projects",
    ],
    "src/hooks/useProjectTeamRaci.ts": [
      "list_decrypted_project_team",
      "list_project_raci",
    ],
    "src/hooks/useProjectOverview.ts": ["list_decrypted_project_team"],
    "src/hooks/useProjectStakeholders.ts": ["list_project_stakeholders"],
  };
  for (const [path, rpcs] of Object.entries(files)) {
    const src = await Deno.readTextFile(
      new URL(`../../../${path}`, import.meta.url),
    );
    for (const rpc of rpcs) {
      assert(src.includes(rpc), `${path}: missing caller for ${rpc}`);
    }
  }
});
