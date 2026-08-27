/** TAE.C — current-state Power BI Task Stakeholder Role bridge guard. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260825000030_pbi_reporting_extended_surfaces.sql"),
  "utf8",
);
const VIEW_MATCH = SQL.match(
  /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+pbi_reporting\.bridge_task_stakeholder_roles[\s\S]*?;/i,
);
const VIEW = VIEW_MATCH?.[0] ?? "";

describe("TAE.C Power BI Task Stakeholder Role bridge current contract", () => {
  it("creates the protected bridge view", () => {
    expect(VIEW).not.toBe("");
    expect(VIEW).toMatch(/security_barrier\s*=\s*true/i);
    expect(VIEW).not.toMatch(/security_invoker/i);
  });

  it("uses tenant resolver and canonical Project scope", () => {
    expect(VIEW).toContain("pbi_reporting_security.resolve_current_tenant()");
    expect(VIEW).toContain("pbi_reporting._scope_projects");
  });

  it("exposes exactly the frozen relationship columns and no person attributes", () => {
    expect(VIEW).toMatch(/SELECT\s+p\.organization_id\s*,\s*p\.workspace_id\s*,\s*p\.id\s+AS\s+project_id\s*,\s*tsr\.task_id\s*,\s*tsr\.project_stakeholder_id\s+AS\s+stakeholder_id\s*,\s*tsr\.role_type::text\s+AS\s+role\b/i);
    for (const forbidden of [
      "task_stakeholder_role_id", "tenant_id AS", "phase_id", "role_type AS role_type",
      "created_at", "updated_at", "display_name", "external_name", "external_email",
      "email", "phone", "role_label", "stakeholder_type", "is_removed", "user_id",
    ]) expect(VIEW.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it("enforces canonical Task → Project → Stakeholder containment", () => {
    expect(VIEW).toMatch(/FROM\s+public\.task_stakeholder_roles\s+tsr/i);
    expect(VIEW).toMatch(/JOIN\s+public\.tasks\s+t\s+ON\s+t\.id\s*=\s*tsr\.task_id/i);
    expect(VIEW).toMatch(/JOIN\s+public\.projects\s+p\s+ON\s+p\.id\s*=\s*t\.project_id[\s\S]*?p\.organization_id\s*=\s*t\.organization_id[\s\S]*?p\.workspace_id\s*=\s*t\.workspace_id/i);
    expect(VIEW).toMatch(/JOIN\s+public\.project_stakeholders\s+ps\s+ON\s+ps\.id\s*=\s*tsr\.project_stakeholder_id[\s\S]*?ps\.project_id\s*=\s*p\.id[\s\S]*?ps\.organization_id\s*=\s*p\.organization_id[\s\S]*?ps\.workspace_id\s*=\s*p\.workspace_id/i);
  });

  it("is reader-only through the clean-baseline dynamic ACL block", () => {
    expect(SQL).toMatch(/FOREACH\s+v_name\s+IN\s+ARRAY\s+ARRAY\[[\s\S]*?'bridge_task_stakeholder_roles'[\s\S]*?\]\s+LOOP/i);
    expect(SQL).toContain("REVOKE ALL ON pbi_reporting.%I FROM PUBLIC");
    expect(SQL).toMatch(/ARRAY\['anon','authenticated','service_role','pbi_reader'\]/i);
    expect(SQL).toContain("REVOKE ALL ON pbi_reporting.%I FROM %I");
    expect(SQL).toContain("GRANT SELECT ON pbi_reporting.%I TO btpm_pbi_reader");
    expect(SQL).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\s+ON\s+pbi_reporting\.bridge_task_stakeholder_roles/i);
  });
});
