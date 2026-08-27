// API-HR.18 — New public Table Read-Classification Guard.
//
// Repository guard ONLY. It performs no network access, no database access and
// no runtime authorization change. It statically inspects CHANGED Supabase
// migrations between an explicit Git base and Git head, detects genuinely new
// public BASE tables, and fails unless each such table declares exactly one
// approved API-HR read classification AND satisfies the minimum static
// read-boundary posture required by that classification.
//
// Hard rules:
//   - Only files under supabase/migrations/*.sql are inspected.
//   - New table = (public base tables created at head) minus
//     (public base tables created at base) FOR THE SAME migration file.
//     Migration timestamps are NEVER used as the security boundary.
//   - Ambiguous top-level public CREATE TABLE fails closed.
//   - explicitly_public requires central preapproval; the allowlist is empty.
//   - A classification comment never grants access; it only declares intent.
//
// Exit codes: 0 pass, 1 violations, 2 guard execution blocked.

export const GUARD_ID = "api_hr_18_new_table_read_classification_guard_v1";

export const CLASSIFICATIONS = [
  "pm_business_data",
  "identity_membership_control",
  "server_only",
  "explicitly_public",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const ORDINARY_POSTURES = [
  "intentional_direct_rls",
  "protected_rpc_only",
  "no_authenticated_read_path",
  "explicitly_public",
] as const;
export type OrdinaryPosture = (typeof ORDINARY_POSTURES)[number];

export const ALLOWED_POSTURES: Readonly<
  Record<Classification, readonly OrdinaryPosture[]>
> = {
  pm_business_data: [
    "intentional_direct_rls",
    "protected_rpc_only",
    "no_authenticated_read_path",
  ],
  identity_membership_control: [
    "intentional_direct_rls",
    "protected_rpc_only",
    "no_authenticated_read_path",
  ],
  server_only: ["no_authenticated_read_path"],
  explicitly_public: ["explicitly_public"],
};

/**
 * Centrally preapproved explicitly-public relations.
 * API-HR.18 intentionally ships this EMPTY. Adding a table here is a separate
 * governance step.
 */
export const APPROVED_EXPLICITLY_PUBLIC_TABLES: readonly string[] = [];

export const MIGRATION_GLOB_PREFIX = "supabase/migrations/";

export type ReasonCode =
  | "classification_marker_missing"
  | "classification_marker_duplicate"
  | "classification_marker_malformed"
  | "classification_marker_orphaned"
  | "classification_unknown"
  | "ordinary_posture_unknown"
  | "classification_posture_mismatch"
  | "new_public_table_rls_not_enabled"
  | "oauth_read_containment_missing"
  | "oauth_read_containment_malformed"
  | "server_only_client_read_grant"
  | "server_only_client_select_policy"
  | "server_only_client_revoke_missing"
  | "explicit_public_not_preapproved"
  | "unrecognized_public_create_table";

export interface Violation {
  migration: string;
  table: string | null;
  class: string | null;
  ordinary: string | null;
  reason: ReasonCode;
}

export interface MigrationInput {
  /** Repository-relative migration path. */
  path: string;
  /** Migration content at head. */
  headSql: string;
  /** Migration content at base, or null when the file is newly added. */
  baseSql: string | null;
}

export interface GuardResult {
  changedMigrations: number;
  newPublicTables: number;
  violations: Violation[];
  /** Accepted (table, class, ordinary) declarations, for safe output. */
  accepted: Array<{
    migration: string;
    table: string;
    class: Classification;
    ordinary: OrdinaryPosture;
  }>;
}

/* ------------------------------------------------------------------ *
 * SQL sanitization
 * ------------------------------------------------------------------ */

/**
 * Blanks out (preserving length) line comments, block comments, single-quoted
 * strings and dollar-quoted bodies so that executable top-level SQL can be
 * scanned without comment/string/function-body false positives.
 */
export function sanitizeSql(sql: string): string {
  const out = sql.split("");
  let i = 0;
  const n = sql.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      let j = sql.indexOf("\n", i);
      if (j === -1) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (two === "/*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql.slice(j, j + 2) === "/*") {
          depth++;
          j += 2;
        } else if (sql.slice(j, j + 2) === "*/") {
          depth--;
          j += 2;
        } else j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (sql[i] === "$") {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const j = end === -1 ? n : end + tag.length;
        blank(i, j);
        i = j;
        continue;
      }
    }
    if (sql[i] === '"') {
      // Quoted identifiers are meaningful; skip over without blanking.
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          j += 2;
          continue;
        }
        if (sql[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}

/* ------------------------------------------------------------------ *
 * CREATE TABLE detection
 * ------------------------------------------------------------------ */

const CREATE_TABLE_RE =
  /\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(;]+)/gi;

function parseQualifiedName(
  raw: string,
): { schema: string | null; table: string } | null {
  const parts: string[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '"') {
      let j = i + 1;
      let val = "";
      while (j < raw.length) {
        if (raw[j] === '"' && raw[j + 1] === '"') {
          val += '"';
          j += 2;
          continue;
        }
        if (raw[j] === '"') {
          j++;
          break;
        }
        val += raw[j];
        j++;
      }
      parts.push(val);
      i = j;
    } else {
      let j = i;
      while (j < raw.length && raw[j] !== ".") j++;
      const val = raw.slice(i, j);
      if (!/^[A-Za-z_][A-Za-z_0-9$]*$/.test(val)) return null;
      parts.push(val.toLowerCase());
      i = j;
    }
    if (i < raw.length) {
      if (raw[i] !== ".") return null;
      i++;
    }
  }
  if (parts.length === 1) return { schema: null, table: parts[0] };
  if (parts.length === 2) return { schema: parts[0], table: parts[1] };
  return null;
}

