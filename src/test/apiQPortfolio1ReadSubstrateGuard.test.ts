/**
 * API-Q Portfolio-1 — current-state guard for protected Portfolio reads.
 *
 * The OSS clean baseline is consolidated; final wrapper definitions and ACLs
 * are the contract. Historical migration-order/seed assertions are excluded.
 */
import { describe, it, expect } from "vitest";
import { currentFunction, functionAcl } from "./ossSqlContract";

const LIST = currentFunction("api_v1_list_portfolios");
const DETAIL = currentFunction("api_v1_get_portfolio");
const LIST_ACL = functionAcl("api_v1_list_portfolios");
const DETAIL_ACL = functionAcl("api_v1_get_portfolio");

describe("API-Q Portfolio-1 list wrapper", () => {
  it("keeps the bounded Organization-scoped signature and security posture", () => {
    expect(LIST).toMatch(/_expected_oauth_client_id text/i);
    expect(LIST).toMatch(/_organization_id uuid/i);
    expect(LIST).toMatch(/_limit integer DEFAULT 50/i);
    expect(LIST).toMatch(/_offset integer DEFAULT 0/i);
    expect(LIST).toMatch(/_search text DEFAULT NULL/i);
    expect(LIST).toMatch(/_include_archived boolean DEFAULT false/i);
    expect(LIST).toMatch(/STABLE SECURITY DEFINER/i);
    expect(LIST).toMatch(/SET search_path TO 'pg_catalog'/i);
  });

  it("bounds limit, offset, and search", () => {
    expect(LIST).toMatch(/_limit < 1 OR _limit > 100/i);
    expect(LIST).toMatch(/_offset < 0 OR _offset > 10000/i);
    expect(LIST).toMatch(/btrim\(_search\)/i);
    expect(LIST).toMatch(/length\(_search_trimmed\) > 100/i);
  });

  it("requires delegated identity, Organization enablement, exact grant and Org Admin authority", () => {
    expect(LIST).toMatch(/api_e_private\.resolve_delegated_read_principal\(_expected_oauth_client_id\)/i);
    expect(LIST).toMatch(/api_organization_client_enablements/i);
    expect(LIST).toMatch(/g\.capability_key = 'portfolios:list'/i);
    expect(LIST).toMatch(/g\.workspace_id IS NULL/i);
    expect(LIST).toMatch(/om\.role::text = 'org_admin'/i);
    expect(LIST).toMatch(/api_v1_not_authorized' USING ERRCODE = '42501'/i);
  });

  it("returns only the bounded collection projection with deterministic ordering", () => {
    for (const field of [
      "portfolioId", "organizationId", "name", "code", "lifecycleState",
      "strategicPriority", "ownerId", "isArchived", "updatedAt",
    ]) expect(LIST).toContain(`'${field}',`);
    expect(LIST).not.toContain("'description',");
    expect(LIST).not.toContain("'createdBy'");
    expect(LIST).not.toContain("'updatedBy'");
    expect(LIST).toMatch(/ORDER BY lower\(COALESCE\(f\.name, ''\)\), f\.portfolio_id/i);
    for (const key of ["items", "limit", "offset", "returned", "total"]) {
      expect(LIST).toContain(`'${key}',`);
    }
  });

  it("decrypts searchable protected name server-side", () => {
    expect(LIST).toMatch(/public\.btpm_decrypt\(pi\.name, pi\.organization_id\) AS name/i);
    expect(LIST).toMatch(/position\(lower\(_search_trimmed\) IN lower\(COALESCE\(e\.name, ''\)\)\)/i);
  });
});

describe("API-Q Portfolio-1 detail wrapper", () => {
  it("derives Organization from Portfolio identity and requires the exact read grant", () => {
    expect(DETAIL).toMatch(/_expected_oauth_client_id text/i);
    expect(DETAIL).toMatch(/_portfolio_item_id uuid/i);
    expect(DETAIL).toMatch(/FROM public\.portfolio_items pi/i);
    expect(DETAIL).toMatch(/JOIN public\.organizations o/i);
    expect(DETAIL).toMatch(/o\.id = pi\.organization_id/i);
    expect(DETAIL).toMatch(/g\.capability_key = 'portfolios:read'/i);
    expect(DETAIL).toMatch(/om\.role::text = 'org_admin'/i);
  });

  it("fails closed non-enumerably", () => {
    expect(DETAIL).toMatch(/IF _result IS NULL THEN[\s\S]*RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/i);
  });

  it("returns the approved detail projection and decrypts protected description", () => {
    for (const field of [
      "portfolioId", "organizationId", "name", "code", "description",
      "lifecycleState", "strategicPriority", "ownerId", "isArchived",
      "archivedAt", "createdAt", "updatedAt",
    ]) expect(DETAIL).toContain(`'${field}',`);
    expect(DETAIL).toMatch(/btpm_decrypt\(pi\.description, pi\.organization_id\)/i);
    expect(DETAIL).not.toContain("'createdBy'");
    expect(DETAIL).not.toContain("'updatedBy'");
  });
});

describe("API-Q Portfolio-1 privileges", () => {
  it("revokes PUBLIC and exposes wrappers only to trusted runtime roles", () => {
    for (const acl of [LIST_ACL, DETAIL_ACL]) {
      expect(acl).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
      expect(acl).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+authenticated/i);
      expect(acl).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+anon/i);
    }
  });

  it("uses no dynamic SQL or generic dispatch", () => {
    expect(LIST + DETAIL).not.toMatch(/\bEXECUTE\s+format/i);
    expect(LIST + DETAIL).not.toMatch(/regprocedure/i);
  });
});
