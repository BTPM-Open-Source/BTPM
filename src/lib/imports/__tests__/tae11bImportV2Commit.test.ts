// TAE.11B — Static contract guards for the v2 commit path.
//
// OSS/current-state form: inspect only the installed function definition for
// `public.commit_btpm_import_v1_core`. The clean publication baseline is a
// consolidated schema, so whole-migration negative assertions would produce
// false positives from unrelated functions in the same file.
import { describe, expect, it } from "vitest";
import { currentFunction } from "../../../test/ossSqlContract";

const RPC_SRC = currentFunction("commit_btpm_import_v1_core", {
  includes: ["_is_v2", "apply_task_stakeholder_roles_set"],
});

describe("TAE.11B — v2 commit RPC static guards", () => {
  it("gates v2-only sections behind _is_v2 = (schema_version = 'btpm_import_v2')", () => {
    expect(RPC_SRC).toMatch(
      /_is_v2\s*:=\s*\(_batch\.schema_version\s*=\s*'btpm_import_v2'\)/,
    );
    expect(RPC_SRC).toMatch(/IF\s+_is_v2\s+THEN/);
  });

  it("preserves dry-run/hash/one-time-commit protections", () => {
    expect(RPC_SRC).toMatch(/dry_run_batch_not_found/);
    expect(RPC_SRC).toMatch(/dry_run_already_committed/);
    expect(RPC_SRC).toMatch(/dry_run_payload_mismatch/);
    expect(RPC_SRC).toMatch(/_batch\.payload_hash\s*<>\s*_payload_hash/);
    expect(RPC_SRC).toMatch(/org_admin_required/);
  });

  it("preserves create-only Project semantics (name conflict aborts commit)", () => {
    expect(RPC_SRC).toMatch(/project_name_conflict/);
  });

  it("creates Project Stakeholders via canonical add_project_stakeholder", () => {
    expect(RPC_SRC).toMatch(
      /public\.add_project_stakeholder\([\s\S]{0,200}'workspace_member'/,
    );
    expect(RPC_SRC).toMatch(
      /public\.add_project_stakeholder\([\s\S]{0,200}'external'/,
    );
  });

  it("enforces internal-member containment (org active + workspace member)", () => {
    expect(RPC_SRC).toMatch(/user_not_in_workspace/);
    expect(RPC_SRC).toMatch(/organization_memberships[\s\S]{0,200}status\s*=\s*'active'/);
  });

  it("sets Task Requester/Executors ONLY via apply_task_stakeholder_roles_set", () => {
    expect(RPC_SRC).toMatch(/public\.apply_task_stakeholder_roles_set\s*\(/);
  });

  it("never writes directly to public.task_stakeholder_roles from the commit RPC", () => {
    expect(RPC_SRC).not.toMatch(/INSERT\s+INTO\s+public\.task_stakeholder_roles/i);
    expect(RPC_SRC).not.toMatch(/UPDATE\s+public\.task_stakeholder_roles/i);
    expect(RPC_SRC).not.toMatch(/DELETE\s+FROM\s+public\.task_stakeholder_roles/i);
  });

  it("rejects broken and cross-Project references atomically", () => {
    expect(RPC_SRC).toMatch(/broken_reference:\s*task[^\n]*requester/);
    expect(RPC_SRC).toMatch(/broken_reference:\s*task[^\n]*executor/);
    expect(RPC_SRC).toMatch(/cross_project_reference:\s*task[^\n]*requester/);
    expect(RPC_SRC).toMatch(/cross_project_reference:\s*task[^\n]*executor/);
    expect(RPC_SRC).toMatch(/duplicate_stakeholder_external_key/);
  });

  it("deduplicates Executor ids deterministically before delegating to the PMG command", () => {
    expect(RPC_SRC).toMatch(/_seen_execs/);
    expect(RPC_SRC).toMatch(/NOT\s*\(_pid\s*=\s*ANY\(_seen_execs\)\)/);
  });

  it("surfaces v2 counts in summary, activity, and audit payloads", () => {
    for (const key of [
      "project_stakeholders_created",
      "task_requester_links_created",
      "task_executor_links_created",
    ]) {
      const occurrences = RPC_SRC.match(new RegExp(key, "g")) ?? [];
      expect(occurrences.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("rolls back the whole commit if accountability application is not applied/no_change", () => {
    expect(RPC_SRC).toMatch(/task_accountability_apply_failed/);
  });

  it("keeps caller identity as audit actor and SECURITY DEFINER with fixed search_path", () => {
    expect(RPC_SRC).toMatch(/SECURITY\s+DEFINER/i);
    expect(RPC_SRC).toMatch(/SET\s+search_path\s+TO\s+'pg_catalog',\s*'public'/i);
    expect(RPC_SRC).toMatch(/_user\s+uuid\s*:=\s*auth\.uid\(\)/);
  });

  it("does not append/update existing Projects", () => {
    expect(RPC_SRC).not.toMatch(/UPDATE\s+public\.projects\s+SET/i);
  });

  it("persists no raw payload rows — only counts on the batch summary", () => {
    expect(RPC_SRC).toMatch(/safe_summary_json[\s\S]{0,200}commit_counts/);
    expect(RPC_SRC).not.toMatch(/safe_summary_json[\s\S]{0,400}_payload\b/);
  });
});