export interface CreateScan {
  /** Sorted, de-duplicated `public.<table>` names created at top level. */
  tables: string[];
  /** True when a top-level CREATE TABLE could not be resolved safely. */
  unrecognized: boolean;
}

/** Detects public base tables created by top-level SQL in `sql`. */
export function findCreatedPublicTables(sql: string): CreateScan {
  const clean = sanitizeSql(sql);
  const tables = new Set<string>();
  let unrecognized = false;
  CREATE_TABLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CREATE_TABLE_RE.exec(clean)) !== null) {
    const parsed = parseQualifiedName(m[1]);
    if (!parsed) {
      unrecognized = true;
      continue;
    }
    if (parsed.schema === null) {
      // Unqualified table names resolve through search_path and may land in
      // public. Fail closed rather than guess.
      unrecognized = true;
      continue;
    }
    if (parsed.schema !== "public") continue;
    tables.add(`public.${parsed.table}`);
  }
  return { tables: [...tables].sort(), unrecognized };
}

/* ------------------------------------------------------------------ *
 * Classification markers
 * ------------------------------------------------------------------ */

export const MARKER_TOKEN = "API-HR-READ-CLASSIFICATION";

const MARKER_RE = new RegExp(
  `^\\s*--\\s*${MARKER_TOKEN}:\\s*([^\\s|]+)\\s*\\|\\s*class=([^\\s|]+)\\s*\\|\\s*ordinary=([^\\s|]+)\\s*$`,
);

export interface MarkerDeclaration {
  table: string;
  class: string;
  ordinary: string;
}

export interface MarkerScan {
  markers: MarkerDeclaration[];
  malformed: number;
}

export function parseClassificationMarkers(sql: string): MarkerScan {
  const markers: MarkerDeclaration[] = [];
  let malformed = 0;
  for (const line of sql.split("\n")) {
    if (!line.includes(MARKER_TOKEN)) continue;
    const m = MARKER_RE.exec(line);
    if (!m) {
      malformed++;
      continue;
    }
    const table = m[1].toLowerCase();
    if (!/^public\.[a-z_][a-z_0-9$]*$/.test(table)) {
      malformed++;
      continue;
    }
    markers.push({ table, class: m[2], ordinary: m[3] });
  }
  return { markers, malformed };
}

/* ------------------------------------------------------------------ *
 * Structural posture checks
 * ------------------------------------------------------------------ */

function identPattern(table: string): string {
  const bare = table.slice("public.".length);
  return `(?:"?public"?\\s*\\.\\s*"?${bare}"?)`;
}

