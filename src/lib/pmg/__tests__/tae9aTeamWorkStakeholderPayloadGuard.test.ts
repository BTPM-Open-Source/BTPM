/** TAE.9A — current-state Team Work Requester/Executors payload guard. */
import { describe, it, expect } from "vitest";
import { currentFunction, functionAcl } from "../../../test/ossSqlContract";

const FN = currentFunction("get_team_work_overview");
const ACL = functionAcl("get_team_work_overview");

describe("TAE.9A Team Work Requester/Executors payload", () => {
  it("keeps the canonical Team Work signature and SECURITY DEFINER posture", () => {
    for (const token of [
      "_workspace_id uuid", "_program_id uuid", "_project_id uuid", "_assignee_id uuid",
      "_time_window text", "_include_completed boolean", "_workspace_ids uuid[]",
      "_portfolio_item_ids uuid[]", "STABLE SECURITY DEFINER",
    ]) expect(FN).toContain(token);
    expect(FN).toMatch(/SET search_path TO (?:'pg_catalog', 'public'|pg_catalog, public)/i);
  });

  it("enforces three-way Task/Stakeholder containment", () => {
    expect(FN).toMatch(/s\.project_id\s*=\s*et\.project_id/i);
    expect(FN).toMatch(/s\.workspace_id\s*=\s*et\.workspace_id/i);
    expect(FN).toMatch(/s\.organization_id\s*=\s*et\.organization_id/i);
  });

  it("emits nullable Requester and array Executors with the protected display-safe object shape", () => {
    expect(FN).toMatch(/'requested_by_stakeholder',\s*r\.obj/i);
    expect(FN).toMatch(/'executed_by_stakeholders',\s*COALESCE\(ex\.arr,\s*'\[\]'::jsonb\)/i);
    for (const key of ["id", "display_name", "stakeholder_type", "role_label", "is_removed"]) {
      expect(FN).toContain(`'${key}'`);
    }
    const stakeholderBlock = FN.match(/stakeholder_rows AS \([\s\S]+?executors AS \([\s\S]+?\)/i)?.[0] ?? "";
    expect(stakeholderBlock).not.toContain("'user_id'");
    expect(stakeholderBlock).not.toContain("'email'");
    expect(stakeholderBlock).not.toContain("'organization_id'");
    expect(stakeholderBlock).not.toContain("'workspace_id'");
    expect(stakeholderBlock).not.toContain("'project_id'");
  });

  it("keeps deterministic Executor ordering and one Task row after aggregation", () => {
    expect(FN).toMatch(/ORDER BY display_name ASC,\s*stakeholder_id ASC/i);
    expect(FN).toMatch(/GROUP BY task_id/i);
    expect(FN).toMatch(/LEFT JOIN requesters r ON r\.task_id = e\.task_id/i);
    expect(FN).toMatch(/LEFT JOIN executors ex ON ex\.task_id = e\.task_id/i);
  });

  it("revokes PUBLIC, never grants anon, and retains authenticated/service runtime access", () => {
    expect(ACL).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
    expect(ACL).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+anon/i);
    expect(ACL).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+authenticated/i);
    expect(ACL).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+service_role/i);
  });
});
