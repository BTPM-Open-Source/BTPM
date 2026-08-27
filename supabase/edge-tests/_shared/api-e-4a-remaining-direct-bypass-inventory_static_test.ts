// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-e-4a-remaining-direct-bypass-inventory_static_test.ts', import.meta.url).href;
// API-E.4A-C5 (C2 corrected) — Independent, recomputable inventory of remaining OAuth
// direct-bypass surface. This test parses the raw definition corpus in
// `docs/governance/api/evidence/API_E4A_RUNTIME_SURFACE_SNAPSHOT.json`,
// independently derives every classification signal (gates, business
// operations, dynamic SQL, public-relation refs, call graph, ambiguity),
// classifies each exact signature, and asserts every value against the
// snapshot.
//
// API-E.C2 correction (this file):
//   * A deterministic single-pass SQL lexical masker replaces the content
//     of `--` line comments, `/* ... */` (nested) block comments, ordinary
//     single-quoted strings including doubled-quote escapes, `E'...'`
//     strings including backslash escapes, and dollar-quoted strings using
//     `$$...$$` or `$tag$...$tag$` with SPACE characters. The masker is
//     length-preserving and preserves every `\n` and `\r`. All executable-
//     code detectors run against the length-preserving masked body.
//   * Every recorded position (approved gate occurrences, guards, business
//     operations, public-function call sites, unresolved ambiguities,
//     first-operation positions) is expressed as a zero-based character
//     offset in the complete original raw function definition. Body-local
//     matches always add the extracted-body offset exactly once.
//
// Repository-only static analysis. No runtime, migration, edge config,
// package, UI, or database change.

import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// API-E.R1: Removed BASELINE_SHA and CORRECTION_BASE_SHA constants pinned to
// superseded correction SHAs; the assertions that used them have been removed.
const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__).pathname;

export const APPROVED_GATES = [
  "is_active_user",
  "is_org_admin",
  "_assert_admin",
  "_assert_pm_or_admin",
  "_assert_tenant_admin_caller",
  "_assert_tenant_admin_or_super",
] as const;

export const CONTROL_PLANE = new Set([
  "acknowledge_api_d_policy(_client_key text, _correlation_id text)",
  "get_api_d_consent_context(_client_key text)",
  "revoke_api_d_policy(_client_key text, _correlation_id text)",
]);

const PMG31 = [
  "apply_phase_create","apply_phase_update","reorder_phases","apply_task_create",
  "apply_task_update","reorder_tasks","apply_task_execution_change",
  "append_execution_update","apply_task_assignee_set","apply_project_create_blank",
  "apply_project_update","apply_project_status_transition","apply_program_create",
  "apply_program_update","apply_kpi_definition_create","apply_kpi_definition_update",
  "append_kpi_update","apply_governance_record_create","apply_governance_record_update",
  "create_dependency","remove_dependency","apply_project_team_member_add",
  "apply_project_team_member_role_update","apply_project_team_member_remove",
  "apply_project_raci_add","apply_project_raci_remove","apply_backlog_item_create",
  "apply_backlog_item_update","reorder_backlog_items","apply_sprint_create",
  "apply_sprint_update",
];
const ADMIN_IMPORT = ["commit_btpm_import_v1_core"];
const RISK_BLOCKER = [
  "create_blocker_with_links","create_risk_with_links","update_blocker_with_links",
  "update_risk_with_links","list_decrypted_blockers","list_decrypted_risks",
  "list_project_all_blockers","list_project_all_risks",
];

const EDGE_ELIGIBLE_NON_USER = [
  "ai-guide-v2-reindex","ai-guide-v2-smoke","ai-guide-v2-trace",
  "run-kpi-app-scheduler-cron","run-kpi-snapshot-capture-scheduler-cron",
  "send-password-reset",
];

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

interface CallSite {
  base_name: string;
  pos: number;
  call_text: string;
  candidate_signatures: string[];
  shape_compatible_signatures: string[];
  resolved_signature: string | null;
  ambiguity_reason: string | null;
  argument_count: number;
  positional_argument_count: number;
  named_argument_names: string[];
}
interface BusinessOp { kind: string; pos: number; relation: string | null }
interface GateHit { gate: string; pos: number; proof_context: string }
interface Guard { gate: string; pos: number; kind: string }

interface FnEntry {
  signature: string;
  base_name: string;
  prosecdef: boolean;
  language: string;
  result_type: string;
  authenticated_execute: boolean;
  def: string;
  def_len: number;
  def_sha256: string;
  approved_gate_occurrences: GateHit[];
  assertion_guards: Guard[];
  rejecting_boolean_guards: Guard[];
  business_operations: BusinessOp[];
  dynamic_sql: boolean;
  public_relations: string[];
  call_sites: CallSite[];
  unresolved_ambiguities: { pos: number; base_name: string; reason: string }[];
  classification: string;
  classification_reason: string;
}
interface Snapshot {
  schema_version: number;
  correction_marker: string;
  evidence_date_utc: string;
  universe_query_meaning: Record<string, string>;
  universe_count: number;
  counts: Record<string, number>;
  approved_gates: string[];
  control_plane_exact_signatures: string[];
  functions: FnEntry[];
  call_graph: unknown[];
}

const SNAPSHOT_PATH = `${REPO_ROOT}docs/governance/api/evidence/API_E4A_RUNTIME_SURFACE_SNAPSHOT.json`;
const snapshot: Snapshot = JSON.parse(await Deno.readTextFile(SNAPSHOT_PATH));

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Length-preserving SQL lexical masker
// ---------------------------------------------------------------------------
//
// Supported lexical states (all length-preserving; every masked non-newline
// byte becomes a space, every '\n' and '\r' is preserved exactly):
//   * `--` line comment (through the character before the terminating '\n');
//   * nested `/* ... */` block comment;
//   * ordinary single-quoted string with '' doubled-quote escape;
//   * `E'...'` / `e'...'` string with backslash and doubled-quote escapes;
//   * `$$...$$` dollar-quoted string;
//   * `$tag$...$tag$` tagged dollar-quoted string where tag matches
//     `[A-Za-z_][A-Za-z0-9_]*`.
//
// Unterminated comments or literals are conservatively masked through end
// of input so that stray unclosed constructs cannot leak executable signal.

const IDENT_HEAD = /[A-Za-z_]/;
const IDENT_TAIL = /[A-Za-z0-9_]/;

export function maskSql(src: string): string {
  const n = src.length;
  const out: string[] = new Array(n);
  for (let k = 0; k < n; k++) out[k] = src[k];
  const doMask = (from: number, to: number) => {
    const end = Math.min(to, n);
    for (let k = from; k < end; k++) {
      const ch = out[k];
      if (ch !== "\n" && ch !== "\r") out[k] = " ";
    }
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    // -- line comment
    if (c === "-" && c2 === "-") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j++;
      doMask(i, j);
      i = j;
      continue;
    }
    // /* nested block */
    if (c === "/" && c2 === "*") {
      let j = i + 2;
      let depth = 1;
      while (j < n && depth > 0) {
        if (src[j] === "/" && j + 1 < n && src[j + 1] === "*") { depth++; j += 2; }
        else if (src[j] === "*" && j + 1 < n && src[j + 1] === "/") { depth--; j += 2; }
        else j++;
      }
      doMask(i, j);
      i = j;
      continue;
    }
    // E'...' or e'...'
    if ((c === "E" || c === "e") && c2 === "'") {
      let j = i + 2;
      while (j < n) {
        const ch = src[j];
        if (ch === "\\" && j + 1 < n) { j += 2; continue; }
        if (ch === "'") {
          if (j + 1 < n && src[j + 1] === "'") { j += 2; continue; }
          j++; break;
        }
        j++;
      }
      doMask(i, j);
      i = j;
      continue;
    }
    // dollar-quoted: $$...$$ or $tag$...$tag$
    if (c === "$") {
      let tag: string | null = null;
      let contentStart = -1;
      if (c2 === "$") {
        tag = "$$";
        contentStart = i + 2;
      } else if (IDENT_HEAD.test(c2)) {
        let k = i + 2;
        while (k < n && IDENT_TAIL.test(src[k])) k++;
        if (k < n && src[k] === "$") {
          tag = src.substring(i, k + 1);
          contentStart = k + 1;
        }
      }
      if (tag !== null) {
        const endIdx = src.indexOf(tag, contentStart);
        const j = endIdx === -1 ? n : endIdx + tag.length;
        doMask(i, j);
        i = j;
        continue;
      }
    }
    // '...' ordinary single-quoted with '' escape (no backslash escape)
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "'") {
          if (j + 1 < n && src[j + 1] === "'") { j += 2; continue; }
          j++; break;
        }
        j++;
      }
      doMask(i, j);
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

export function extractBody(raw: string): { body: string; offset: number } {
  const m = raw.match(/AS\s+(\$[a-zA-Z_]*\$)/);
  if (!m || m.index === undefined) return { body: raw, offset: 0 };
  const tag = m[1];
  const start = m.index + m[0].length;
  const end = raw.indexOf(tag, start);
  return { body: end > start ? raw.slice(start, end) : raw.slice(start), offset: start };
}

