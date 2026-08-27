/**
 * PMG-CORR.2 — PM-domain direct-write regression guard.
 *
 * Fails when any React/client code under `src/` bypasses the PMG RPCs by
 * calling `supabase.from("<pm-table>").insert|update|delete|upsert(...)`
 * directly — even when the chain is broken across multiple lines.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const PM_TABLES = [
  "programs",
  "projects",
  "phases",
  "tasks",
  "dependencies",
  "task_assignments",
  "project_team_members",
  "raci_assignments",
  "kpi_definitions",
  "kpi_updates",
  "governance_records",
  "blockers",
  "risks",
  "comments",
  "execution_updates",
  "backlog_items",
  "sprints",
  "task_stakeholder_roles",
] as const;

const MUTATION_METHODS = ["insert", "update", "delete", "upsert"] as const;

const SRC_ROOT = resolve(__dirname, "..", "..", "..");
const REPO_ROOT = resolve(SRC_ROOT, "..");
const THIS_FILE = resolve(__filename);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

type Violation = { file: string; table: string; method: string };

// Whitespace-tolerant detector. Matches:
//   .from( "<table>" ) [any ws/newlines] . <mutation>(
// with either single or double quotes around the table name.
function detect(source: string): { table: string; method: string }[] {
  const tableAlt = PM_TABLES.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const methodAlt = MUTATION_METHODS.join("|");
  const re = new RegExp(
    String.raw`\.\s*from\s*\(\s*["'](` + tableAlt + String.raw`)["']\s*\)\s*\.\s*(` + methodAlt + String.raw`)\s*\(`,
    "g",
  );
  const hits: { table: string; method: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    hits.push({ table: m[1], method: m[2] });
  }
  return hits;
}

describe("PM-domain direct-write regression guard", () => {
  it("catches the exact multiline `.from(\"phases\").update` style previously missed", () => {
    const sample = `supabase\n  .from("phases")\n  .update({ status: "active" })\n  .eq("id", id);`;
    const hits = detect(sample);
    expect(hits).toEqual([{ table: "phases", method: "update" }]);
  });

  it("does not flag read-only .select chains", () => {
    const sample = `supabase.from("phases").select("*").eq("id", id);`;
    expect(detect(sample)).toEqual([]);
  });

  it("has no PM-domain direct browser writes anywhere under src/", () => {
    const files = walk(SRC_ROOT).filter((f) => resolve(f) !== THIS_FILE);
    const violations: Violation[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const hit of detect(src)) {
        violations.push({
          file: relative(REPO_ROOT, file),
          table: hit.table,
          method: hit.method,
        });
      }
    }
    if (violations.length > 0) {
      const rendered = violations
        .map((v) => `  - ${v.file}: .from("${v.table}").${v.method}(...)`)
        .join("\n");
      throw new Error(
        `PM-domain tables must be mutated via PMG RPCs, not direct Supabase writes.\n` +
          `Found ${violations.length} violation(s):\n${rendered}`,
      );
    }
    expect(violations).toEqual([]);
  });
});
