// API-G.5.5B — Platform policy-version administration backend.
//
// Repository static contract test. Locates the migration by its unique marker
// and asserts the frozen API-G.5.5B administration contract:
//   - Only the two existing platform-admin audit CHECK constraints are
//     replaced, every accepted API-G.5.5A value is retained, and the new
//     policy_version / policy_* values are added.
//   - The audit table keeps its RLS, zero-policy, append-only, privilege,
//     index and restrictive-FK posture: this migration touches neither.
//   - public.api_g_5_5_enforce_policy_version_lifecycle() is attached as a
//     BEFORE INSERT OR UPDATE OR DELETE row trigger and enforces every rule
//     of the frozen lifecycle: no delete, draft-only insert, permanent
//     identity and parent identity, the exact permitted progression, frozen
//     metadata after draft, immutable historical effective_at, one-shot
//     retired_at and parent-row locking.
//   - Three Platform-Super-Admin-only RPCs exist with the exact signatures,
//     derive the actor exclusively from auth.uid(), accept no caller-supplied
//     actor, scope or digest, are SECURITY DEFINER with a fixed search_path,
//     revoked from PUBLIC/anon and executable only by authenticated.
//   - Digests are calculated server side with extensions.digest over the
//     exact transient UTF-8 document bytes; the document is never persisted,
//     audited, logged or returned.
//   - Parent-first locking and locked-parent revalidation exist on both
//     policy-by-ID commands, with SQLSTATE 40001 before mutation and audit.
//   - Activation atomically supersedes any prior active policy, writing two
//     policy_transition audit events when two rows change.
//   - No acknowledgement row is rewritten or deleted; the exact-active-policy
//     runtime contract is untouched.
//   - No delete RPC, no supported-capability / grant / enablement / UX /
//     route / Edge Function / OAuth-provider / secret / Astra / rate-profile /
//     activity-ledger / Tenant / Baseline / encryption / tenant_integrations
//     change; prior API-C, API-D, API-E, G.5.4, G.5.5A and G.5.5A-C1
//     migrations remain unchanged.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.5B — Platform policy-version administration backend";

const PRIOR_MARKERS = [
  "API-C.2",
  "API-D",
  "API-E",
  "API-G.5.4 — OAuth registration metadata",
  "API-G.5.4-C1 — OAuth lifecycle rollback and active-insert integrity",
  "API-G.5.5A — Platform client and OAuth-redirect administration backend",
  "API-G.5.5A-C1 — Redirect authoritative-parent revalidation",
] as const;