export function hasRlsEnabled(sql: string, table: string): boolean {
  const clean = sanitizeSql(sql);
  const re = new RegExp(
    `\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${identPattern(table)}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    "i",
  );
  return re.test(clean);
}

interface PolicyStatement {
  name: string;
  body: string;
}

function policyStatements(sql: string, table: string): PolicyStatement[] {
  const clean = sanitizeSql(sql);
  const re = new RegExp(
    `\\bCREATE\\s+POLICY\\s+("?[A-Za-z_][A-Za-z_0-9$]*"?)\\s+ON\\s+${identPattern(table)}\\b`,
    "gi",
  );
  const out: PolicyStatement[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const end = clean.indexOf(";", m.index);
    const body = clean.slice(m.index, end === -1 ? clean.length : end);
    out.push({ name: m[1].replace(/"/g, "").toLowerCase(), body });
  }
  return out;
}

const CANONICAL_PREDICATE =
  "api_e_private.jwt_client_id() is null or api_e_private.assert_trusted_context()";

export type ContainmentResult = "ok" | "missing" | "malformed";

/** Verifies the canonical restrictive external-OAuth read containment policy. */
export function checkOauthContainment(
  sql: string,
  table: string,
): ContainmentResult {
  const candidates = policyStatements(sql, table).filter(
    (p) => p.name === "api_e_oauth_read_containment",
  );
  if (candidates.length === 0) return "missing";
  for (const p of candidates) {
    const body = p.body;
    if (!/\bAS\s+RESTRICTIVE\b/i.test(body)) continue;
    if (!/\bFOR\s+SELECT\b/i.test(body)) continue;
    if (!/\bTO\s+authenticated\b/i.test(body)) continue;
    if (/\bTO\s+[^;]*\b(anon|public|service_role)\b/i.test(body)) continue;
    const using = /\bUSING\s*\(([\s\S]*)$/i.exec(body);
    if (!using) continue;
    const normalized = using[1]
      .replace(/[()]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const expected = CANONICAL_PREDICATE
      .replace(/[()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized !== expected) continue;
    return "ok";
  }
  return "malformed";
}

interface GrantRevoke {
  privileges: string;
  roles: string;
}

function grantOrRevokeStatements(
  sql: string,
  table: string,
  keyword: "GRANT" | "REVOKE",
): GrantRevoke[] {
  const clean = sanitizeSql(sql);
  const re = new RegExp(
    `\\b${keyword}\\b([\\s\\S]*?)\\bON\\s+(?:TABLE\\s+)?${identPattern(table)}\\b([\\s\\S]*?);`,
    "gi",
  );
  const out: GrantRevoke[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    out.push({ privileges: m[1], roles: m[2] });
  }
  return out;
}

function mentionsRead(privileges: string): boolean {
  return /\b(SELECT|ALL)\b/i.test(privileges);
}

export function serverOnlyViolations(
  sql: string,
  table: string,
): ReasonCode[] {
  const reasons: ReasonCode[] = [];

  for (const g of grantOrRevokeStatements(sql, table, "GRANT")) {
    if (!mentionsRead(g.privileges)) continue;
    if (/\b(anon|authenticated|public)\b/i.test(g.roles)) {
      reasons.push("server_only_client_read_grant");
      break;
    }
  }

  for (const p of policyStatements(sql, table)) {
    if (/\bAS\s+RESTRICTIVE\b/i.test(p.body)) continue;
    if (!/\bFOR\s+(SELECT|ALL)\b/i.test(p.body) && /\bFOR\s+/i.test(p.body)) {
      continue;
    }
    const to = /\bTO\s+([A-Za-z_,\s"]+)/i.exec(p.body);
    if (!to || /\b(anon|authenticated|public)\b/i.test(to[1])) {
      reasons.push("server_only_client_select_policy");
      break;
    }
  }

  const revokes = grantOrRevokeStatements(sql, table, "REVOKE").filter((r) =>
    mentionsRead(r.privileges)
  );
  const roleText = revokes.map((r) => r.roles).join(" ");
  const coversPublic = /\bPUBLIC\b/i.test(roleText);
  const coversAnon = coversPublic || /\banon\b/i.test(roleText);
  const coversAuthenticated = coversPublic ||
    /\bauthenticated\b/i.test(roleText);
  if (!coversAnon || !coversAuthenticated) {
    reasons.push("server_only_client_revoke_missing");
  }

  return reasons;
}

/* ------------------------------------------------------------------ *
 * Migration evaluation
 * ------------------------------------------------------------------ */

export function evaluateMigration(input: MigrationInput): {
  newTables: string[];
  violations: Violation[];
  accepted: GuardResult["accepted"];
} {
  const path = input.path;
  const violations: Violation[] = [];
  const accepted: GuardResult["accepted"] = [];

  const head = findCreatedPublicTables(input.headSql);
  const base = input.baseSql === null
    ? { tables: [], unrecognized: false }
    : findCreatedPublicTables(input.baseSql);

  if (head.unrecognized) {
    violations.push({
      migration: path,
      table: null,
      class: null,
      ordinary: null,
      reason: "unrecognized_public_create_table",
    });
  }

  const baseSet = new Set(base.tables);
  const newTables = head.tables.filter((t) => !baseSet.has(t));
  if (newTables.length === 0) {
    return { newTables, violations, accepted };
  }

  const scan = parseClassificationMarkers(input.headSql);
  for (let i = 0; i < scan.malformed; i++) {
    violations.push({
      migration: path,
      table: null,
      class: null,
      ordinary: null,
      reason: "classification_marker_malformed",
    });
  }

  const newSet = new Set(newTables);
  const byTable = new Map<string, MarkerDeclaration[]>();
  for (const marker of scan.markers) {
    if (!newSet.has(marker.table)) {
      violations.push({
        migration: path,
        table: marker.table,
        class: marker.class,
        ordinary: marker.ordinary,
        reason: "classification_marker_orphaned",
      });
      continue;
    }
    const list = byTable.get(marker.table) ?? [];
    list.push(marker);
    byTable.set(marker.table, list);
  }

  for (const table of newTables) {
    const declared = byTable.get(table) ?? [];
    if (declared.length === 0) {
      violations.push({
        migration: path,
        table,
        class: null,
        ordinary: null,
        reason: "classification_marker_missing",
      });
      continue;
    }
    if (declared.length > 1) {
      violations.push({
        migration: path,
        table,
        class: null,
        ordinary: null,
        reason: "classification_marker_duplicate",
      });
      continue;
    }
    const marker = declared[0];
    const ctx = {
      migration: path,
      table,
      class: marker.class,
      ordinary: marker.ordinary,
    };

    if (!(CLASSIFICATIONS as readonly string[]).includes(marker.class)) {
      violations.push({ ...ctx, reason: "classification_unknown" });
      continue;
    }
    if (!(ORDINARY_POSTURES as readonly string[]).includes(marker.ordinary)) {
      violations.push({ ...ctx, reason: "ordinary_posture_unknown" });
      continue;
    }
    const cls = marker.class as Classification;
    const posture = marker.ordinary as OrdinaryPosture;
    if (!ALLOWED_POSTURES[cls].includes(posture)) {
      violations.push({ ...ctx, reason: "classification_posture_mismatch" });
      continue;
    }

    let failed = false;

    if (!hasRlsEnabled(input.headSql, table)) {
      violations.push({ ...ctx, reason: "new_public_table_rls_not_enabled" });
      failed = true;
    }

    if (cls === "pm_business_data" || cls === "identity_membership_control") {
      const containment = checkOauthContainment(input.headSql, table);
      if (containment !== "ok") {
        violations.push({
          ...ctx,
          reason: containment === "missing"
            ? "oauth_read_containment_missing"
            : "oauth_read_containment_malformed",
        });
        failed = true;
      }
    }

    if (cls === "server_only") {
      for (const reason of serverOnlyViolations(input.headSql, table)) {
        violations.push({ ...ctx, reason });
        failed = true;
      }
    }

    if (cls === "explicitly_public") {
      if (!APPROVED_EXPLICITLY_PUBLIC_TABLES.includes(table)) {
        violations.push({ ...ctx, reason: "explicit_public_not_preapproved" });
        failed = true;
      }
    }

    if (!failed) {
      accepted.push({ migration: path, table, class: cls, ordinary: posture });
    }
  }

  return { newTables, violations, accepted };
}

export function runGuard(migrations: readonly MigrationInput[]): GuardResult {
  const result: GuardResult = {
    changedMigrations: migrations.length,
    newPublicTables: 0,
    violations: [],
    accepted: [],
  };
  for (const migration of migrations) {
    const evaluated = evaluateMigration(migration);
    result.newPublicTables += evaluated.newTables.length;
    result.violations.push(...evaluated.violations);
    result.accepted.push(...evaluated.accepted);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

/** Conservative Git ref validation. Rejects option injection and metacharacters. */
export function isSafeGitRef(ref: string): boolean {
  if (typeof ref !== "string") return false;
  if (ref.length === 0 || ref.length > 200) return false;
  if (ref.startsWith("-")) return false;
  if (!/^[A-Za-z0-9._\/~^@{}-]+$/.test(ref)) return false;
  if (ref.includes("..") && !/^[^.]+(\.\.[^.]+)?$/.test(ref)) return false;
  if (ref.includes("@{")) return false;
  return true;
}

export function isMigrationPath(path: string): boolean {
  return path.startsWith(MIGRATION_GLOB_PREFIX) &&
    path.endsWith(".sql") &&
    !path.slice(MIGRATION_GLOB_PREFIX.length).includes("/");
}

export class GuardBlocked extends Error {}

export function parseCliArgs(
  args: readonly string[],
): { base: string; head: string } {
  let base: string | null = null;
  let head: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base") base = args[++i] ?? null;
    else if (args[i] === "--head") head = args[++i] ?? null;
    else throw new GuardBlocked(`invalid_cli_argument`);
  }
  if (!base || !head) throw new GuardBlocked("missing_base_or_head");
  if (!isSafeGitRef(base) || !isSafeGitRef(head)) {
    throw new GuardBlocked("unsafe_git_ref");
  }
  return { base, head };
}

async function git(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const cmd = new Deno.Command("git", {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  return { ok: out.success, stdout: new TextDecoder().decode(out.stdout) };
}

async function main(): Promise<number> {
  let base: string;
  let head: string;
  try {
    ({ base, head } = parseCliArgs(Deno.args));
  } catch (e) {
    console.error(
      `API-HR.18 BLOCKED: ${e instanceof Error ? e.message : "cli_error"}`,
    );
    console.error(
      "usage: newTableReadClassificationGuard.ts --base <ref> --head <ref>",
    );
    return 2;
  }

  for (const ref of [base, head]) {
    const verified = await git(["rev-parse", "--verify", "--quiet", ref]);
    if (!verified.ok) {
      console.error(`API-HR.18 BLOCKED: invalid_git_ref`);
      return 2;
    }
  }

  const diff = await git(["diff", "--name-only", base, head]);
  if (!diff.ok) {
    console.error("API-HR.18 BLOCKED: git_diff_failed");
    return 2;
  }

  const paths = diff.stdout.split("\n").map((p) => p.trim()).filter(
    isMigrationPath,
  );

  const migrations: MigrationInput[] = [];
  for (const path of paths) {
    const headShow = await git(["show", `${head}:${path}`]);
    if (!headShow.ok) {
      // Deleted at head: nothing can be newly created.
      continue;
    }
    const baseShow = await git(["show", `${base}:${path}`]);
    migrations.push({
      path,
      headSql: headShow.stdout,
      baseSql: baseShow.ok ? baseShow.stdout : null,
    });
  }

  const result = runGuard(migrations);

  console.log(`API-HR.18 guard: ${GUARD_ID}`);
  console.log(`changed migrations: ${result.changedMigrations}`);
  console.log(`new public base tables: ${result.newPublicTables}`);
  for (const a of result.accepted) {
    console.log(
      `PASS ${a.migration} ${a.table} class=${a.class} ordinary=${a.ordinary}`,
    );
  }
  for (const v of result.violations) {
    console.log(
      `FAIL ${v.migration} ${v.table ?? "-"} class=${v.class ?? "-"} ordinary=${
        v.ordinary ?? "-"
      } reason=${v.reason}`,
    );
  }
  console.log(`violations: ${result.violations.length}`);
  return result.violations.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  Deno.exit(await main());
}