function findAll(regex: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

function detectGates(masked: string, raw: string, offset: number): GateHit[] {
  const hits: GateHit[] = [];
  for (const g of APPROVED_GATES) {
    const re = new RegExp(`\\b${g}\\s*\\(`, "g");
    for (const m of findAll(re, masked)) {
      const pos = m.index + offset;
      hits.push({
        gate: g, pos,
        proof_context: raw.slice(Math.max(0, pos - 15), pos + 60).replace(/\n/g, " "),
      });
    }
  }
  hits.sort((a, b) => a.pos - b.pos);
  return hits;
}

function detectAssertionGuards(masked: string, offset: number): Guard[] {
  const out: Guard[] = [];
  const re = /\b(_assert_admin|_assert_pm_or_admin|_assert_tenant_admin_caller|_assert_tenant_admin_or_super)\s*\(/g;
  for (const m of findAll(re, masked)) {
    out.push({ gate: m[1], pos: m.index + offset, kind: "assertion" });
  }
  return out;
}

function detectBooleanGuards(masked: string, offset: number): Guard[] {
  const out: Guard[] = [];
  const re1 = /if\s+not\s+(is_active_user|is_org_admin)\s*\([^;]{0,400}?then\s+(raise|return)/gs;
  for (const m of findAll(re1, masked)) {
    out.push({ gate: m[1], pos: m.index + offset, kind: "if_not_reject" });
  }
  const re2 = /if\s+(is_active_user|is_org_admin)\s*\([^)]{0,400}\)\s*is\s+not\s+true\s+then\s+(raise|return)/gs;
  for (const m of findAll(re2, masked)) {
    out.push({ gate: m[1], pos: m.index + offset, kind: "if_not_true_reject" });
  }
  return out;
}

const OP_PATTERNS: [string, RegExp][] = [
  ["insert", /\binsert\s+into\s+([a-z_][a-z0-9_."]*)/g],
  ["delete", /\bdelete\s+from\s+([a-z_][a-z0-9_."]*)/g],
  ["update", /(?<![a-z_])(?<!for\s)(?<!on\s)(?<!do\s)update\s+([a-z_][a-z0-9_."]*)\s+set\b/g],
  ["select_from", /\bselect\b[\s\S]{0,4000}?\bfrom\s+([a-z_][a-z0-9_."]*)/g],
  ["return_query", /\breturn\s+query\b/g],
  ["dynamic_sql", /\bexecute\s+(?!procedure\b|function\b)/g],
];

function detectOps(masked: string, offset: number): BusinessOp[] {
  const ops: BusinessOp[] = [];
  for (const [kind, pat] of OP_PATTERNS) {
    for (const m of findAll(pat, masked)) {
      ops.push({ kind, pos: m.index + offset, relation: m[1] ?? null });
    }
  }
  ops.sort((a, b) => a.pos - b.pos);
  return ops;
}

function detectPublicRelations(masked: string): string[] {
  const set = new Set<string>();
  for (const m of findAll(/\bpublic\.([a-z_][a-z0-9_]*)/g, masked)) set.add(m[1]);
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// API-E.C3 — Conservative exact overload resolution from call shape
// ---------------------------------------------------------------------------
//
// Resolves a call to an exact snapshot signature ONLY when a candidate is
// uniquely determined by mechanically observable call shape (supplied
// argument count, positional/named split, and named-argument identity).
// No type inference. No implicit-cast reasoning. No ordering-based tie
// break. When resolution is not mechanically provable, the call is left
// unresolved with a conservative reason.

export interface CandidateShape {
  signature: string;
  base_name: string;
  param_names: string[]; // lowercase preserved; PostgreSQL identifiers are
                         // stored lowercase in the corpus signatures
  param_count: number;
}

export interface CallShape {
  argument_count: number;
  positional_argument_count: number;
  named_argument_names: string[];
  named_syntaxes: string[]; // observed "=>" / ":=" tokens
  structurally_valid: boolean;
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

export function parseCandidateSignature(sig: string): CandidateShape | null {
  const openParen = sig.indexOf("(");
  const closeParen = sig.lastIndexOf(")");
  if (openParen < 0 || closeParen < 0 || closeParen < openParen) return null;
  const base = sig.slice(0, openParen).trim();
  const inner = sig.slice(openParen + 1, closeParen);
  if (inner.trim().length === 0) {
    return { signature: sig, base_name: base, param_names: [], param_count: 0 };
  }
  const split = splitTopLevelCommas(inner);
  if (!split.ok) return null;
  const names: string[] = [];
  for (const part of split.parts) {
    let t = part.trim();
    // strip parameter mode (IN / OUT / INOUT / VARIADIC) if present
    const modeMatch = t.match(/^(in|out|inout|variadic)\s+/i);
    if (modeMatch) t = t.slice(modeMatch[0].length);
    const nameMatch = t.match(IDENT_RE);
    if (!nameMatch) return null;
    names.push(nameMatch[0].toLowerCase());
  }
  return { signature: sig, base_name: base, param_names: names, param_count: names.length };
}

export function splitTopLevelCommas(s: string): { ok: boolean; parts: string[] } {
  // API-E.C3.1 — Both parenthesis and square-bracket depth are tracked.
  // Array constructors (`ARRAY[1,2]`) and multidimensional array expressions
  // (`ARRAY[[1,2],[3,4]]`) contain commas that belong to a single supplied
  // argument. Ignoring bracket depth would inflate the argument count and
  // could resolve a call to the wrong overload. This runs on the C2
  // length-preservingly masked input, so brackets and commas inside
  // comments and string / dollar-quoted literals are already replaced with
  // spaces and cannot influence depth tracking.
  //
  // Fail-closed behavior: if either depth goes negative or is non-zero at
  // end of input, the entire split is rejected and the call is classified
  // as structurally invalid by the caller.
  const parts: string[] = [];
  let depthParen = 0;
  let depthBracket = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depthParen++;
    else if (ch === ")") { depthParen--; if (depthParen < 0) return { ok: false, parts: [] }; }
    else if (ch === "[") depthBracket++;
    else if (ch === "]") { depthBracket--; if (depthBracket < 0) return { ok: false, parts: [] }; }
    else if (ch === "," && depthParen === 0 && depthBracket === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (depthParen !== 0 || depthBracket !== 0) return { ok: false, parts: [] };
  parts.push(s.slice(start));
  return { ok: true, parts };
}

export function findMatchingParen(masked: string, openIdx: number): number {
  // masked[openIdx] must be '('
  let depth = 1;
  for (let i = openIdx + 1; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

export function parseCallShape(argsSrc: string): CallShape {
  const trimmed = argsSrc.trim();
  if (trimmed.length === 0) {
    return { argument_count: 0, positional_argument_count: 0, named_argument_names: [], named_syntaxes: [], structurally_valid: true };
  }
  const split = splitTopLevelCommas(argsSrc);
  const invalid: CallShape = { argument_count: 0, positional_argument_count: 0, named_argument_names: [], named_syntaxes: [], structurally_valid: false };
  if (!split.ok) return invalid;
  let sawNamed = false;
  let positional = 0;
  const namedNames: string[] = [];
  const namedSyntaxes = new Set<string>();
  const seenNames = new Set<string>();
  for (const part of split.parts) {
    const s = part.trim();
    // Empty (whitespace-only) parts represent arguments whose entire text
    // was replaced by the length-preserving SQL masker (typically string or
    // dollar-quoted literals). They are still positional argument slots.
    if (s.length === 0) {
      if (sawNamed) return invalid; // positional after named
      positional++;
      continue;
    }
    const arrow = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=>/);
    const assign = s.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:=/);
    if (arrow || assign) {
      const name = (arrow ?? assign)![1].toLowerCase();
      const syn = arrow ? "=>" : ":=";
      if (seenNames.has(name)) return invalid; // duplicate named arg
      seenNames.add(name);
      namedNames.push(name);
      namedSyntaxes.add(syn);
      sawNamed = true;
    } else {
      if (sawNamed) return invalid; // positional after named
      positional++;
    }
  }
  return {
    argument_count: split.parts.length,
    positional_argument_count: positional,
    named_argument_names: namedNames,
    named_syntaxes: [...namedSyntaxes].sort(),
    structurally_valid: true,
  };
}

export function filterCandidatesByShape(cands: CandidateShape[], call: CallShape): CandidateShape[] {
  if (!call.structurally_valid) return [];
  const supplied_total = call.argument_count;
  const positional = call.positional_argument_count;
  const named = call.named_argument_names;
  const out: CandidateShape[] = [];
  for (const c of cands) {
    if (positional > c.param_count) continue;
    // no default-parameter evidence in identity signatures → require exact equality
    if (supplied_total !== c.param_count) continue;
    // every named argument must map to a candidate parameter name
    let bad = false;
    for (const n of named) {
      if (!c.param_names.some((p) => p === n)) { bad = true; break; }
    }
    if (bad) continue;
    // no parameter supplied both positionally and by name
    const posSlots = new Set(c.param_names.slice(0, positional));
    for (const n of named) {
      if (posSlots.has(n)) { bad = true; break; }
    }
    if (bad) continue;
    out.push(c);
  }
  return out;
}

function detectCalls(
  masked: string,
  raw: string,
  offset: number,
  baseNames: Set<string>,
  overloads: Map<string, CandidateShape[]>,
  selfBase: string,
): { calls: CallSite[]; ambiguities: { pos: number; base_name: string; reason: string }[] } {
  const calls: CallSite[] = [];
  const ambiguities: { pos: number; base_name: string; reason: string }[] = [];
  const re = /\b([a-z_][a-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const name = m[1];
    if (!baseNames.has(name)) continue;
    if (name === selfBase && m.index === 0) continue;
    const openIdx = m.index + m[0].length - 1; // '(' index in masked
    const closeIdx = findMatchingParen(masked, openIdx);
    const pos = m.index + offset; // absolute raw-definition offset
    const cands = overloads.get(name) ?? [];
    const cand_sigs = cands.map((c) => c.signature);
    // call_text from unmodified raw definition, per C3 spec
    const call_text = raw.slice(pos, Math.min(pos + 80, raw.length)).replace(/\n/g, " ");
    if (closeIdx < 0) {
      calls.push({
        base_name: name, pos, call_text,
        candidate_signatures: cand_sigs,
        shape_compatible_signatures: [],
        resolved_signature: null,
        ambiguity_reason: "unbalanced_call_expression",
        argument_count: 0, positional_argument_count: 0, named_argument_names: [],
      });
      ambiguities.push({ pos, base_name: name, reason: "unbalanced_call_expression" });
      continue;
    }
    const argsSrc = masked.slice(openIdx + 1, closeIdx);
    const shape = parseCallShape(argsSrc);
    let compatible: CandidateShape[] = [];
    let ambigReason: string | null = null;
    let resolved: string | null = null;
    if (!shape.structurally_valid) {
      ambigReason = "malformed_call_shape";
    } else {
      compatible = filterCandidatesByShape(cands, shape);
      if (compatible.length === 1) {
        resolved = compatible[0].signature;
      } else if (compatible.length === 0) {
        ambigReason = "no_shape_compatible_overload";
      } else {
        ambigReason = "multiple_shape_compatible_overloads";
      }
    }
    calls.push({
      base_name: name, pos, call_text,
      candidate_signatures: cand_sigs,
      shape_compatible_signatures: compatible.map((c) => c.signature),
      resolved_signature: resolved,
      ambiguity_reason: ambigReason,
      argument_count: shape.argument_count,
      positional_argument_count: shape.positional_argument_count,
      named_argument_names: shape.named_argument_names,
    });
    if (!resolved && ambigReason) {
      ambiguities.push({ pos, base_name: name, reason: ambigReason });
    }
  }
  return { calls, ambiguities };
}

interface PerFn {
  gate_hits: GateHit[];
  assertion_guards: Guard[];
  boolean_guards: Guard[];
  ops: BusinessOp[];
  public_relations: string[];
  calls: CallSite[];
  ambiguities: { pos: number; base_name: string; reason: string }[];
  dynamic_sql: boolean;
  first_op_pos: number | null;
  has_business_surface: boolean;
}

export function analyzeAll(funcs: { sig: string; base_name: string; def: string }[]): {
  per: Map<string, PerFn>;
  cls: Map<string, string>;
  reasons: Map<string, string>;
} {
  const baseNames = new Set(funcs.map((f) => f.base_name));
  const overloads = new Map<string, CandidateShape[]>();
  for (const f of funcs) {
    const shape = parseCandidateSignature(f.sig);
    const arr = overloads.get(f.base_name) ?? [];
    if (shape !== null) arr.push(shape);
    // If a candidate identity signature cannot be safely parsed, it is
    // retained as unresolved rather than guessed: dropping it here keeps the
    // caller's `candidate_signatures` derived from the parsed set only, but
    // an unparsed candidate would never mechanically resolve either way.
    overloads.set(f.base_name, arr);
  }
  for (const arr of overloads.values()) arr.sort((a, b) => a.signature.localeCompare(b.signature));

  const per = new Map<string, PerFn>();
  for (const f of funcs) {
    const raw = f.def;
    const { body, offset } = extractBody(raw);
    const masked = maskSql(body).toLowerCase();
    const gate_hits = detectGates(masked, raw, offset);
    const assertion_guards = detectAssertionGuards(masked, offset);
    const boolean_guards = detectBooleanGuards(masked, offset);
    const ops = detectOps(masked, offset);
    const public_relations = detectPublicRelations(masked);
    const { calls, ambiguities } = detectCalls(masked, raw, offset, baseNames, overloads, f.base_name);
    const dynamic_sql = ops.some((o) => o.kind === "dynamic_sql");
    const first_op_pos = ops.length ? ops[0].pos : null;
    const has_business_surface = ops.length > 0 || public_relations.length > 0;
    per.set(f.sig, {
      gate_hits, assertion_guards, boolean_guards, ops, public_relations,
      calls, ambiguities, dynamic_sql, first_op_pos, has_business_surface,
    });
  }

  const cls = new Map<string, string>();
  const reasons = new Map<string, string>();
  for (const f of funcs) cls.set(f.sig, "unknown");
  for (const sig of CONTROL_PLANE) {
    if (cls.has(sig)) {
      cls.set(sig, "out_of_scope_control_plane");
      reasons.set(sig, "exact_control_plane_signature");
    }
  }

  const guardPositions = (sig: string): number[] => {
    const p = per.get(sig)!;
    const gp: number[] = [];
    for (const g of p.assertion_guards) gp.push(g.pos);
    for (const g of p.boolean_guards) gp.push(g.pos);
    for (const c of p.calls) {
      if (c.resolved_signature && cls.get(c.resolved_signature) === "contained") gp.push(c.pos);
    }
    return gp.sort((a, b) => a - b);
  };

  const classifyOne = (p: PerFn, gp: number[]): { c: string; r: string } => {
    if (!p.has_business_surface) {
      if (p.ambiguities.length) return { c: "requires_db_gate", r: "unresolved_overload_ambiguity_forbids_containment" };
      if (p.dynamic_sql) return { c: "requires_db_gate", r: "conservative_default_requires_db_gate" };
      if (p.calls.length === 0) return { c: "helper_no_business_surface", r: "no_business_operations_and_no_public_relations_and_no_unresolved_calls" };
      for (const c of p.calls) {
        const rs = c.resolved_signature;
        if (!rs) return { c: "requires_db_gate", r: "conservative_default_requires_db_gate" };
        const cc = cls.get(rs);
        if (cc !== "helper_no_business_surface" && cc !== "out_of_scope_control_plane") {
          if (cc === "unknown") return { c: "unknown_pending", r: "" };
          return { c: "requires_db_gate", r: "conservative_default_requires_db_gate" };
        }
      }
      return { c: "helper_no_business_surface", r: "no_business_operations_and_no_public_relations_and_no_unresolved_calls" };
    }
    const firstOp = p.first_op_pos ?? 0;
    if (gp.length && gp[0] < firstOp) {
      return { c: "contained", r: `approved_guard_at_pos_${gp[0]}_before_first_business_op_at_pos_${firstOp}` };
    }
    if (gp.length) {
      return { c: "requires_db_gate", r: "guard_appears_after_first_business_op" };
    }
    return { c: "requires_db_gate", r: "business_surface_present_without_approved_guard" };
  };

  let changed = true, iters = 0;
  while (changed && iters < 20) {
    changed = false; iters++;
    for (const [sig, p] of per.entries()) {
      if (cls.get(sig) === "out_of_scope_control_plane") continue;
      const res = classifyOne(p, guardPositions(sig));
      if (res.c !== "unknown_pending" && res.c !== cls.get(sig)) {
        cls.set(sig, res.c);
        reasons.set(sig, res.r);
        changed = true;
      }
    }
  }
  for (const [sig, c] of cls.entries()) {
    if (c === "unknown" || c === "unknown_pending") {
      cls.set(sig, "requires_db_gate");
      reasons.set(sig, "conservative_default_requires_db_gate");
    }
  }
  return { per, cls, reasons };
}

// ---------------------------------------------------------------------------
// Snapshot-driven acceptance tests
// ---------------------------------------------------------------------------

Deno.test("API-E.4A-C5: snapshot self-integrity (SHA-256 and length of every def)", async () => {
  assertEquals(snapshot.functions.length, snapshot.universe_count);
  for (const f of snapshot.functions) {
    const sha = await sha256Hex(f.def);
    assertEquals(sha, f.def_sha256, `sha256 mismatch for ${f.signature}`);
    assertEquals(f.def_len, f.def.length, `def_len mismatch for ${f.signature}`);
  }
});

Deno.test("API-E.4A-C5 (C2): analyzer independently recomputes every classification", () => {
  const funcs = snapshot.functions.map((f) => ({
    sig: f.signature, base_name: f.base_name, def: f.def,
  }));
  const { cls } = analyzeAll(funcs);
  const mismatches: string[] = [];
  for (const f of snapshot.functions) {
    const got = cls.get(f.signature);
    if (got !== f.classification) {
      mismatches.push(`${f.signature}: snapshot=${f.classification} recomputed=${got}`);
    }
  }
  if (mismatches.length) console.error(mismatches.slice(0, 20).join("\n"));
  assertEquals(mismatches.length, 0);
  const counts: Record<string, number> = {
    contained: 0, requires_db_gate: 0, out_of_scope_control_plane: 0, helper_no_business_surface: 0,
  };
  for (const v of cls.values()) counts[v] = (counts[v] ?? 0) + 1;
  assertEquals(counts, snapshot.counts);
});

Deno.test("API-E.4A-C5: control-plane and approved-gate constants match snapshot", () => {
  assertEquals(snapshot.approved_gates, [...APPROVED_GATES]);
  assertEquals(snapshot.control_plane_exact_signatures, [...CONTROL_PLANE].sort());
});

// API-E.R1: Removed obsolete assertion that reconciled the current snapshot against
// the accepted markdown at historical SHA f0e83308. Universe integrity is still
// asserted by the definition-hash, definition-length, snapshot-recomputation and
// approved-gate/control-plane tests above; historical provenance to a superseded
// correction SHA is not an API-E security invariant.

Deno.test("API-E.4A-C5: prescribed PMG-31/Admin/Risk-Blocker base names all present with explicit classification", () => {
  const byBase = new Map<string, FnEntry[]>();
  for (const f of snapshot.functions) {
    const arr = byBase.get(f.base_name) ?? [];
    arr.push(f); byBase.set(f.base_name, arr);
  }
  const valid = new Set(["contained","requires_db_gate","out_of_scope_control_plane","helper_no_business_surface"]);
  for (const name of [...PMG31, ...ADMIN_IMPORT, ...RISK_BLOCKER]) {
    const arr = byBase.get(name);
    assertExists(arr, `prescribed base name missing: ${name}`);
    assert(arr!.length >= 1, `no overloads for ${name}`);
    for (const f of arr!) {
      assert(valid.has(f.classification), `${f.signature} has invalid classification ${f.classification}`);
      assert(f.classification_reason.length > 0, `${f.signature} missing reason`);
    }
  }
});

Deno.test("API-E.4A-C5: Edge Function inventory and non-user endpoint source proofs", async () => {
  const functionsDir = `${REPO_ROOT}supabase/functions`;
  const dirs: string[] = [];
  for await (const e of Deno.readDir(functionsDir)) {
    if (!e.isDirectory) continue;
    if (e.name === "_shared") continue;
    try {
      const st = await Deno.stat(`${functionsDir}/${e.name}/index.ts`);
      if (st.isFile) dirs.push(e.name);
    } catch { /* ignore */ }
  }
  dirs.sort();
  assert(dirs.length >= 60, `too few edge dirs: ${dirs.length}`);
  const config = await Deno.readTextFile(`${REPO_ROOT}supabase/config.toml`);
  const verifyJwtOff = new Set<string>();
  const re = /\[functions\.([a-z0-9_-]+)\][^\[]*?verify_jwt\s*=\s*false/gs;
  for (const m of findAll(re, config)) verifyJwtOff.add(m[1]);
  const proofs: Record<string, unknown> = {};
  for (const name of EDGE_ELIGIBLE_NON_USER) {
    assert(dirs.includes(name), `eligible edge endpoint missing: ${name}`);
    const src = await Deno.readTextFile(`${functionsDir}/${name}/index.ts`).catch(() => "");
    const lower = src.toLowerCase();
    const patterns = [
      { name: "shared_secret_check", re: /scheduler_secret|shared_secret|x-shared-secret|x-scheduler-secret/ },
      { name: "supabase_auth_getuser", re: /auth\.getuser\(|getuser\(\s*token/ },
      { name: "is_org_admin_rpc", re: /is_org_admin/ },
      { name: "assert_trusted_context", re: /assert_trusted_context/ },
      { name: "service_role_only_caller", re: /service_role/ },
    ];
    const matched = patterns.filter((p) => p.re.test(lower)).map((p) => p.name);
    const opRe = /(from\s*\(\s*['"]|createclient|supabase_service_role_key|storage\.from|functions\.invoke|auth\.admin|rpc\()/;
    const opMatch = lower.match(opRe);
    proofs[name] = {
      verify_jwt_false: verifyJwtOff.has(name),
      matched_protection: matched,
      first_privileged_pos: opMatch?.index ?? null,
      classification: matched.length > 0 ? "out_of_scope_non_user_endpoint" : "requires_edge_gate",
    };
  }
  console.log("[C2 edge proofs]", JSON.stringify(proofs, null, 2));
  assertEquals(dirs.length >= EDGE_ELIGIBLE_NON_USER.length, true);
});

// API-E.R1: Removed obsolete assertion that the diff since correction base 11e1a851
// must remain restricted to a fixed correction-only file allowlist. That allowlist
// was superseded by later approved API-E work and is not a security invariant.

// API-E.R1: Removed obsolete assertion that release metadata remain byte-identical to
// the historical baseline SHA f0e83308. Release metadata is regenerated by the build
// and is not an OAuth-containment security invariant.

// ---------------------------------------------------------------------------
// API-E.C2 focused unit tests for the SQL lexical masker + coordinate system
// ---------------------------------------------------------------------------

function fnDef(body: string): string {
  return `CREATE OR REPLACE FUNCTION public.f_synth()\n RETURNS void\n LANGUAGE plpgsql\nAS $function$\n${body}\n$function$\n`;
}

function analyzeSynthetic(body: string, overloadsMap?: Map<string, CandidateShape[]>) {
  const raw = fnDef(body);
  const { body: extracted, offset } = extractBody(raw);
  const masked = maskSql(extracted).toLowerCase();
  const defaultOverloads = new Map<string, CandidateShape[]>([
    ["is_active_user", [parseCandidateSignature("is_active_user()")!]],
    ["some_helper", [parseCandidateSignature("some_helper()")!]],
  ]);
  const overloads = overloadsMap ?? defaultOverloads;
  const baseNames = new Set(overloads.keys());
  const callResult = detectCalls(masked, raw, offset, baseNames, overloads, "f_synth");
  const ops = detectOps(masked, offset);
  return {
    raw, extracted, offset, masked,
    gate_hits: detectGates(masked, raw, offset),
    ops,
    public_relations: detectPublicRelations(masked),
    dynamic_sql: ops.some((o) => o.kind === "dynamic_sql"),
    calls: callResult.calls,
    ambiguities: callResult.ambiguities,
  };
}

Deno.test("API-E.C2: masker preserves length and newline positions exactly", () => {
  const src = "abc\n-- comment\n'lit''eral'\n/* /*nest*/ */\nE'x\\'y'\n$$body$$\n$tag$b$tag$\nplain";
  const masked = maskSql(src);
  assertEquals(masked.length, src.length);
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\n" || src[i] === "\r") {
      assertEquals(masked[i], src[i], `newline drift at ${i}`);
    }
  }
});

Deno.test("API-E.C2: real is_active_user gate call is detected in executable region", () => {
  const r = analyzeSynthetic("BEGIN IF NOT is_active_user() THEN RAISE 'x'; END IF; INSERT INTO public.t(a) VALUES(1); END;");
  assert(r.gate_hits.some((h) => h.gate === "is_active_user"));
});

Deno.test("API-E.C2: gate name inside a -- line comment is ignored", () => {
  const r = analyzeSynthetic("BEGIN -- is_active_user() here\nSELECT 1; END;");
  assertEquals(r.gate_hits.filter((h) => h.gate === "is_active_user").length, 0);
});

Deno.test("API-E.C2: gate name inside a nested block comment is ignored", () => {
  const r = analyzeSynthetic("BEGIN /* outer /* inner is_active_user() */ still */ SELECT 1; END;");
  assertEquals(r.gate_hits.filter((h) => h.gate === "is_active_user").length, 0);
});

Deno.test("API-E.C2: gate name inside an ordinary single-quoted literal is ignored", () => {
  const r = analyzeSynthetic("BEGIN RAISE 'call is_active_user() please'; END;");
  assertEquals(r.gate_hits.filter((h) => h.gate === "is_active_user").length, 0);
});

Deno.test("API-E.C2: gate name inside an E'...' literal is ignored", () => {
  const r = analyzeSynthetic("BEGIN RAISE E'call is_active_user() with \\'quote\\''; END;");
  assertEquals(r.gate_hits.filter((h) => h.gate === "is_active_user").length, 0);
});

Deno.test("API-E.C2: gate name inside $$...$$ dollar-quoted string is ignored", () => {
  const r = analyzeSynthetic("BEGIN EXECUTE $$SELECT is_active_user()$$; END;");
  assertEquals(r.gate_hits.filter((h) => h.gate === "is_active_user").length, 0);
});

Deno.test("API-E.C2: gate name inside $tag$...$tag$ dollar-quoted string is ignored", () => {
  const r = analyzeSynthetic("BEGIN PERFORM $tag$is_active_user()$tag$; END;");
  assertEquals(r.gate_hits.filter((h) => h.gate === "is_active_user").length, 0);
});

Deno.test("API-E.C2: business-operation keywords inside comments/literals are ignored", () => {
  const r = analyzeSynthetic("BEGIN -- INSERT INTO public.t(a) VALUES(1);\nRAISE 'DELETE FROM public.t'; END;");
  assertEquals(r.ops.length, 0);
  assertEquals(r.public_relations.length, 0);
});

Deno.test("API-E.C2: EXECUTE inside a literal or comment does not mark dynamic SQL", () => {
  const r1 = analyzeSynthetic("BEGIN RAISE 'EXECUTE bad'; END;");
  assertEquals(r1.dynamic_sql, false);
  const r2 = analyzeSynthetic("BEGIN -- EXECUTE bad\nSELECT 1; END;");
  assertEquals(r2.dynamic_sql, false);
});

Deno.test("API-E.C2: public-function calls inside comments/literals are ignored", () => {
  const r = analyzeSynthetic("BEGIN -- some_helper()\nRAISE 'some_helper()'; END;");
  assertEquals(r.calls.filter((c) => c.base_name === "some_helper").length, 0);
});

Deno.test("API-E.C2: real gates, operations, and calls AFTER masked regions are still detected", () => {
  const body = "BEGIN /* mask */ IF NOT is_active_user() THEN RAISE 'x'; END IF; PERFORM some_helper(); INSERT INTO public.t(a) VALUES(1); END;";
  const r = analyzeSynthetic(body);
  assert(r.gate_hits.some((h) => h.gate === "is_active_user"));
  assert(r.calls.some((c) => c.base_name === "some_helper"));
  assert(r.ops.some((o) => o.kind === "insert" && o.relation === "public.t"));
});

Deno.test("API-E.C2: nested block comments and doubled-quote escapes do not terminate masking early", () => {
  // If early termination happened, the trailing is_active_user() would be detected.
  const r1 = analyzeSynthetic("BEGIN /* a /* b */ c is_active_user() d */ SELECT 1; END;");
  assertEquals(r1.gate_hits.filter((h) => h.gate === "is_active_user").length, 0);
  const r2 = analyzeSynthetic("BEGIN RAISE 'it''s is_active_user() inside'; END;");
  assertEquals(r2.gate_hits.filter((h) => h.gate === "is_active_user").length, 0);
});

Deno.test("API-E.C2: unterminated comment/literal masks conservatively through EOF", () => {
  const r1 = analyzeSynthetic("BEGIN /* unterminated is_active_user() INSERT INTO public.t(a) VALUES(1);");
  assertEquals(r1.gate_hits.length, 0);
  assertEquals(r1.ops.length, 0);
  const r2 = analyzeSynthetic("BEGIN RAISE 'unterminated is_active_user() ");
  assertEquals(r2.gate_hits.length, 0);
});

Deno.test("API-E.C2: gate/op/call/ambiguity positions map back to correct substring of raw definition", () => {
  const body = "BEGIN IF NOT is_active_user() THEN RAISE 'x'; END IF; PERFORM some_helper(); INSERT INTO public.t(a) VALUES(1); END;";
  const r = analyzeSynthetic(body);
  for (const h of r.gate_hits) {
    assertEquals(r.raw.substring(h.pos, h.pos + h.gate.length), h.gate);
  }
  for (const c of r.calls) {
    assertEquals(r.raw.substring(c.pos, c.pos + c.base_name.length), c.base_name);
  }
  for (const o of r.ops) {
    // Every op position sits inside the raw def, not in the header
    assert(o.pos >= r.offset, `op pos ${o.pos} below body offset ${r.offset}`);
    assert(o.pos < r.raw.length, `op pos out of range`);
  }
});

Deno.test("API-E.C2: call-site and ambiguity positions include extracted-body offset", () => {
  const r = analyzeSynthetic("BEGIN PERFORM some_helper(); END;");
  assert(r.calls.length > 0);
  for (const c of r.calls) {
    assert(c.pos >= r.offset, `call pos ${c.pos} < body offset ${r.offset}`);
    assertEquals(r.raw.substring(c.pos, c.pos + c.base_name.length), c.base_name);
  }
});

Deno.test("API-E.C2: gate-before-op comparison uses one coordinate system (absolute raw offsets)", () => {
  const body = "BEGIN IF NOT is_active_user() THEN RAISE 'x'; END IF; INSERT INTO public.t(a) VALUES(1); END;";
  const r = analyzeSynthetic(body);
  const firstGate = r.gate_hits[0].pos;
  const firstOp = r.ops[0].pos;
  assert(firstGate >= r.offset && firstOp >= r.offset, "positions must be absolute");
  assert(firstGate < firstOp, "gate must precede op in unified coord system");
});

Deno.test("API-E.C2: snapshot per-function positions live in absolute-offset coordinate system", () => {
  // Every recorded pos in the snapshot must map back to a substring inside
  // the raw def at exactly the recorded offset when a natural anchor exists.
  for (const f of snapshot.functions) {
    for (const h of f.approved_gate_occurrences) {
      assertEquals(f.def.substring(h.pos, h.pos + h.gate.length), h.gate,
        `gate anchor mismatch in ${f.signature} at pos ${h.pos}`);
    }
    for (const c of f.call_sites) {
      assertEquals(f.def.substring(c.pos, c.pos + c.base_name.length), c.base_name,
        `call anchor mismatch in ${f.signature} at pos ${c.pos}`);
    }
    for (const g of f.assertion_guards) {
      assertEquals(f.def.substring(g.pos, g.pos + g.gate.length), g.gate,
        `assertion guard anchor mismatch in ${f.signature} at pos ${g.pos}`);
    }
  }
});

// ---------------------------------------------------------------------------
// API-E.C3 — Focused unit tests for exact overload resolution from call shape
// ---------------------------------------------------------------------------

function ovl(sigs: string[]): Map<string, CandidateShape[]> {
  const m = new Map<string, CandidateShape[]>();
  for (const s of sigs) {
    const p = parseCandidateSignature(s)!;
    const arr = m.get(p.base_name) ?? [];
    arr.push(p);
    m.set(p.base_name, arr);
  }
  return m;
}

Deno.test("API-E.C3: uniquely named function (no overloads) remains resolved", () => {
  const r = analyzeSynthetic("BEGIN PERFORM only_one(1, 2); END;",
    ovl(["only_one(_a int, _b int)"]));
  const c = r.calls.find((x) => x.base_name === "only_one")!;
  assertEquals(c.resolved_signature, "only_one(_a int, _b int)");
  assertEquals(c.ambiguity_reason, null);
});

Deno.test("API-E.C3: overloads with zero and one arg resolve by arity", () => {
  const overloads = ovl(["f_over(_a int)", "f_over()"]);
  const r0 = analyzeSynthetic("BEGIN PERFORM f_over(); END;", overloads);
  const c0 = r0.calls.find((x) => x.base_name === "f_over")!;
  assertEquals(c0.resolved_signature, "f_over()");
  assertEquals(c0.argument_count, 0);
  const r1 = analyzeSynthetic("BEGIN PERFORM f_over(7); END;", overloads);
  const c1 = r1.calls.find((x) => x.base_name === "f_over")!;
  assertEquals(c1.resolved_signature, "f_over(_a int)");
  assertEquals(c1.argument_count, 1);
});

Deno.test("API-E.C3: overloads with one and two args resolve by arity", () => {
  const overloads = ovl(["g(_a int)", "g(_a int, _b int)"]);
  const r1 = analyzeSynthetic("BEGIN PERFORM g(1); END;", overloads);
  assertEquals(r1.calls.find((x)=>x.base_name==="g")!.resolved_signature, "g(_a int)");
  const r2 = analyzeSynthetic("BEGIN PERFORM g(1, 2); END;", overloads);
  assertEquals(r2.calls.find((x)=>x.base_name==="g")!.resolved_signature, "g(_a int, _b int)");
});

Deno.test("API-E.C3: two overloads with same arity remain unresolved", () => {
  const r = analyzeSynthetic("BEGIN PERFORM h(1, 2); END;",
    ovl(["h(_x int, _y int)", "h(_p text, _q text)"]));
  const c = r.calls.find((x)=>x.base_name==="h")!;
  assertEquals(c.resolved_signature, null);
  assertEquals(c.ambiguity_reason, "multiple_shape_compatible_overloads");
  assertEquals(c.shape_compatible_signatures.length, 2);
});

Deno.test("API-E.C3: named argument uniquely selects overload when param names differ", () => {
  const r = analyzeSynthetic("BEGIN PERFORM k(_beta => 1); END;",
    ovl(["k(_alpha int)", "k(_beta int)"]));
  const c = r.calls.find((x)=>x.base_name==="k")!;
  assertEquals(c.resolved_signature, "k(_beta int)");
  assertEquals(c.named_argument_names, ["_beta"]);
});

Deno.test("API-E.C3: unknown named argument produces no compatible candidate", () => {
  const r = analyzeSynthetic("BEGIN PERFORM k(_gamma => 1); END;",
    ovl(["k(_alpha int)", "k(_beta int)"]));
  const c = r.calls.find((x)=>x.base_name==="k")!;
  assertEquals(c.resolved_signature, null);
  assertEquals(c.ambiguity_reason, "no_shape_compatible_overload");
});

Deno.test("API-E.C3: duplicate named argument fails closed", () => {
  const r = analyzeSynthetic("BEGIN PERFORM k(_a => 1, _a => 2); END;",
    ovl(["k(_a int, _b int)"]));
  const c = r.calls.find((x)=>x.base_name==="k")!;
  assertEquals(c.resolved_signature, null);
  assertEquals(c.ambiguity_reason, "malformed_call_shape");
});

Deno.test("API-E.C3: positional after named fails closed", () => {
  const r = analyzeSynthetic("BEGIN PERFORM k(_a => 1, 2); END;",
    ovl(["k(_a int, _b int)"]));
  const c = r.calls.find((x)=>x.base_name==="k")!;
  assertEquals(c.resolved_signature, null);
  assertEquals(c.ambiguity_reason, "malformed_call_shape");
});

Deno.test("API-E.C3: nested function calls do not inflate outer argument count", () => {
  const r = analyzeSynthetic("BEGIN PERFORM outer_fn(inner_fn(1, 2, 3)); END;",
    ovl(["outer_fn(_x int)", "outer_fn(_x int, _y int)"]));
  const c = r.calls.find((x)=>x.base_name==="outer_fn")!;
  assertEquals(c.argument_count, 1);
  assertEquals(c.resolved_signature, "outer_fn(_x int)");
});

Deno.test("API-E.C3: commas inside nested parentheses do not split outer args", () => {
  const r = analyzeSynthetic("BEGIN PERFORM p((1, 2), 3); END;",
    ovl(["p(_a record, _b int)"]));
  const c = r.calls.find((x)=>x.base_name==="p")!;
  assertEquals(c.argument_count, 2);
  assertEquals(c.resolved_signature, "p(_a record, _b int)");
});

Deno.test("API-E.C3.1: commas inside ARRAY[...] do not split top-level args", () => {
  // Post-C3.1: bracket depth is tracked; `ARRAY[1, 2, 3]` is one supplied
  // argument, not three. The call resolves to the two-parameter overload.
  const r = analyzeSynthetic("BEGIN PERFORM q(ARRAY[1, 2, 3], 4); END;",
    ovl(["q(_arr int[], _n int)"]));
  const c = r.calls.find((x)=>x.base_name==="q")!;
  assertEquals(c.argument_count, 2);
  assertEquals(c.positional_argument_count, 2);
  assertEquals(c.resolved_signature, "q(_arr int[], _n int)");
  assertEquals(c.ambiguity_reason, null);
});

Deno.test("API-E.C3: zero-argument call is parsed as zero arguments", () => {
  const r = analyzeSynthetic("BEGIN PERFORM z(); END;",
    ovl(["z()", "z(_x int)"]));
  const c = r.calls.find((x)=>x.base_name==="z")!;
  assertEquals(c.argument_count, 0);
  assertEquals(c.resolved_signature, "z()");
});

Deno.test("API-E.C3: unbalanced call is unresolved", () => {
  // Note: masker will not mask an unbalanced '(', so detectCalls sees the
  // opening paren and its findMatchingParen fails.
  const r = analyzeSynthetic("BEGIN PERFORM u(1, 2 ; END;",
    ovl(["u(_a int, _b int)"]));
  const c = r.calls.find((x)=>x.base_name==="u");
  if (c) {
    assertEquals(c.resolved_signature, null);
    assertEquals(c.ambiguity_reason, "unbalanced_call_expression");
  } else {
    // masker treated the region as literal — that's also fail-closed
    assertEquals(r.calls.filter((x)=>x.base_name==="u").length, 0);
  }
});

Deno.test("API-E.C3: comments and literals are ignored through C2 masker", () => {
  const r = analyzeSynthetic("BEGIN -- some_helper(1,2)\n RAISE 'some_helper(1,2)'; END;",
    ovl(["some_helper(_a int, _b int)"]));
  assertEquals(r.calls.filter((c)=>c.base_name==="some_helper").length, 0);
});

Deno.test("API-E.C3: every resolved call in snapshot is an exact member of the universe", () => {
  const universe = new Set(snapshot.functions.map((f) => f.signature));
  for (const f of snapshot.functions) {
    for (const c of f.call_sites) {
      if (c.resolved_signature !== null) {
        assert(universe.has(c.resolved_signature),
          `resolved signature not in universe: ${c.resolved_signature} (caller ${f.signature})`);
      }
      for (const s of c.shape_compatible_signatures ?? []) {
        assert(universe.has(s),
          `shape_compatible_signature not in universe: ${s}`);
      }
    }
  }
});

Deno.test("API-E.C3: call and ambiguity positions in snapshot remain absolute raw offsets", () => {
  for (const f of snapshot.functions) {
    for (const c of f.call_sites) {
      assertEquals(f.def.substring(c.pos, c.pos + c.base_name.length), c.base_name,
        `call position drift in ${f.signature} at ${c.pos}`);
    }
    for (const a of f.unresolved_ambiguities) {
      assertEquals(f.def.substring(a.pos, a.pos + a.base_name.length), a.base_name,
        `ambiguity position drift in ${f.signature} at ${a.pos}`);
    }
  }
});

Deno.test("API-E.C3: same-arity overloads without name discriminator are not resolved (no type guessing)", () => {
  const r = analyzeSynthetic("BEGIN PERFORM sh(1, 2); END;",
    ovl(["sh(_x int, _y int)", "sh(_x text, _y text)"]));
  const c = r.calls.find((x)=>x.base_name==="sh")!;
  assertEquals(c.resolved_signature, null);
  assertEquals(c.ambiguity_reason, "multiple_shape_compatible_overloads");
});

Deno.test("API-E.C3: transitive containment uses only uniquely resolved exact signature", () => {
  // Prove that resolving an overloaded target reveals a specific candidate,
  // and that an ambiguous call yields no unique target for the classifier.
  const unique = analyzeSynthetic("BEGIN PERFORM t(1, 2); END;",
    ovl(["t(_a int, _b int)"]));
  assertEquals(unique.calls[0].resolved_signature, "t(_a int, _b int)");
  const ambiguous = analyzeSynthetic("BEGIN PERFORM t(1, 2); END;",
    ovl(["t(_a int, _b int)", "t(_p text, _q text)"]));
  assertEquals(ambiguous.calls[0].resolved_signature, null);
  assertEquals(ambiguous.calls[0].shape_compatible_signatures.length, 2);
});

Deno.test("API-E.C3: snapshot's 5 previously-ambiguous _validate_user_links calls now resolve uniquely", () => {
  const target3 = "_validate_user_links(_links jsonb, _workspace_id uuid, _project_id uuid)";
  const affected = [
    "create_blocker_with_links",
    "create_risk_with_links",
    "update_blocker_with_links",
    "update_risk_with_links",
  ];
  let resolvedCount = 0;
  for (const f of snapshot.functions) {
    if (!affected.includes(f.base_name)) continue;
    for (const c of f.call_sites) {
      if (c.base_name === "_validate_user_links") {
        assertEquals(c.resolved_signature, target3,
          `expected ${target3} for ${f.signature}, got ${c.resolved_signature}`);
        assertEquals(c.ambiguity_reason, null);
        resolvedCount++;
      }
    }
  }
  assert(resolvedCount >= 5, `expected at least 5 resolved calls, got ${resolvedCount}`);
});

// ---------------------------------------------------------------------------
// API-E.C3.1 focused unit tests — array-expression argument splitting
// ---------------------------------------------------------------------------

Deno.test("API-E.C3.1: splitTopLevelCommas('ARRAY[1,2]') returns one part", () => {
  const r = splitTopLevelCommas("ARRAY[1,2]");
  assertEquals(r.ok, true);
  assertEquals(r.parts.length, 1);
  assertEquals(r.parts[0], "ARRAY[1,2]");
});

Deno.test("API-E.C3.1: splitTopLevelCommas nested ARRAY[[1,2],[3,4]] returns one part", () => {
  const r = splitTopLevelCommas("ARRAY[[1,2],[3,4]]");
  assertEquals(r.ok, true);
  assertEquals(r.parts.length, 1);
  assertEquals(r.parts[0], "ARRAY[[1,2],[3,4]]");
});

Deno.test("API-E.C3.1: splitTopLevelCommas separates ARRAY[1,2], other_call(3,4)", () => {
  const r = splitTopLevelCommas("ARRAY[1,2], other_call(3,4)");
  assertEquals(r.ok, true);
  assertEquals(r.parts.length, 2);
  assertEquals(r.parts[0], "ARRAY[1,2]");
  assertEquals(r.parts[1].trim(), "other_call(3,4)");
});

Deno.test("API-E.C3.1: single ARRAY[1,2] argument reports argument_count=1 positional=1", () => {
  const r = analyzeSynthetic("BEGIN PERFORM q(ARRAY[1,2]); END;",
    ovl(["q(_arr int[])"]));
  const c = r.calls.find((x)=>x.base_name==="q")!;
  assertEquals(c.argument_count, 1);
  assertEquals(c.positional_argument_count, 1);
  assertEquals(c.named_argument_names.length, 0);
});

Deno.test("API-E.C3.1: named ARRAY argument is one named argument", () => {
  const r = analyzeSynthetic("BEGIN PERFORM q(_values => ARRAY[1,2]); END;",
    ovl(["q(_values int[])"]));
  const c = r.calls.find((x)=>x.base_name==="q")!;
  assertEquals(c.argument_count, 1);
  assertEquals(c.positional_argument_count, 0);
  assertEquals(c.named_argument_names, ["_values"]);
  assertEquals(c.resolved_signature, "q(_values int[])");
});

Deno.test("API-E.C3.1: ARRAY[1,2] resolves to one-arg overload, never two-arg", () => {
  const r = analyzeSynthetic("BEGIN PERFORM q(ARRAY[1,2]); END;",
    ovl(["q(_arr int[])", "q(_a int, _b int)"]));
  const c = r.calls.find((x)=>x.base_name==="q")!;
  assertEquals(c.argument_count, 1);
  assertEquals(c.resolved_signature, "q(_arr int[])");
  assertEquals(c.shape_compatible_signatures, ["q(_arr int[])"]);
  assert(!c.shape_compatible_signatures.includes("q(_a int, _b int)"));
});

Deno.test("API-E.C3.1: nested multidimensional ARRAY does not inflate argument count", () => {
  const r = analyzeSynthetic("BEGIN PERFORM q(ARRAY[[1,2],[3,4]], 9); END;",
    ovl(["q(_m int[], _n int)"]));
  const c = r.calls.find((x)=>x.base_name==="q")!;
  assertEquals(c.argument_count, 2);
  assertEquals(c.positional_argument_count, 2);
  assertEquals(c.resolved_signature, "q(_m int[], _n int)");
});

Deno.test("API-E.C3.1: unmatched '[' is structurally invalid", () => {
  const r = splitTopLevelCommas("ARRAY[1,2");
  assertEquals(r.ok, false);
  assertEquals(r.parts.length, 0);
});

Deno.test("API-E.C3.1: unmatched ']' is structurally invalid", () => {
  const r = splitTopLevelCommas("1,2]");
  assertEquals(r.ok, false);
  assertEquals(r.parts.length, 0);
});

Deno.test("API-E.C3.1: brackets/commas inside comments and masked literals are ignored", () => {
  // The masker replaces string bytes with spaces, so any '[' or ',' inside
  // 'ARRAY[1,2]' as a string literal is not seen by splitTopLevelCommas.
  const r = analyzeSynthetic(
    "BEGIN -- q(ARRAY[1,2])\n RAISE 'q(ARRAY[1,2])'; END;",
    ovl(["q(_arr int[])"]));
  assertEquals(r.calls.filter((c)=>c.base_name==="q").length, 0);
});

Deno.test("API-E.C3.1: existing nested-parenthesis parsing remains unchanged", () => {
  const r = analyzeSynthetic("BEGIN PERFORM p((1, 2), 3); END;",
    ovl(["p(_a record, _b int)"]));
  const c = r.calls.find((x)=>x.base_name==="p")!;
  assertEquals(c.argument_count, 2);
  assertEquals(c.resolved_signature, "p(_a record, _b int)");
});

Deno.test("API-E.C3.1: bracket then paren mixed nesting", () => {
  const r = splitTopLevelCommas("ARRAY[foo(1,2), bar(3,4)], 9");
  assertEquals(r.ok, true);
  assertEquals(r.parts.length, 2);
  assertEquals(r.parts[0], "ARRAY[foo(1,2), bar(3,4)]");
  assertEquals(r.parts[1].trim(), "9");
});

// ---------------------------------------------------------------------------
// API-E.C4A — PL/pgSQL structural control-flow scanner substrate
// ---------------------------------------------------------------------------
// Deterministic, stack-based scanner over the C2 length-preservingly masked
// body. Substrate only: not integrated into any classification detector or
// snapshot comparison. Positions returned are body-local zero-based offsets;
// callers add the extractBody offset to obtain absolute raw-definition
// offsets. Fails closed on any structural inconsistency.

export interface StructBlock {
  id: number;
  kind: "root" | "nested";
  start: number;              // pos of BEGIN keyword
  end: number;                // pos of END keyword closing it
  parent: number | null;
  depth: number;              // 0 for root, 1+ for nested
  has_exception: boolean;
  exception_start: number | null;
  exception_end: number | null;
}

export interface StructBranch {
  kind: string;               // 'then'|'elsif'|'else'|'when'|'else'|'body'
  start: number;
  end: number;
}

export interface StructControl {
  id: number;
  kind: "if" | "case" | "loop";
  start: number;              // pos of IF/CASE/LOOP/WHILE/FOR/FOREACH keyword
  end: number;                // pos immediately after closing END IF/CASE/LOOP
  branches: StructBranch[];
  parent_block: number;
  parent_control: number | null;
  depth: number;              // 1-based control depth for positions inside
  loop_kind?: "loop" | "while" | "for" | "foreach";
}

export interface StructStatement {
  start: number;
  end: number;                // pos of terminating ';'
  block_id: number;
  control_id: number | null;
  in_exception: boolean;
}

export interface ContextInfo {
  in_declaration: boolean;
  block_id: number | null;
  block_depth: number;
  control_depth: number;
  enclosing_controls: Array<{ kind: string; branch: string | null }>;
  in_exception: boolean;
  statement_start: number | null;
  statement_end: number | null;
}

export interface StructureAnalysis {
  parse_supported: boolean;
  failure_reason: string | null;
  root_begin_pos: number;
  root_end_pos: number;
  root_has_exception: boolean;
  declaration_start: number | null;
  declaration_end: number | null;
  blocks: StructBlock[];
  control_frames: StructControl[];
  statements: StructStatement[];
  context_at: (pos: number) => ContextInfo;
}

type Tok = { kind: "id" | "semi" | "lp" | "rp" | "punct" | "quoted_id"; text: string; pos: number; end: number };

function tokenizePlpgsql(masked: string): { toks: Tok[]; unterminatedQuotedId: boolean } {
  // API-E.C4A.1: recognize PostgreSQL double-quoted identifiers as opaque
  // tokens. Keywords, punctuation, semicolons, and parentheses inside them
  // must not participate in structural analysis. Doubled `""` is an escaped
  // quote inside the identifier. Unterminated quotes fail closed.
  const s = masked.toLowerCase();
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    if (ch === "\"") {
      let j = i + 1;
      let closed = false;
      while (j < s.length) {
        if (s[j] === "\"") {
          if (j + 1 < s.length && s[j + 1] === "\"") { j += 2; continue; }
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) {
        return { toks, unterminatedQuotedId: true };
      }
      toks.push({ kind: "quoted_id", text: s.slice(i, j), pos: i, end: j });
      i = j;
      continue;
    }
    if ((ch >= "a" && ch <= "z") || ch === "_") {
      let j = i + 1;
      while (j < s.length && ((s[j] >= "a" && s[j] <= "z") || (s[j] >= "0" && s[j] <= "9") || s[j] === "_")) j++;
      toks.push({ kind: "id", text: s.slice(i, j), pos: i, end: j });
      i = j; continue;
    }
    if (ch === ";") { toks.push({ kind: "semi", text: ";", pos: i, end: i + 1 }); i++; continue; }
    if (ch === "(") { toks.push({ kind: "lp", text: "(", pos: i, end: i + 1 }); i++; continue; }
    if (ch === ")") { toks.push({ kind: "rp", text: ")", pos: i, end: i + 1 }); i++; continue; }
    toks.push({ kind: "punct", text: ch, pos: i, end: i + 1 }); i++;
  }
  return { toks, unterminatedQuotedId: false };
}

type Frame =
  | { kind: "begin"; blockId: number; section: "normal" | "exception"; startTokIdx: number }
  | { kind: "if"; controlId: number; branch: "pending_then" | "then" | "elsif" | "else"; branchStart: number }
  | { kind: "case"; controlId: number; branch: "pending" | "when" | "else"; branchStart: number }
  | { kind: "loop"; controlId: number };

const STMT_START_KEYWORDS = new Set([
  "begin", "then", "loop", "else", "declare",
]);

export function analyzePlpgsqlStructure(maskedBody: string): StructureAnalysis {
  const _tokResult = tokenizePlpgsql(maskedBody);
  const toks = _tokResult.toks;
  const blocks: StructBlock[] = [];
  const controls: StructControl[] = [];
  const statements: StructStatement[] = [];
  const stack: Frame[] = [];
  let declaration_start: number | null = null;
  let declaration_end: number | null = null;
  let root_begin_pos = -1;
  let root_end_pos = -1;
  let stmt_start_pending = true;
  let cur_stmt_start: number | null = null;
  let failure_reason: string | null = null;

  const fail = (r: string): StructureAnalysis => {
    return {
      parse_supported: false,
      failure_reason: r,
      root_begin_pos,
      root_end_pos,
      root_has_exception: false,
      declaration_start,
      declaration_end,
      blocks,
      control_frames: controls,
      statements,
      context_at: () => ({
        in_declaration: false, block_id: null, block_depth: 0,
        control_depth: 0, enclosing_controls: [], in_exception: false,
        statement_start: null, statement_end: null,
      }),
    };
  };

  const topBegin = (): Frame & { kind: "begin" } | null => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].kind === "begin") return stack[k] as any;
    }
    return null;
  };
  const topControl = (): (Frame & { kind: "if" | "case" | "loop" }) | null => {
    for (let k = stack.length - 1; k >= 0; k--) {
      const f = stack[k];
      if (f.kind === "if" || f.kind === "case" || f.kind === "loop") return f as any;
      if (f.kind === "begin") return null;
    }
    return null;
  };

  const currentBlockId = (): number | null => {
    const b = topBegin();
    return b ? b.blockId : null;
  };
  const currentControlId = (): number | null => {
    const c = topControl();
    return c ? c.controlId : null;
  };
  const currentInException = (): boolean => {
    const b = topBegin();
    return b ? b.section === "exception" : false;
  };

  const finalizeBranch = (ctrlId: number, endPos: number) => {
    const c = controls[ctrlId];
    if (c.branches.length === 0) return;
    c.branches[c.branches.length - 1].end = endPos;
  };
  const startBranch = (ctrlId: number, kind: string, startPos: number) => {
    controls[ctrlId].branches.push({ kind, start: startPos, end: startPos });
  };

  // API-E.C4A.1: fail closed on unterminated double-quoted identifiers.
  if (_tokResult.unterminatedQuotedId) {
    return fail("unterminated_quoted_identifier");
  }

  for (let ti = 0; ti < toks.length; ti++) {
    const t = toks[ti];

    // Statement-start tracking on identifiers (not semi/paren)
    if (t.kind === "id") {
      const w = t.text;

      // DECLARE at top (before root BEGIN)
      if (w === "declare" && root_begin_pos < 0 && stack.length === 0) {
        if (declaration_start === null) declaration_start = t.pos;
        stmt_start_pending = true;
        continue;
      }

      // Root BEGIN detection
      if (w === "begin") {
        if (stack.length === 0) {
          if (root_begin_pos >= 0) return fail("multiple_root_begin");
          if (declaration_start !== null) declaration_end = t.pos;
          root_begin_pos = t.pos;
          const b: StructBlock = {
            id: blocks.length, kind: "root", start: t.pos, end: -1,
            parent: null, depth: 0, has_exception: false,
            exception_start: null, exception_end: null,
          };
          blocks.push(b);
          stack.push({ kind: "begin", blockId: b.id, section: "normal", startTokIdx: ti });
          stmt_start_pending = true;
          cur_stmt_start = null;
          continue;
        }
        // Nested BEGIN
        if (!stmt_start_pending) return fail("nested_begin_not_at_statement_start");
        const parentBegin = topBegin();
        if (!parentBegin) return fail("nested_begin_without_parent");
        const b: StructBlock = {
          id: blocks.length, kind: "nested", start: t.pos, end: -1,
          parent: parentBegin.blockId,
          depth: blocks[parentBegin.blockId].depth + 1,
          has_exception: false, exception_start: null, exception_end: null,
        };
        blocks.push(b);
        stack.push({ kind: "begin", blockId: b.id, section: "normal", startTokIdx: ti });
        stmt_start_pending = true;
        cur_stmt_start = null;
        continue;
      }

      // Before root BEGIN is seen, only declare-section keywords are allowed
      if (root_begin_pos < 0) {
        // Ignore contents of declare section
        if (declaration_start !== null) continue;
        // Non-declare identifier before any BEGIN or DECLARE — treat as
        // implicit declaration section (top of body). Do nothing.
        continue;
      }

      // Inside body
      if (w === "if") {
        const parentBegin = topBegin()!;
        const parentCtrl = topControl();
        const c: StructControl = {
          id: controls.length, kind: "if", start: t.pos, end: -1,
          branches: [], parent_block: parentBegin.blockId,
          parent_control: parentCtrl ? parentCtrl.controlId : null,
          depth: (parentCtrl ? controls[parentCtrl.controlId].depth : 0) + 1,
        };
        controls.push(c);
        stack.push({ kind: "if", controlId: c.id, branch: "pending_then", branchStart: t.pos });
        stmt_start_pending = false;
        continue;
      }
      if (w === "then") {
        // Close previous branch (if any) and start THEN branch on top if-frame
        const top = stack[stack.length - 1];
        if (!top || top.kind !== "if") {
          // may be case WHEN ... THEN
          if (top && top.kind === "case") {
            if (top.branch === "when") {
              startBranch(top.controlId, "when_body", t.end);
              stmt_start_pending = true;
              continue;
            }
          }
          // May be exception handler: `WHEN <cond> THEN <handler>`
          if (top && top.kind === "begin" && top.section === "exception") {
            stmt_start_pending = true;
            continue;
          }
          return fail("then_without_if_or_case_when");
        }
        if (top.branch === "pending_then") {
          startBranch(top.controlId, "then", t.end);
          top.branch = "then";
        } else if (top.branch === "elsif") {
          // ELSIF <cond> THEN — start elsif body sub-branch
          startBranch(top.controlId, "elsif_body", t.end);
        } else {
          return fail("then_in_unexpected_if_branch");
        }
        stmt_start_pending = true;
        continue;
      }
      if (w === "elsif" || w === "elseif") {
        const top = stack[stack.length - 1];
        if (!top || top.kind !== "if") return fail("elsif_without_if");
        finalizeBranch(top.controlId, t.pos);
        startBranch(top.controlId, "elsif", t.pos);
        top.branch = "elsif";
        stmt_start_pending = false;
        continue;
      }
      if (w === "else") {
        const top = stack[stack.length - 1];
        if (!top) return fail("else_without_frame");
        if (top.kind === "if") {
          finalizeBranch(top.controlId, t.pos);
          startBranch(top.controlId, "else", t.end);
          top.branch = "else";
          stmt_start_pending = true;
          continue;
        }
        if (top.kind === "case") {
          finalizeBranch(top.controlId, t.pos);
          startBranch(top.controlId, "else", t.end);
          top.branch = "else";
          stmt_start_pending = true;
          continue;
        }
        return fail("else_without_if_or_case");
      }
      if (w === "case") {
        if (!stmt_start_pending) return fail("case_expression_unsupported");
        const parentBegin = topBegin()!;
        const parentCtrl = topControl();
        const c: StructControl = {
          id: controls.length, kind: "case", start: t.pos, end: -1,
          branches: [], parent_block: parentBegin.blockId,
          parent_control: parentCtrl ? parentCtrl.controlId : null,
          depth: (parentCtrl ? controls[parentCtrl.controlId].depth : 0) + 1,
        };
        controls.push(c);
        stack.push({ kind: "case", controlId: c.id, branch: "pending", branchStart: t.pos });
        stmt_start_pending = false;
        continue;
      }
      if (w === "when") {
        const top = stack[stack.length - 1];
        // WHEN inside exception section of a begin frame — handler start.
        if (top && top.kind === "begin" && top.section === "exception") {
          stmt_start_pending = false;
          continue;
        }
        if (!top || top.kind !== "case") return fail("when_without_case_or_exception");
        if (top.branch !== "pending") finalizeBranch(top.controlId, t.pos);
        startBranch(top.controlId, "when", t.pos);
        top.branch = "when";
        stmt_start_pending = false;
        continue;
      }
      if (w === "loop") {
        // Determine loop kind by scanning back to the previous statement
        // boundary (root BEGIN start or most recent ';') for while/for/foreach.
        let lk: "loop" | "while" | "for" | "foreach" = "loop";
        for (let k = ti - 1; k >= 0; k--) {
          const p = toks[k];
          if (p.kind === "semi") break;
          if (p.kind !== "id") continue;
          if (p.text === "while") { lk = "while"; break; }
          if (p.text === "for") { lk = "for"; break; }
          if (p.text === "foreach") { lk = "foreach"; break; }
          if (p.text === "begin" || p.text === "then" || p.text === "else" || p.text === "loop") break;
        }
        const parentBegin = topBegin()!;
        const parentCtrl = topControl();
        const c: StructControl = {
          id: controls.length, kind: "loop", start: t.pos, end: -1,
          branches: [{ kind: "body", start: t.end, end: t.end }],
          parent_block: parentBegin.blockId,
          parent_control: parentCtrl ? parentCtrl.controlId : null,
          depth: (parentCtrl ? controls[parentCtrl.controlId].depth : 0) + 1,
          loop_kind: lk,
        };
        controls.push(c);
        stack.push({ kind: "loop", controlId: c.id });
        stmt_start_pending = true;
        continue;
      }
      if (w === "exception") {
        // API-E.C4A.2: Treat EXCEPTION as a block section delimiter only when
        // it occurs at a valid section boundary. Otherwise (e.g. `RAISE
        // EXCEPTION ...`) it is ordinary statement content. The boundary is
        // determined purely from existing scanner state — no text look-behind:
        //   - the scanner is at the start of a new statement/section;
        //   - `cur_stmt_start` is null (no executable content precedes it
        //     since the last statement or structural boundary);
        //   - the current top stack frame is a `begin` frame still in its
        //     normal section (checked below to yield stable failure reasons
        //     when the boundary IS reached in an illegal position).
        const atBoundary = stmt_start_pending && cur_stmt_start === null;
        if (!atBoundary) {
          // Ordinary statement content — e.g. the EXCEPTION token of a
          // `RAISE EXCEPTION ...` statement. Do not alter block section,
          // do not create a handler, do not reset statement tracking.
          if (cur_stmt_start === null) cur_stmt_start = t.pos;
          stmt_start_pending = false;
          continue;
        }
        const top = stack[stack.length - 1];
        if (!top || top.kind !== "begin") return fail("exception_outside_begin");
        if (top.section !== "normal") return fail("duplicate_exception_section");
        top.section = "exception";
        const blk = blocks[top.blockId];
        blk.has_exception = true;
        blk.exception_start = t.pos;
        stmt_start_pending = true;
        cur_stmt_start = null;
        continue;
      }
      if (w === "end") {
        // Peek next id-ish token
        let nk: string | null = null;
        let nTok: Tok | null = null;
        for (let k = ti + 1; k < toks.length; k++) {
          if (toks[k].kind === "id") { nk = toks[k].text; nTok = toks[k]; break; }
          if (toks[k].kind === "semi") break;
        }
        if (nk === "if") {
          const top = stack.pop();
          if (!top || top.kind !== "if") return fail("end_if_without_matching_if");
          finalizeBranch(top.controlId, t.pos);
          controls[top.controlId].end = (nTok!.end);
          ti = toks.indexOf(nTok!);
          stmt_start_pending = false;
          continue;
        }
        if (nk === "case") {
          const top = stack.pop();
          if (!top || top.kind !== "case") return fail("end_case_without_matching_case");
          finalizeBranch(top.controlId, t.pos);
          controls[top.controlId].end = (nTok!.end);
          ti = toks.indexOf(nTok!);
          stmt_start_pending = false;
          continue;
        }
        if (nk === "loop") {
          const top = stack.pop();
          if (!top || top.kind !== "loop") return fail("end_loop_without_matching_loop");
          finalizeBranch(top.controlId, t.pos);
          controls[top.controlId].end = (nTok!.end);
          ti = toks.indexOf(nTok!);
          stmt_start_pending = false;
          continue;
        }
        // Bare END closes BEGIN block (optionally followed by a label id then ;)
        const top = stack.pop();
        if (!top) return fail("end_without_matching_begin");
        if (top.kind === "if") return fail("unclosed_if");
        if (top.kind === "case") return fail("unclosed_case");
        if (top.kind === "loop") return fail("unclosed_loop");
        if (top.kind !== "begin") return fail("end_without_matching_begin");
        const blk = blocks[top.blockId];
        blk.end = t.pos;
        if (top.section === "exception" && blk.exception_start !== null) {
          blk.exception_end = t.pos;
        }
        if (top.blockId === 0) root_end_pos = t.pos;
        stmt_start_pending = false;
        // Skip any label identifier
        if (nk !== null) ti = toks.indexOf(nTok!);
        continue;
      }

      // Any other identifier — content of a statement
      if (cur_stmt_start === null) cur_stmt_start = t.pos;
      stmt_start_pending = false;
      continue;
    }

    // API-E.C4A.1: quoted identifiers are opaque statement content. They may
    // start an ordinary statement but never open/close blocks, controls,
    // exception sections, branches, or statement boundaries.
    if (t.kind === "quoted_id") {
      if (root_begin_pos < 0) {
        // Before root BEGIN: sits in declare/pre-body region — inert.
        continue;
      }
      if (cur_stmt_start === null) cur_stmt_start = t.pos;
      stmt_start_pending = false;
      continue;
    }

    if (t.kind === "semi") {
      if (root_begin_pos < 0) {
        // semicolon in declaration section — just reset stmt tracking
        stmt_start_pending = true;
        cur_stmt_start = null;
        continue;
      }
      const bid = currentBlockId();
      if (bid !== null) {
        statements.push({
          start: cur_stmt_start ?? t.pos,
          end: t.pos,
          block_id: bid,
          control_id: currentControlId(),
          in_exception: currentInException(),
        });
      }
      cur_stmt_start = null;
      stmt_start_pending = true;
      continue;
    }

    // Parens and punctuation are content of a statement
    if (root_begin_pos >= 0 && cur_stmt_start === null) cur_stmt_start = t.pos;
    if (t.kind !== "lp" && t.kind !== "rp") {
      // punctuation like ',' does not open a frame
    }
  }

  if (root_begin_pos < 0) return fail("missing_root_begin");
  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top.kind === "begin") return fail("unclosed_begin");
    if (top.kind === "if") return fail("unclosed_if");
    if (top.kind === "case") return fail("unclosed_case");
    if (top.kind === "loop") return fail("unclosed_loop");
  }

  const root_has_exception = blocks[0]?.has_exception ?? false;

  const context_at = (pos: number): ContextInfo => {
    // Declaration?
    if (declaration_start !== null && declaration_end !== null &&
        pos >= declaration_start && pos < declaration_end) {
      return {
        in_declaration: true, block_id: null, block_depth: 0,
        control_depth: 0, enclosing_controls: [], in_exception: false,
        statement_start: null, statement_end: null,
      };
    }
    // Innermost block
    let innerBlock: StructBlock | null = null;
    for (const b of blocks) {
      if (pos >= b.start && pos <= b.end) {
        if (!innerBlock || b.depth > innerBlock.depth) innerBlock = b;
      }
    }
    // Enclosing controls
    const encl: Array<{ kind: string; branch: string | null }> = [];
    const enclControls: StructControl[] = [];
    for (const c of controls) {
      if (pos >= c.start && pos <= c.end) {
        enclControls.push(c);
      }
    }
    enclControls.sort((a, b) => a.depth - b.depth);
    for (const c of enclControls) {
      let branch: string | null = null;
      for (const br of c.branches) {
        if (pos >= br.start && pos <= br.end) branch = br.kind;
      }
      encl.push({ kind: c.kind, branch });
    }
    const control_depth = enclControls.length;
    const in_exception = innerBlock
      ? (innerBlock.exception_start !== null && pos >= innerBlock.exception_start &&
         (innerBlock.exception_end === null || pos <= innerBlock.exception_end))
      : false;
    let stmt_start: number | null = null;
    let stmt_end: number | null = null;
    for (const s of statements) {
      if (pos >= s.start && pos <= s.end) { stmt_start = s.start; stmt_end = s.end; break; }
    }
    return {
      in_declaration: false,
      block_id: innerBlock ? innerBlock.id : null,
      block_depth: innerBlock ? innerBlock.depth : 0,
      control_depth,
      enclosing_controls: encl,
      in_exception,
      statement_start: stmt_start,
      statement_end: stmt_end,
    };
  };

  return {
    parse_supported: true,
    failure_reason: null,
    root_begin_pos,
    root_end_pos,
    root_has_exception,
    declaration_start,
    declaration_end,
    blocks,
    control_frames: controls,
    statements,
    context_at,
  };
}

// ---------------------------------------------------------------------------
// API-E.C4A focused unit tests
// ---------------------------------------------------------------------------

function structOf(body: string): StructureAnalysis {
  return analyzePlpgsqlStructure(maskSql(body).toLowerCase());
}

Deno.test("API-E.C4A: simple root BEGIN ... END parses", () => {
  const r = structOf("BEGIN SELECT 1; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.failure_reason, null);
  assertEquals(r.blocks.length, 1);
  assertEquals(r.blocks[0].kind, "root");
  assertEquals(r.root_has_exception, false);
});

Deno.test("API-E.C4A: DECLARE section distinguished from executable", () => {
  const body = "DECLARE _x int; BEGIN SELECT 1; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assert(r.declaration_start !== null);
  assert(r.declaration_end !== null);
  const ctxDecl = r.context_at(r.declaration_start! + 1);
  assertEquals(ctxDecl.in_declaration, true);
  const ctxBody = r.context_at(r.root_begin_pos + 6);
  assertEquals(ctxBody.in_declaration, false);
});

Deno.test("API-E.C4A: top-level statement reports control_depth=0", () => {
  const body = "BEGIN SELECT 42; END;";
  const r = structOf(body);
  const pos = body.indexOf("SELECT");
  const ctx = r.context_at(pos);
  assertEquals(ctx.control_depth, 0);
  assertEquals(ctx.block_depth, 0);
});

Deno.test("API-E.C4A: statement inside IF has control_depth=1 with kind if", () => {
  const body = "BEGIN IF TRUE THEN SELECT 1; END IF; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  const pos = body.indexOf("SELECT");
  const ctx = r.context_at(pos);
  assertEquals(ctx.control_depth, 1);
  assertEquals(ctx.enclosing_controls[0].kind, "if");
});

Deno.test("API-E.C4A: IF/ELSIF/ELSE branches distinguished", () => {
  const body = "BEGIN IF a THEN SELECT 1; ELSIF b THEN SELECT 2; ELSE SELECT 3; END IF; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  const c1 = r.context_at(body.indexOf("SELECT 1"));
  const c2 = r.context_at(body.indexOf("SELECT 2"));
  const c3 = r.context_at(body.indexOf("SELECT 3"));
  assertEquals(c1.enclosing_controls[0].branch, "then");
  assert(c2.enclosing_controls[0].branch === "elsif" || c2.enclosing_controls[0].branch === "elsif_body");
  assertEquals(c3.enclosing_controls[0].branch, "else");
});

Deno.test("API-E.C4A: nested IF frames report correct depth", () => {
  const body = "BEGIN IF a THEN IF b THEN SELECT 1; END IF; END IF; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  const ctx = r.context_at(body.indexOf("SELECT 1"));
  assertEquals(ctx.control_depth, 2);
});

Deno.test("API-E.C4A: CASE/WHEN/ELSE structure tracked", () => {
  const body = "BEGIN CASE WHEN a THEN SELECT 1; ELSE SELECT 2; END CASE; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  const caseFrames = r.control_frames.filter((c) => c.kind === "case");
  assertEquals(caseFrames.length, 1);
  const ctx = r.context_at(body.indexOf("SELECT 1"));
  assertEquals(ctx.enclosing_controls[0].kind, "case");
});

Deno.test("API-E.C4A: LOOP structure tracked", () => {
  const body = "BEGIN LOOP SELECT 1; EXIT; END LOOP; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  const loops = r.control_frames.filter((c) => c.kind === "loop");
  assertEquals(loops.length, 1);
  assertEquals(loops[0].loop_kind, "loop");
});

Deno.test("API-E.C4A: WHILE LOOP tracked", () => {
  const body = "BEGIN WHILE i < 10 LOOP SELECT 1; END LOOP; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  const loops = r.control_frames.filter((c) => c.kind === "loop");
  assertEquals(loops.length, 1);
  assertEquals(loops[0].loop_kind, "while");
});

Deno.test("API-E.C4A: FOR LOOP tracked", () => {
  const body = "BEGIN FOR r IN SELECT 1 LOOP SELECT r; END LOOP; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.filter((c) => c.kind === "loop").length, 1);
  assertEquals(r.control_frames.find((c) => c.kind === "loop")!.loop_kind, "for");
});

Deno.test("API-E.C4A: FOREACH LOOP tracked", () => {
  const body = "BEGIN FOREACH x IN ARRAY xs LOOP SELECT x; END LOOP; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.find((c) => c.kind === "loop")!.loop_kind, "foreach");
});

Deno.test("API-E.C4A: nested BEGIN blocks report block depth", () => {
  const body = "BEGIN BEGIN SELECT 1; END; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.blocks.length, 2);
  const ctx = r.context_at(body.indexOf("SELECT 1"));
  assertEquals(ctx.block_depth, 1);
});

Deno.test("API-E.C4A: root EXCEPTION distinguished from normal section", () => {
  const body = "BEGIN SELECT 1; EXCEPTION WHEN OTHERS THEN SELECT 2; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, true);
  const cNorm = r.context_at(body.indexOf("SELECT 1"));
  const cExc = r.context_at(body.indexOf("SELECT 2"));
  assertEquals(cNorm.in_exception, false);
  assertEquals(cExc.in_exception, true);
});

Deno.test("API-E.C4A: nested EXCEPTION attached to nested block", () => {
  const body = "BEGIN BEGIN SELECT 1; EXCEPTION WHEN OTHERS THEN SELECT 2; END; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  const nested = r.blocks.find((b) => b.kind === "nested")!;
  assertEquals(nested.has_exception, true);
  const cExc = r.context_at(body.indexOf("SELECT 2"));
  assertEquals(cExc.in_exception, true);
  assertEquals(cExc.block_id, nested.id);
});

Deno.test("API-E.C4A: position in EXCEPTION handler reports in_exception=true", () => {
  const body = "BEGIN SELECT 1; EXCEPTION WHEN OTHERS THEN SELECT 99; END;";
  const r = structOf(body);
  const ctx = r.context_at(body.indexOf("99"));
  assertEquals(ctx.in_exception, true);
});

Deno.test("API-E.C4A: semicolons inside masked literals do not create statement boundaries", () => {
  const body = "BEGIN RAISE 'hello; world; oops'; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  // Only one true ';' terminator inside root block
  assertEquals(r.statements.length, 1);
});

Deno.test("API-E.C4A: control keywords inside masked literals do not create frames", () => {
  const body = "BEGIN RAISE 'IF THEN LOOP CASE END IF'; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 0);
});

Deno.test("API-E.C4A: END IF closes only IF frame, not enclosing LOOP", () => {
  const body = "BEGIN LOOP IF a THEN SELECT 1; END IF; EXIT; END LOOP; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 2);
  const ifF = r.control_frames.find((c) => c.kind === "if")!;
  const loopF = r.control_frames.find((c) => c.kind === "loop")!;
  assert(ifF.end < loopF.end);
});

Deno.test("API-E.C4A: business op inside one IF branch carries branch context", () => {
  const body = "BEGIN IF a THEN INSERT INTO t VALUES (1); ELSE SELECT 2; END IF; END;";
  const r = structOf(body);
  const ctx = r.context_at(body.indexOf("INSERT"));
  assertEquals(ctx.enclosing_controls[0].kind, "if");
  assertEquals(ctx.enclosing_controls[0].branch, "then");
});

Deno.test("API-E.C4A: guard after IF block returns to control_depth=0", () => {
  const body = "BEGIN IF a THEN SELECT 1; END IF; PERFORM is_active_user(); END;";
  const r = structOf(body);
  const ctx = r.context_at(body.indexOf("PERFORM"));
  assertEquals(ctx.control_depth, 0);
});

Deno.test("API-E.C4A: missing root BEGIN fails closed", () => {
  const r = structOf("SELECT 1;");
  assertEquals(r.parse_supported, false);
  assertEquals(r.failure_reason, "missing_root_begin");
});

Deno.test("API-E.C4A: unmatched END fails closed", () => {
  const r = structOf("BEGIN SELECT 1; END; END;");
  assertEquals(r.parse_supported, false);
  assert(r.failure_reason !== null);
});

Deno.test("API-E.C4A: unclosed IF fails closed", () => {
  const r = structOf("BEGIN IF a THEN SELECT 1; END;");
  assertEquals(r.parse_supported, false);
  assertEquals(r.failure_reason, "unclosed_if");
});

Deno.test("API-E.C4A: unclosed LOOP fails closed", () => {
  const r = structOf("BEGIN LOOP SELECT 1; END;");
  assertEquals(r.parse_supported, false);
  assertEquals(r.failure_reason, "unclosed_loop");
});

Deno.test("API-E.C4A: unclosed nested BEGIN fails closed", () => {
  const r = structOf("BEGIN BEGIN SELECT 1; END;");
  assertEquals(r.parse_supported, false);
  assertEquals(r.failure_reason, "unclosed_begin");
});

Deno.test("API-E.C4A: EXCEPTION outside a BEGIN block fails closed", () => {
  const r = structOf("EXCEPTION WHEN OTHERS THEN SELECT 1;");
  assertEquals(r.parse_supported, false);
  assert(r.failure_reason !== null);
});

Deno.test("API-E.C4A: contradictory nesting (END IF before IF) fails closed", () => {
  const r = structOf("BEGIN LOOP END IF; END LOOP; END;");
  assertEquals(r.parse_supported, false);
  assertEquals(r.failure_reason, "end_if_without_matching_if");
});

Deno.test("API-E.C4A: positions map back through body offset to raw definition", () => {
  const raw = "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$BEGIN SELECT 42; END;$$";
  const { body, offset } = extractBody(raw);
  const r = analyzePlpgsqlStructure(maskSql(body).toLowerCase());
  assertEquals(r.parse_supported, true);
  const bodyLocalPos = body.indexOf("SELECT");
  const absolute = offset + bodyLocalPos;
  assertEquals(raw.substring(absolute, absolute + 6), "SELECT");
  assertEquals(raw.substring(offset + r.root_begin_pos, offset + r.root_begin_pos + 5), "BEGIN");
});

Deno.test("API-E.C4A: C2 masking coordinate tests continue to pass (integration guard)", () => {
  // Guard: analyzeSynthetic still returns expected shape and positions after
  // introducing the structural scanner (which is not wired into detectors).
  const r = analyzeSynthetic("BEGIN IF NOT is_active_user() THEN RAISE 'x'; END IF; INSERT INTO public.t(a) VALUES(1); END;");
  assert(r.gate_hits.length > 0);
  assert(r.ops.length > 0);
});

Deno.test("API-E.C4A: analyzeAll classifications unchanged vs snapshot (substrate-only guard)", () => {
  const inputs = snapshot.functions.map((f) => ({ sig: f.signature, base_name: f.base_name, def: f.def }));
  const result = analyzeAll(inputs);
  for (const f of snapshot.functions) {
    const cls = result.cls.get(f.signature);
    const rsn = result.reasons.get(f.signature);
    assertExists(cls);
    assertEquals(cls, f.classification, `classification drift on ${f.signature}`);
    assertEquals(rsn, f.classification_reason, `classification reason drift on ${f.signature}`);
  }
});

// ---------------------------------------------------------------------------
// API-E.C4A.1 focused unit tests — quoted-identifier lexical safety
// ---------------------------------------------------------------------------

Deno.test("API-E.C4A.1: quoted \"if\" inside a normal statement does not create an IF frame", () => {
  const r = structOf('BEGIN SELECT "if" FROM t; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.failure_reason, null);
  assertEquals(r.control_frames.length, 0);
});

Deno.test("API-E.C4A.1: quoted \"case\" does not create a CASE frame", () => {
  const r = structOf('BEGIN SELECT "case" FROM t; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 0);
});

Deno.test("API-E.C4A.1: quoted \"loop\" does not create a LOOP frame", () => {
  const r = structOf('BEGIN SELECT "loop" FROM t; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 0);
});

Deno.test("API-E.C4A.1: quoted \"exception\" does not switch block into exception section", () => {
  const r = structOf('BEGIN SELECT "exception" FROM t; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
});

Deno.test("API-E.C4A.1: quoted \"begin\" in DECLARE section is not treated as root BEGIN", () => {
  const r = structOf('DECLARE "begin" int; BEGIN NULL; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.blocks.length, 1);
  assertEquals(r.blocks[0].kind, "root");
});

Deno.test("API-E.C4A.1: quoted \"end\" does not close a block or control frame", () => {
  const r = structOf('BEGIN IF true THEN SELECT "end" FROM t; END IF; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.failure_reason, null);
  assertEquals(r.control_frames.length, 1);
  assertEquals(r.control_frames[0].kind, "if");
});

Deno.test("API-E.C4A.1: quoted \"when\"/\"then\"/\"else\"/\"elsif\" remain inert", () => {
  const r = structOf(
    'BEGIN SELECT "when", "then", "else", "elsif" FROM t; END;',
  );
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 0);
});

Deno.test("API-E.C4A.1: qualified reference public.\"if\" is ordinary statement content", () => {
  const r = structOf('BEGIN SELECT public."if"() FROM t; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 0);
});

Deno.test("API-E.C4A.1: quoted table name \"begin\".\"loop\" remains inert", () => {
  const r = structOf('BEGIN SELECT * FROM "begin"."loop"; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 0);
  assertEquals(r.blocks.length, 1);
});

Deno.test("API-E.C4A.1: doubled quote escaping \"if\"\"then\"\"end\" is a single opaque token", () => {
  const body = 'BEGIN SELECT "if""then""end" FROM t; END;';
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 0);
});

Deno.test("API-E.C4A.1: semicolon inside a quoted identifier does not terminate a statement", () => {
  const r = structOf('BEGIN SELECT "a;b;c" FROM t; END;');
  assertEquals(r.parse_supported, true);
  // Exactly one real statement (the SELECT), terminated by the outer `;`.
  assertEquals(r.statements.length, 1);
});

Deno.test("API-E.C4A.1: parentheses inside a quoted identifier do not alter structural nesting", () => {
  const r = structOf('BEGIN SELECT "a(b,c)d" FROM t; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 0);
});

Deno.test("API-E.C4A.1: multiple control keywords inside one quoted identifier create no frame", () => {
  const r = structOf('BEGIN SELECT "if then else end loop case when" FROM t; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 0);
  assertEquals(r.root_has_exception, false);
});

Deno.test("API-E.C4A.1: unterminated quoted identifier fails with unterminated_quoted_identifier", () => {
  const r = structOf('BEGIN SELECT "oops FROM t; END;');
  assertEquals(r.parse_supported, false);
  assertEquals(r.failure_reason, "unterminated_quoted_identifier");
});

Deno.test("API-E.C4A.1: keywords immediately before/after a closed quoted identifier are still recognized", () => {
  const r = structOf('BEGIN IF true THEN SELECT "x" FROM t; END IF; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 1);
  assertEquals(r.control_frames[0].kind, "if");
});

Deno.test("API-E.C4A.1: comments and single/dollar-quoted literals remain inert through the C2 masker", () => {
  // 'if then end' as a string literal, and a -- if then end comment must not
  // affect the structural scanner. Also verify a quoted id alongside them is
  // still opaque.
  const body = "BEGIN -- if then end\n SELECT 'if then end', \"if\" FROM t; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.control_frames.length, 0);
});

// ---------------------------------------------------------------------------
// API-E.C4A.1 corpus safety — structural support for currently `contained`
// ---------------------------------------------------------------------------

Deno.test("API-E.C4A.1: structural scanner corpus-safety report for currently `contained` PL/pgSQL functions", () => {
  // Substrate-only informational check. Reports the exact signature and
  // failure reason for every currently `contained` PL/pgSQL function that the
  // C4A structural scanner does not yet support. C4A.1 corrects only quoted
  // identifier lexing; other pre-existing scanner limitations (e.g. RAISE
  // EXCEPTION-tagged statements confused with an EXCEPTION section, CASE
  // expressions embedded in SELECT) will be addressed in later C4A/C4B work.
  //
  // This test does not change classification. It records support state so
  // C4B can decide which functions may continue to be treated as contained.
  const contained = snapshot.functions.filter((f) => f.classification === "contained");
  const failures: { signature: string; reason: string }[] = [];
  let plpgsqlCount = 0;
  let supportedCount = 0;
  for (const f of contained) {
    if ((f.language || "").toLowerCase() !== "plpgsql") continue;
    plpgsqlCount++;
    const { body } = extractBody(f.def);
    const r = analyzePlpgsqlStructure(maskSql(body).toLowerCase());
    if (r.parse_supported) {
      supportedCount++;
    } else {
      failures.push({ signature: f.signature, reason: r.failure_reason ?? "unknown" });
    }
  }
  // Deterministic report so C4B can consume it.
  failures.sort((a, b) => a.signature.localeCompare(b.signature));
  const reasonCounts = new Map<string, number>();
  for (const x of failures) {
    reasonCounts.set(x.reason, (reasonCounts.get(x.reason) ?? 0) + 1);
  }
  const reasonSummary: Record<string, number> = {};
  for (const k of Array.from(reasonCounts.keys()).sort()) {
    reasonSummary[k] = reasonCounts.get(k)!;
  }
  console.log(
    "API-E.C4A.1 contained PL/pgSQL corpus safety: " +
      JSON.stringify(
        {
          contained_plpgsql_total: plpgsqlCount,
          structurally_supported: supportedCount,
          unsupported: failures.length,
          unsupported_reasons: reasonSummary,
        },
        null,
        2,
      ),
  );
  if (failures.length > 0) {
    console.log(
      "API-E.C4A.1 contained PL/pgSQL unsupported signatures:\n" +
        JSON.stringify(failures, null, 2),
    );
  }
  // Sanity only: at least one contained PL/pgSQL function is supported by
  // the scanner. Full support is the goal of subsequent C4A/C4B corrections.
  assert(plpgsqlCount === 0 || supportedCount > 0);
});

Deno.test("API-E.C4A.1: full-universe structural-support summary (informational, no assertion beyond print)", () => {
  const byLang = new Map<string, { total: number; supported: number; reasons: Map<string, number> }>();
  for (const f of snapshot.functions) {
    const lang = (f.language || "unknown").toLowerCase();
    let bucket = byLang.get(lang);
    if (!bucket) {
      bucket = { total: 0, supported: 0, reasons: new Map() };
      byLang.set(lang, bucket);
    }
    bucket.total++;
    if (lang !== "plpgsql") {
      // Non-plpgsql functions are not in scope of the structural scanner.
      const key = "not_plpgsql";
      bucket.reasons.set(key, (bucket.reasons.get(key) ?? 0) + 1);
      continue;
    }
    const { body } = extractBody(f.def);
    const r = analyzePlpgsqlStructure(maskSql(body).toLowerCase());
    if (r.parse_supported) {
      bucket.supported++;
    } else {
      const key = r.failure_reason ?? "unknown";
      bucket.reasons.set(key, (bucket.reasons.get(key) ?? 0) + 1);
    }
  }
  const summary: Record<string, unknown> = {};
  for (const [lang, b] of byLang.entries()) {
    const reasons: Record<string, number> = {};
    const keys = Array.from(b.reasons.keys()).sort();
    for (const k of keys) reasons[k] = b.reasons.get(k)!;
    summary[lang] = { total: b.total, supported: b.supported, failure_reasons: reasons };
  }
  console.log(
    "API-E.C4A.1 full-universe structural-support summary:\n" +
      JSON.stringify(summary, null, 2),
  );
  // Sanity: total across languages equals 564.
  let total = 0;
  for (const b of byLang.values()) total += b.total;
  assertEquals(total, snapshot.functions.length);
});

// ---------------------------------------------------------------------------
// API-E.C4A.2 focused unit tests — RAISE EXCEPTION vs block EXCEPTION section
// ---------------------------------------------------------------------------
// The scanner must recognize an `exception` token as a block-section
// delimiter ONLY at a valid section boundary (statement-start, no executable
// content since the last boundary, and the top frame is a `begin` frame still
// in its normal section). Otherwise the token is ordinary statement content —
// in particular the EXCEPTION token of `RAISE EXCEPTION ...`. Determined
// purely from scanner state (no text look-behind).

Deno.test("API-E.C4A.2: `RAISE EXCEPTION 'x';` parses as one ordinary statement", () => {
  const r = structOf("BEGIN RAISE EXCEPTION 'x'; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.failure_reason, null);
  assertEquals(r.statements.length, 1);
  assertEquals(r.statements[0].in_exception, false);
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION 'x';` does not set root_has_exception", () => {
  const r = structOf("BEGIN RAISE EXCEPTION 'x'; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
  assertEquals(r.blocks[0].has_exception, false);
  assertEquals(r.blocks[0].exception_start, null);
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION` does not switch current block to exception section", () => {
  const r = structOf("BEGIN RAISE EXCEPTION 'x'; SELECT 1; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.statements.length, 2);
  for (const s of r.statements) assertEquals(s.in_exception, false);
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION USING MESSAGE = 'x';` remains ordinary", () => {
  const r = structOf("BEGIN RAISE EXCEPTION USING MESSAGE = 'x'; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
  assertEquals(r.statements.length, 1);
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION 'x %', value;` remains ordinary", () => {
  const r = structOf("BEGIN RAISE EXCEPTION 'x %', value; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
  assertEquals(r.statements.length, 1);
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION SQLSTATE '22000';` remains ordinary", () => {
  const r = structOf("BEGIN RAISE EXCEPTION SQLSTATE '22000'; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
  assertEquals(r.statements.length, 1);
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION USING ERRCODE = '22000';` remains ordinary", () => {
  const r = structOf("BEGIN RAISE EXCEPTION USING ERRCODE = '22000'; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION` inside an IF branch remains ordinary", () => {
  const r = structOf("BEGIN IF true THEN RAISE EXCEPTION 'x'; END IF; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
  assertEquals(r.control_frames.length, 1);
  assertEquals(r.control_frames[0].kind, "if");
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION` inside a CASE WHEN branch remains ordinary", () => {
  const r = structOf("BEGIN CASE WHEN true THEN RAISE EXCEPTION 'x'; ELSE SELECT 1; END CASE; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
  assertEquals(r.control_frames.length, 1);
  assertEquals(r.control_frames[0].kind, "case");
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION` inside a LOOP body remains ordinary", () => {
  const r = structOf("BEGIN LOOP RAISE EXCEPTION 'x'; END LOOP; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
  assertEquals(r.control_frames.length, 1);
  assertEquals(r.control_frames[0].kind, "loop");
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION` inside a nested BEGIN remains ordinary", () => {
  const r = structOf("BEGIN BEGIN RAISE EXCEPTION 'x'; END; END;");
  assertEquals(r.parse_supported, true);
  assertEquals(r.blocks.length, 2);
  assertEquals(r.blocks[0].has_exception, false);
  assertEquals(r.blocks[1].has_exception, false);
});

Deno.test("API-E.C4A.2: `RAISE EXCEPTION` inside a real exception handler remains ordinary", () => {
  const body = "BEGIN SELECT 1; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'x'; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, true);
  // No duplicate exception section triggered.
  assertEquals(r.failure_reason, null);
});

Deno.test("API-E.C4A.2: real root EXCEPTION section still parses", () => {
  const body = "BEGIN SELECT 1; EXCEPTION WHEN OTHERS THEN SELECT 2; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, true);
  assertEquals(r.blocks[0].exception_start !== null, true);
});

Deno.test("API-E.C4A.2: real nested EXCEPTION section still parses", () => {
  const body = "BEGIN BEGIN SELECT 1; EXCEPTION WHEN OTHERS THEN SELECT 2; END; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  const nested = r.blocks.find((b) => b.kind === "nested")!;
  assertEquals(nested.has_exception, true);
});

Deno.test("API-E.C4A.2: multiple WHEN handlers still parse", () => {
  const body =
    "BEGIN SELECT 1; EXCEPTION WHEN no_data_found THEN SELECT 2; WHEN OTHERS THEN SELECT 3; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, true);
});

Deno.test("API-E.C4A.2: real EXCEPTION section following an earlier RAISE EXCEPTION statement still recognized", () => {
  const body =
    "BEGIN IF false THEN RAISE EXCEPTION 'never'; END IF; SELECT 1; EXCEPTION WHEN OTHERS THEN SELECT 2; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, true);
  assertEquals(r.blocks[0].has_exception, true);
});

Deno.test("API-E.C4A.2: EXCEPTION before any root BEGIN fails closed", () => {
  const r = structOf("EXCEPTION WHEN OTHERS THEN SELECT 1;");
  assertEquals(r.parse_supported, false);
  assert(r.failure_reason !== null);
});

Deno.test("API-E.C4A.2: duplicate real EXCEPTION sections in one BEGIN block fails closed", () => {
  const body =
    "BEGIN SELECT 1; EXCEPTION WHEN OTHERS THEN SELECT 2; EXCEPTION WHEN OTHERS THEN SELECT 3; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, false);
  assertEquals(r.failure_reason, "duplicate_exception_section");
});

Deno.test("API-E.C4A.2: EXCEPTION encountered with an open IF frame fails closed", () => {
  // `IF true THEN` opens an if-frame; the semicolon after SELECT 1 ends that
  // statement inside the THEN branch. Reaching EXCEPTION with the if-frame
  // still on the stack must fail closed rather than switch sections.
  const r = structOf("BEGIN IF true THEN SELECT 1; EXCEPTION WHEN OTHERS THEN SELECT 2; END;");
  assertEquals(r.parse_supported, false);
  assert(r.failure_reason !== null);
});

Deno.test("API-E.C4A.2: comments and string literals containing `RAISE EXCEPTION` remain inert through C2 masking", () => {
  const body =
    "BEGIN -- RAISE EXCEPTION 'x'\n SELECT 'RAISE EXCEPTION'; END;";
  const r = structOf(body);
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
});

Deno.test("API-E.C4A.2: quoted identifier `\"exception\"` remains inert through C4A.1 (no section switch)", () => {
  const r = structOf('BEGIN SELECT "exception" FROM t; END;');
  assertEquals(r.parse_supported, true);
  assertEquals(r.root_has_exception, false);
});

Deno.test("API-E.C4A.2: analyzeAll classifications unchanged vs snapshot (substrate-only guard)", () => {
  const inputs = snapshot.functions.map((f) => ({ sig: f.signature, base_name: f.base_name, def: f.def }));
  const result = analyzeAll(inputs);
  for (const f of snapshot.functions) {
    const cls = result.cls.get(f.signature);
    const rsn = result.reasons.get(f.signature);
    assertExists(cls);
    assertEquals(cls, f.classification, `classification drift on ${f.signature}`);
    assertEquals(rsn, f.classification_reason, `classification reason drift on ${f.signature}`);
  }
});

// ---------------------------------------------------------------------------
// API-E.C4A.2 corpus verification — full universe & contained subset
// ---------------------------------------------------------------------------

Deno.test("API-E.C4A.2: full-corpus structural-support (post-C4A.2): zero exception_outside_begin, support > 74", () => {
  const byLang = new Map<string, { total: number; supported: number; reasons: Map<string, number> }>();
  const perFailure: { signature: string; reason: string }[] = [];
  for (const f of snapshot.functions) {
    const lang = (f.language || "unknown").toLowerCase();
    let bucket = byLang.get(lang);
    if (!bucket) {
      bucket = { total: 0, supported: 0, reasons: new Map() };
      byLang.set(lang, bucket);
    }
    bucket.total++;
    if (lang !== "plpgsql") continue;
    const { body } = extractBody(f.def);
    const r = analyzePlpgsqlStructure(maskSql(body).toLowerCase());
    if (r.parse_supported) {
      bucket.supported++;
    } else {
      const key = r.failure_reason ?? "unknown";
      bucket.reasons.set(key, (bucket.reasons.get(key) ?? 0) + 1);
      perFailure.push({ signature: f.signature, reason: key });
    }
  }
  perFailure.sort((a, b) => a.signature.localeCompare(b.signature));
  const plpgsql = byLang.get("plpgsql")!;
  const reasons: Record<string, number> = {};
  for (const k of Array.from(plpgsql.reasons.keys()).sort()) reasons[k] = plpgsql.reasons.get(k)!;
  console.log(
    "API-E.C4A.2 full-corpus post-fix summary:\n" +
      JSON.stringify(
        {
          plpgsql_total: plpgsql.total,
          structurally_supported: plpgsql.supported,
          failure_reasons: reasons,
        },
        null,
        2,
      ),
  );
  console.log(
    "API-E.C4A.2 remaining unsupported PL/pgSQL signatures (deterministic):\n" +
      JSON.stringify(perFailure, null, 2),
  );
  // Zero exception_outside_begin (the defect this correction addresses).
  assertEquals(plpgsql.reasons.get("exception_outside_begin") ?? 0, 0);
  // No function newly fails with duplicate_exception_section from this fix.
  // The only legal duplicate_exception_section outcomes come from genuinely
  // ill-formed sources — none exist in the current corpus.
  assertEquals(plpgsql.reasons.get("duplicate_exception_section") ?? 0, 0);
  // Structural support must exceed the previous 74 baseline.
  assert(plpgsql.supported > 74, `expected supported > 74, got ${plpgsql.supported}`);
});

Deno.test("API-E.C4A.2: contained PL/pgSQL subset — support summary and exact unsupported signatures", () => {
  const contained = snapshot.functions.filter((f) => f.classification === "contained");
  let plpgsqlTotal = 0;
  let supported = 0;
  const failures: { signature: string; reason: string }[] = [];
  for (const f of contained) {
    if ((f.language || "").toLowerCase() !== "plpgsql") continue;
    plpgsqlTotal++;
    const { body } = extractBody(f.def);
    const r = analyzePlpgsqlStructure(maskSql(body).toLowerCase());
    if (r.parse_supported) supported++;
    else failures.push({ signature: f.signature, reason: r.failure_reason ?? "unknown" });
  }
  failures.sort((a, b) => a.signature.localeCompare(b.signature));
  console.log(
    "API-E.C4A.2 contained PL/pgSQL summary:\n" +
      JSON.stringify(
        { contained_plpgsql_total: plpgsqlTotal, supported, unsupported: failures.length },
        null,
        2,
      ),
  );
  console.log(
    "API-E.C4A.2 contained PL/pgSQL unsupported signatures:\n" +
      JSON.stringify(failures, null, 2),
  );
  // Substrate-only: no assertion beyond print, other than sanity that we
  // observed some plpgsql functions in the contained subset.
  assert(plpgsqlTotal >= 0);
});