async function readMigrations(): Promise<{ name: string; sql: string }[]> {
  const out: { name: string; sql: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    out.push({
      name: entry.name,
      sql: await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const allMigrations = await readMigrations();
const matches = allMigrations.filter((m) => m.sql.includes(MARKER));
if (matches.length !== 1) {
  throw new Error(
    `expected exactly one API-G.5.5B migration (marker: ${MARKER}), found ${matches.length}`,
  );
}
const migration = matches[0];
const sql = migration.sql;
const lower = sql.toLowerCase();

// SQL comment lines are documentation, not executable material.
const executable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const executableLower = executable.toLowerCase();

const RPCS = [
  "api_g_5_5_platform_create_policy_version",
  "api_g_5_5_platform_update_draft_policy_version",
  "api_g_5_5_platform_transition_policy_version",
] as const;

function bodyOf(fnName: string): string {
  const start = executableLower.indexOf(
    `create or replace function public.${fnName}`,
  );
  assert(start >= 0, `function not found: ${fnName}`);
  const end = executableLower.indexOf("\n$$;", start);
  assert(end > start, `function body terminator not found: ${fnName}`);
  return executableLower.slice(start, end);
}

const triggerBody = bodyOf("api_g_5_5_enforce_policy_version_lifecycle");

// ---------------------------------------------------------------------------
// 1. Audit constraint extension only
// ---------------------------------------------------------------------------

Deno.test("API-G.5.5B: exactly the two audit CHECK constraints are replaced", () => {
  const drops = executableLower.match(/drop constraint api_platform_admin_audit_events_\w+/g) ?? [];
  assert(drops.length === 2, `expected 2 constraint drops, got ${drops.length}`);
  assert(
    drops.includes("drop constraint api_platform_admin_audit_events_target_type_chk"),
  );
  assert(
    drops.includes("drop constraint api_platform_admin_audit_events_action_chk"),
  );

  const adds = executableLower.match(/add constraint api_platform_admin_audit_events_\w+/g) ?? [];
  assert(adds.length === 2, `expected 2 constraint adds, got ${adds.length}`);
  assert(adds.includes("add constraint api_platform_admin_audit_events_target_type_chk"));
  assert(adds.includes("add constraint api_platform_admin_audit_events_action_chk"));

  // The source_channel constraint is untouched.
  assert(!executableLower.includes("api_platform_admin_audit_events_source_channel_chk"));
});

Deno.test("API-G.5.5B: audit target_type retains G.5.5A values and adds policy_version", () => {
  const start = executableLower.indexOf(
    "add constraint api_platform_admin_audit_events_target_type_chk",
  );
  assert(start >= 0);
  const clause = executableLower.slice(start, start + 260);
  for (const v of ["'api_client'", "'oauth_redirect'", "'policy_version'"]) {
    assert(clause.includes(v), `missing target_type value ${v}`);
  }
});

Deno.test("API-G.5.5B: audit action retains G.5.5A values and adds the three policy actions", () => {
  const start = executableLower.indexOf(
    "add constraint api_platform_admin_audit_events_action_chk",
  );
  assert(start >= 0);
  const clause = executableLower.slice(start, start + 500);
  for (
    const v of [
      "'client_create'",
      "'client_update'",
      "'client_transition'",
      "'redirect_create'",
      "'redirect_update'",
      "'redirect_transition'",
      "'policy_create'",
      "'policy_update'",
      "'policy_transition'",
    ]
  ) {
    assert(clause.includes(v), `missing action value ${v}`);
  }
});

Deno.test("API-G.5.5B: audit RLS, policies, privileges, indexes, FK and append-only untouched", () => {
  for (
    const forbidden of [
      "create table public.api_platform_admin_audit_events",
      "drop table public.api_platform_admin_audit_events",
      "create policy",
      "alter table public.api_platform_admin_audit_events enable row level security",
      "alter table public.api_platform_admin_audit_events disable row level security",
      "api_platform_admin_audit_events_client_idx",
      "api_platform_admin_audit_events_actor_idx",
      "api_g_5_5_platform_admin_audit_append_only",
      "api_g_5_5_protect_platform_admin_audit_event",
      "add column",
      "drop column",
    ]
  ) {
    assert(
      !executableLower.includes(forbidden),
      `migration must not contain: ${forbidden}`,
    );
  }
  assert(
    !/grant[\s\S]{0,120}api_platform_admin_audit_events/.test(executableLower),
    "audit table privileges must remain unchanged",
  );
});

// ---------------------------------------------------------------------------
// 2. Lifecycle trigger
// ---------------------------------------------------------------------------

Deno.test("API-G.5.5B: lifecycle trigger is BEFORE INSERT OR UPDATE OR DELETE per row", () => {
  assert(
    executableLower.includes("create trigger api_g_5_5_policy_version_lifecycle"),
  );
  const start = executableLower.indexOf(
    "create trigger api_g_5_5_policy_version_lifecycle",
  );
  const stmt = executableLower.slice(start, executableLower.indexOf(";", start));
  assert(stmt.includes("before insert or update or delete"));
  assert(stmt.includes("on public.api_client_policy_versions"));
  assert(stmt.includes("for each row"));
  assert(
    stmt.includes(
      "execute function public.api_g_5_5_enforce_policy_version_lifecycle()",
    ),
  );
});

Deno.test("API-G.5.5B: lifecycle trigger function security posture is exact", () => {
  assert(triggerBody.includes("returns trigger"));
  assert(triggerBody.includes("language plpgsql"));
  assert(triggerBody.includes("security definer"));
  assert(triggerBody.includes("set search_path = public, pg_catalog"));
  assert(!triggerBody.includes("execute format"));
  assert(!triggerBody.includes("execute '"));

  for (const role of ["public", "anon", "authenticated"]) {
    assert(
      executableLower.includes(
        `revoke all on function public.api_g_5_5_enforce_policy_version_lifecycle() from ${role}`,
      ),
      `missing revoke from ${role}`,
    );
  }
  assert(
    executableLower.includes(
      "grant execute on function public.api_g_5_5_enforce_policy_version_lifecycle() to service_role",
    ),
  );
  assert(
    !executableLower.includes(
      "grant execute on function public.api_g_5_5_enforce_policy_version_lifecycle() to authenticated",
    ),
  );
});

Deno.test("API-G.5.5B: DELETE is always rejected", () => {
  assert(triggerBody.includes("if tg_op = 'delete' then"));
  const idx = triggerBody.indexOf("if tg_op = 'delete' then");
  const block = triggerBody.slice(idx, idx + 300);
  assert(block.includes("raise exception"));
  assert(block.includes("cannot be deleted"));
});

Deno.test("API-G.5.5B: INSERT is draft-only with NULL lifecycle timestamps", () => {
  const idx = triggerBody.indexOf("if tg_op = 'insert' then");
  assert(idx > 0);
  const block = triggerBody.slice(idx, triggerBody.indexOf("return new;", idx) + 12);
  assert(block.includes("new.lifecycle_status is distinct from 'draft'"));
  assert(
    block.includes("new.effective_at is not null or new.retired_at is not null"),
  );
});

Deno.test("API-G.5.5B: identity and parent identity are permanently immutable", () => {
  assert(triggerBody.includes("new.id is distinct from old.id"));
  assert(
    triggerBody.includes("new.api_client_id is distinct from old.api_client_id"),
  );
  assert(triggerBody.includes("parent identity is immutable"));
});

Deno.test("API-G.5.5B: trigger locks the authoritative parent client on UPDATE", () => {
  const idx = triggerBody.indexOf("from public.api_clients c");
  assert(idx > 0, "trigger must read the parent client row");
  const block = triggerBody.slice(idx, idx + 200);
  assert(block.includes("where c.id = old.api_client_id"));
  assert(block.includes("for update"));
});

Deno.test("API-G.5.5B: exact permitted lifecycle progression and unknown-state rejection", () => {
  assert(
    triggerBody.includes(
      "(old.lifecycle_status = 'draft'   and new.lifecycle_status in ('draft','active','retired'))",
    ),
  );
  assert(
    triggerBody.includes(
      "(old.lifecycle_status = 'active'  and new.lifecycle_status in ('active','retired'))",
    ),
  );
  assert(
    triggerBody.includes(
      "(old.lifecycle_status = 'retired' and new.lifecycle_status = 'retired')",
    ),
  );
  assert(triggerBody.includes("unknown policy version lifecycle status"));
  // No return-to-draft and no retired -> active edge is expressible.
  assert(!triggerBody.includes("new.lifecycle_status = 'draft')"));
  assert(
    !triggerBody.includes(
      "old.lifecycle_status = 'retired' and new.lifecycle_status = 'active'",
    ),
  );
});

Deno.test("API-G.5.5B: retired rows are fully immutable", () => {
  assert(triggerBody.includes("if old.lifecycle_status = 'retired' then"));
  assert(triggerBody.includes("a retired policy version is immutable"));
});

Deno.test("API-G.5.5B: draft metadata is mutable only while the row stays draft", () => {
  assert(
    triggerBody.includes(
      "if old.lifecycle_status = 'draft' and new.lifecycle_status = 'draft' then",
    ),
  );
  assert(
    triggerBody.includes(
      "if old.lifecycle_status = 'draft' and new.lifecycle_status in ('active','retired') then",
    ),
  );
  const idx = triggerBody.indexOf(
    "if old.lifecycle_status = 'draft' and new.lifecycle_status in ('active','retired') then",
  );
  const block = triggerBody.slice(idx, idx + 1400);
  assert(block.includes("new.version is distinct from old.version"));
  assert(block.includes("new.policy_uri is distinct from old.policy_uri"));
  assert(block.includes("new.policy_digest is distinct from old.policy_digest"));
  assert(block.includes("cannot change during a lifecycle transition"));
});

Deno.test("API-G.5.5B: transition timestamps are exact", () => {
  const idx = triggerBody.indexOf(
    "if old.lifecycle_status = 'draft' and new.lifecycle_status in ('active','retired') then",
  );
  const block = triggerBody.slice(idx, idx + 1400);
  // draft -> active
  assert(block.includes("new.effective_at is null or new.retired_at is not null"));
  // draft -> retired
  assert(block.includes("new.effective_at is not null or new.retired_at is null"));
});

Deno.test("API-G.5.5B: active metadata, digest and historical effective_at are immutable", () => {
  assert(triggerBody.includes("an active policy version is immutable"));
  assert(
    triggerBody.includes("new.effective_at is distinct from old.effective_at"),
  );
  assert(triggerBody.includes("the historical effective timestamp is immutable"));
  assert(
    triggerBody.includes(
      "an active policy version cannot carry a retirement timestamp",
    ),
  );
});

Deno.test("API-G.5.5B: retired_at is set exactly once on active -> retired", () => {
  assert(
    triggerBody.includes("old.retired_at is not null or new.retired_at is null"),
  );
  assert(
    triggerBody.includes("retirement must set the retirement timestamp exactly once"),
  );
});

Deno.test("API-G.5.5B: existing indexes and updated-at trigger are not weakened", () => {
  for (
    const forbidden of [
      "api_client_policy_versions_client_version_uniq",
      "api_client_policy_versions_client_digest_uniq",
      "api_client_policy_versions_one_active_per_client",
      "update_api_client_policy_versions_updated_at",
      "alter table public.api_client_policy_versions",
    ]
  ) {
    assert(
      !executableLower.includes(forbidden),
      `migration must not touch: ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. The three RPCs
// ---------------------------------------------------------------------------

Deno.test("API-G.5.5B: exact RPC signatures exist", () => {
  assert(
    executable.includes(`CREATE OR REPLACE FUNCTION public.api_g_5_5_platform_create_policy_version(
  _api_client_id uuid,
  _version text,
  _policy_uri text,
  _policy_document text
)
RETURNS uuid`),
  );
  assert(
    executable.includes(
      `CREATE OR REPLACE FUNCTION public.api_g_5_5_platform_update_draft_policy_version(
  _policy_version_id uuid,
  _version text,
  _policy_uri text,
  _policy_document text
)
RETURNS uuid`,
    ),
  );
  assert(
    executable.includes(
      `CREATE OR REPLACE FUNCTION public.api_g_5_5_platform_transition_policy_version(
  _policy_version_id uuid,
  _target_lifecycle_status text
)
RETURNS uuid`,
    ),
  );
});

Deno.test("API-G.5.5B: every RPC derives the actor from auth.uid() and requires super admin", () => {
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    assert(body.includes("v_actor uuid := auth.uid()"), `${fn}: actor derivation`);
    assert(
      body.includes("if v_actor is null then"),
      `${fn}: unauthenticated rejection`,
    );
    assert(
      body.includes("if not public.is_platform_super_admin(v_actor) then"),
      `${fn}: super admin gate`,
    );
    assert(body.includes("not authorized"), `${fn}: safe error`);
  }
});

Deno.test("API-G.5.5B: RPC security-definer, search_path and grant posture is exact", () => {
  const sigs: Record<string, string> = {
    api_g_5_5_platform_create_policy_version: "(uuid, text, text, text)",
    api_g_5_5_platform_update_draft_policy_version: "(uuid, text, text, text)",
    api_g_5_5_platform_transition_policy_version: "(uuid, text)",
  };
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    assert(body.includes("language plpgsql"), `${fn}: language`);
    assert(body.includes("security definer"), `${fn}: security definer`);
    assert(
      body.includes("set search_path = public, pg_catalog"),
      `${fn}: search_path`,
    );
    assert(!body.includes("execute format"), `${fn}: no dynamic sql`);
    assert(!body.includes("execute immediate"), `${fn}: no dynamic sql`);

    const sig = `public.${fn}${sigs[fn]}`;
    assert(
      executableLower.includes(`revoke all on function ${sig} from public`),
      `${fn}: revoke public`,
    );
    assert(
      executableLower.includes(`revoke all on function ${sig} from anon`),
      `${fn}: revoke anon`,
    );
    assert(
      executableLower.includes(`grant execute on function ${sig} to authenticated`),
      `${fn}: grant authenticated`,
    );
    assert(
      !executableLower.includes(`grant execute on function ${sig} to anon`),
      `${fn}: must not grant anon`,
    );
    assert(
      !executableLower.includes(`grant execute on function ${sig} to public`),
      `${fn}: must not grant public`,
    );
  }
});

Deno.test("API-G.5.5B: no caller-supplied actor, scope or digest parameter exists", () => {
  for (
    const forbidden of [
      "_actor",
      "_actor_user_id",
      "_user_id",
      "_tenant_id",
      "_organization_id",
      "_workspace_id",
      "_project_id",
      "_policy_digest",
      "_digest",
      "_created_by",
      "_updated_by",
    ]
  ) {
    const token = new RegExp(`(?<![a-z0-9_])${forbidden}(?![a-z0-9_])`);
    assert(
      !token.test(executableLower),
      `forbidden caller-supplied parameter: ${forbidden}`,
    );

  }
});

Deno.test("API-G.5.5B: version and URI validation preserves exact values", () => {
  for (
    const fn of [
      "api_g_5_5_platform_create_policy_version",
      "api_g_5_5_platform_update_draft_policy_version",
    ]
  ) {
    const body = bodyOf(fn);
    assert(body.includes("_version <> btrim(_version)"), `${fn}: version trimmed`);
    assert(body.includes("length(_version) > 64"), `${fn}: version max length`);
    assert(
      body.includes("_version !~ '^[a-za-z0-9][a-za-z0-9._-]{0,63}$'"),
      `${fn}: version pattern`,
    );
    assert(
      body.includes("_policy_uri <> btrim(_policy_uri)"),
      `${fn}: uri trimmed`,
    );
    assert(
      body.includes("octet_length(_policy_uri) > 2048"),
      `${fn}: uri max bytes`,
    );
    assert(body.includes("_policy_uri !~ '^https://'"), `${fn}: https only`);
    assert(
      body.includes("_policy_uri ~ '[[:space:][:cntrl:]]'"),
      `${fn}: no whitespace/control`,
    );
    // The exact supplied values are stored, never a normalized copy.
    assert(
      !body.includes("btrim(_version)  ,") && !body.includes("lower(_version)"),
      `${fn}: version must be preserved exactly`,
    );
    assert(!body.includes("lower(_policy_uri)"), `${fn}: uri must be preserved exactly`);
  }
});

Deno.test("API-G.5.5B: digest is server-calculated from exact transient document bytes", () => {
  for (
    const fn of [
      "api_g_5_5_platform_create_policy_version",
      "api_g_5_5_platform_update_draft_policy_version",
    ]
  ) {
    const body = bodyOf(fn);
    assert(
      body.includes("_policy_document is null"),
      `${fn}: document required`,
    );
    assert(
      body.includes("length(btrim(_policy_document)) = 0"),
      `${fn}: document non-whitespace`,
    );
    assert(
      body.includes("octet_length(_policy_document) > 1048576"),
      `${fn}: document size bound`,
    );
    assert(
      body.includes(
        "extensions.digest(convert_to(_policy_document, 'utf8'), 'sha256')",
      ),
      `${fn}: server digest`,
    );
    assert(body.includes("encode("), `${fn}: hex encoding`);
    // The document is never trimmed/normalized before hashing.
    assert(
      !body.includes("digest(convert_to(btrim(_policy_document)"),
      `${fn}: document must be hashed untrimmed`,
    );
  }
});

Deno.test("API-G.5.5B: the policy document is never persisted, audited, logged or returned", () => {
  // No column, audit value or return path carries the document.
  assert(!executableLower.includes("policy_document ="));
  assert(!executableLower.includes("raise notice"));
  assert(!executableLower.includes("raise log"));
  assert(!executableLower.includes("return _policy_document"));
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    const insertAudit = body.indexOf("insert into public.api_platform_admin_audit_events");
    if (insertAudit >= 0) {
      const block = body.slice(insertAudit);
      assert(
        !block.includes("_policy_document"),
        `${fn}: audit must not carry the document`,
      );
      assert(
        !block.includes("_policy_uri") && !block.includes("v_digest"),
        `${fn}: audit must not carry uri or digest`,
      );
    }
  }
  // Only the three metadata columns and lifecycle fields are written.
  const createBody = bodyOf("api_g_5_5_platform_create_policy_version");
  const insertIdx = createBody.indexOf(
    "insert into public.api_client_policy_versions",
  );
  assert(insertIdx > 0);
  const insertBlock = createBody.slice(insertIdx, insertIdx + 420);
  assert(!insertBlock.includes("_policy_document"));
});

Deno.test("API-G.5.5B: create locks the parent client first and blocks retired parents", () => {
  const body = bodyOf("api_g_5_5_platform_create_policy_version");
  const idx = body.indexOf("from public.api_clients c");
  assert(idx > 0);
  assert(body.slice(idx, idx + 200).includes("for update"));
  assert(body.includes("api client is not available"));
  assert(
    body.includes("a retired api client cannot receive new policy metadata"),
  );
  assert(body.includes("'draft', null, null, v_actor, v_actor"));
});

Deno.test("API-G.5.5B: policy-by-ID commands revalidate the locked parent and abort with 40001", () => {
  for (
    const fn of [
      "api_g_5_5_platform_update_draft_policy_version",
      "api_g_5_5_platform_transition_policy_version",
    ]
  ) {
    const body = bodyOf(fn);
    const candidateIdx = body.indexOf("into v_candidate_client_id");
    const parentLockIdx = body.indexOf("where c.id = v_candidate_client_id");
    const policyLockIdx = body.indexOf("into v_locked_client_id");
    const driftIdx = body.indexOf(
      "if v_locked_client_id is distinct from v_candidate_client_id then",
    );
    assert(candidateIdx > 0, `${fn}: candidate parent discovery`);
    assert(parentLockIdx > candidateIdx, `${fn}: parent-first lock ordering`);
    assert(policyLockIdx > parentLockIdx, `${fn}: policy row locked after parent`);
    assert(driftIdx > policyLockIdx, `${fn}: drift check after locks`);
    const driftBlock = body.slice(driftIdx, driftIdx + 220);
    assert(driftBlock.includes("errcode = '40001'"), `${fn}: retryable sqlstate`);

    // Drift aborts before any mutation and before any audit insert.
    const firstMutation = Math.min(
      ...[
        body.indexOf("update public.api_client_policy_versions"),
        body.indexOf("insert into public.api_platform_admin_audit_events"),
      ].filter((i) => i > 0),
    );
    assert(driftIdx < firstMutation, `${fn}: drift check precedes mutation/audit`);
  }
});

Deno.test("API-G.5.5B: draft update is draft-only and preserves identity", () => {
  const body = bodyOf("api_g_5_5_platform_update_draft_policy_version");
  assert(body.includes("if v_policy_lifecycle <> 'draft' then"));
  assert(body.includes("policy metadata may only be updated while draft"));
  const upd = body.indexOf("update public.api_client_policy_versions");
  const block = body.slice(upd, body.indexOf("where id = _policy_version_id", upd));
  assert(!block.includes("api_client_id ="), "parent identity must not be written");
  assert(!block.includes("id ="), "identity must not be written");
  assert(block.includes("updated_by = v_actor"));
  assert(body.includes("'policy_update', 'draft', 'draft'"));
});

Deno.test("API-G.5.5B: transition graph and no-op rejection are exact", () => {
  const body = bodyOf("api_g_5_5_platform_transition_policy_version");
  assert(body.includes("v_target not in ('draft','active','retired')"));
  assert(body.includes("unknown lifecycle status"));
  assert(body.includes("if v_previous = v_target then"));
  assert(
    body.includes("(v_previous = 'draft'  and v_target in ('active','retired'))"),
  );
  assert(body.includes("(v_previous = 'active' and v_target = 'retired')"));
  assert(!body.includes("v_target = 'draft')"), "no return-to-draft edge");
  assert(
    !body.includes("v_previous = 'retired'"),
    "no transition out of retired",
  );
});

Deno.test("API-G.5.5B: transition timestamps are exact in the command", () => {
  const body = bodyOf("api_g_5_5_platform_transition_policy_version");
  assert(
    body.includes("set lifecycle_status = 'active',\n           effective_at = now(),\n           retired_at = null,"),
  );
  // Retirement never rewrites effective_at.
  const retireIdx = body.lastIndexOf("set lifecycle_status = 'retired',");
  assert(retireIdx > 0);
  const retireBlock = body.slice(retireIdx, retireIdx + 200);
  assert(retireBlock.includes("retired_at = now()"));
  assert(!retireBlock.includes("effective_at ="));
});

Deno.test("API-G.5.5B: activation atomically supersedes the prior active policy", () => {
  const body = bodyOf("api_g_5_5_platform_transition_policy_version");
  assert(body.includes("a retired api client cannot activate a policy version"));
  const sel = body.indexOf("into v_superseded_id");
  assert(sel > 0, "prior active policy must be discovered");
  const selBlock = body.slice(sel, sel + 400);
  assert(selBlock.includes("p.lifecycle_status = 'active'"));
  assert(selBlock.includes("p.id <> _policy_version_id"));
  assert(selBlock.includes("for update"), "prior active policy must be locked");

  const supersedeIdx = body.indexOf("if v_superseded_id is not null then");
  assert(supersedeIdx > sel);
  const supersedeBlock = body.slice(supersedeIdx, supersedeIdx + 900);
  const supersedeUpdateIdx = supersedeBlock.indexOf(
    "update public.api_client_policy_versions",
  );
  const supersedeUpdate = supersedeBlock.slice(
    supersedeUpdateIdx,
    supersedeBlock.indexOf("where id = v_superseded_id"),
  );
  assert(supersedeUpdate.includes("set lifecycle_status = 'retired'"));
  assert(supersedeUpdate.includes("retired_at = now()"));
  assert(supersedeUpdate.includes("updated_by = v_actor"));
  assert(!supersedeUpdate.includes("effective_at ="), "historical effective_at kept");
  assert(
    supersedeBlock.includes("'policy_transition', 'active', 'retired'"),

    "superseded policy audit event",
  );

  // Two audit inserts exist: superseded row and target row.
  const auditInserts =
    body.match(/insert into public\.api_platform_admin_audit_events/g) ?? [];
  assert(auditInserts.length === 2, "two audit events when two rows change");
  assert(
    body.includes("'policy_transition', v_previous, v_target"),
    "target policy audit event",
  );
});

Deno.test("API-G.5.5B: every command writes its audit event in the same transaction", () => {
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    assert(
      body.includes("insert into public.api_platform_admin_audit_events"),
      `${fn}: audit event`,
    );
    assert(!body.includes("commit"), `${fn}: no explicit commit`);
    assert(!body.includes("rollback"), `${fn}: no explicit rollback`);
    assert(!body.includes("exception when"), `${fn}: no swallowed exception`);
  }
});

Deno.test("API-G.5.5B: commands use ordinary DML and return only a uuid", () => {
  for (const fn of RPCS) {
    const body = bodyOf(fn);
    assert(body.includes("returns uuid"), `${fn}: returns uuid`);
    assert(!body.includes("returns table"), `${fn}: no table return`);
    assert(!body.includes("returns jsonb"), `${fn}: no jsonb return`);
    assert(!body.includes("alter table"), `${fn}: no ddl`);
    assert(!body.includes("set session"), `${fn}: no session mutation`);
    assert(!body.includes("set local"), `${fn}: no local guc mutation`);
  }
  assert(
    bodyOf("api_g_5_5_platform_create_policy_version").includes(
      "return v_policy_version_id;",
    ),
  );
});

// ---------------------------------------------------------------------------
// 4. Acknowledgement and runtime contract untouched
// ---------------------------------------------------------------------------

Deno.test("API-G.5.5B: no acknowledgement row is rewritten or deleted", () => {
  assert(
    !executableLower.includes("update public.api_user_policy_acknowledgements"),
  );
  assert(
    !executableLower.includes("delete from public.api_user_policy_acknowledgements"),
  );
  assert(
    !executableLower.includes("insert into public.api_user_policy_acknowledgements"),
  );
  assert(!executableLower.includes("revoked_at"));
});

Deno.test("API-G.5.5B: no delete command or physical-delete path exists", () => {
  assert(!executableLower.includes("delete from public.api_client_policy_versions"));
  assert(!/create or replace function public\.\w*delete\w*/.test(executableLower));
});

Deno.test("API-G.5.5B: no out-of-scope substrate is touched", () => {
  for (
    const forbidden of [
      "api_client_supported_capabilities",
      "api_capability_catalogue",
      "api_capability_grants",
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_consent_audit_events",
      "api_rate_limit_profiles",
      "api_rate_limit_buckets",
      "api_idempotency_registry",
      "api_client_oauth_redirect_uris",
      "tenant_integrations",
      "tenant_secret_refs",
      "activity_events",
      "pmg_command_audit",
      "api_e_private",
      "astra",
      "client_secret",
      "access_token",
      "refresh_token",
      "authorization_code",
      "create extension",
      "http_post",
      "pg_cron",
      "net.http",
    ]
  ) {
    assert(
      !executableLower.includes(forbidden),
      `out-of-scope reference: ${forbidden}`,
    );
  }
});

Deno.test("API-G.5.5B: no seed or backfill row is written", () => {
  const inserts = executableLower.match(/insert into public\.\w+/g) ?? [];
  for (const stmt of inserts) {
    assert(
      stmt === "insert into public.api_client_policy_versions" ||
        stmt === "insert into public.api_platform_admin_audit_events",
      `unexpected insert target: ${stmt}`,
    );
  }
  // All inserts live inside function bodies, not at migration top level.
  const topLevel = executable
    .split(/\n\$\$;/)
    .filter((_, i, arr) => i === arr.length - 1)
    .join("");
  assert(!topLevel.toLowerCase().includes("insert into"));
});

// ---------------------------------------------------------------------------
// 5. Prior migrations remain unchanged
// ---------------------------------------------------------------------------

Deno.test("API-G.5.5B: prior accepted migrations are untouched by this step", () => {
  for (const marker of PRIOR_MARKERS) {
    const owners = allMigrations.filter((m) => m.sql.includes(marker));
    assert(owners.length > 0, `prior migration marker missing: ${marker}`);
    for (const owner of owners) {
      assert(
        owner.name !== migration.name,
        `API-G.5.5B must not reuse the migration owning: ${marker}`,
      );
    }
  }
});

Deno.test("API-G.5.5B: the migration carries exactly the frozen marker", () => {
  assert(sql.includes(MARKER));
  assert(!sql.includes("API-G.5.6"));
  assert(!sql.includes("supported-capability administration"));
});
