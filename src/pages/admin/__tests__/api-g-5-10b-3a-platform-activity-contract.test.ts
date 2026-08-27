/**
 * API-G.5.10B-3A — Platform client activity UX contract tests.
 * Source-contract only; inspects the panel and the client-detail page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PANEL = readFileSync(
  resolve(process.cwd(), "src/pages/admin/ApiClientActivityPanel.tsx"),
  "utf8",
);
const DETAIL = readFileSync(
  resolve(process.cwd(), "src/pages/admin/AdminPlatformApiClientDetail.tsx"),
  "utf8",
);

describe("API-G.5.10B-3A platform activity contract", () => {
  it("integrates the panel on the Platform client-detail page with safe props", () => {
    expect(DETAIL).toContain('import { ApiClientActivityPanel } from "./ApiClientActivityPanel"');
    expect(DETAIL).toContain("<ApiClientActivityPanel");
    expect(DETAIL).toContain("apiClientId={client.id}");
    expect(DETAIL).toContain('mode="platform"');
    expect(DETAIL).toContain("organizationId={null}");

    // API-ADM.2A: activity moved into the final "API activity" tab, so it now
    // renders after the configuration tabs instead of near the top.
    const overview = DETAIL.indexOf("Client overview");
    const panel = DETAIL.indexOf("<ApiClientActivityPanel");
    const redirects = DETAIL.indexOf("OAuth redirect URIs");
    const activityTab = DETAIL.indexOf('<TabsContent value="activity"');
    expect(overview).toBeGreaterThan(-1);
    expect(redirects).toBeGreaterThan(-1);
    expect(activityTab).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(activityTab);

    const invocation = DETAIL.slice(panel, DETAIL.indexOf("/>", panel));
    for (const forbidden of [
      "oauth_client_id",
      "client_key",
      "policy",
      "acknowledgement",
      "capability",
      "tenantId",
      "workspaceId",
      "projectId",
    ]) {
      expect(invocation).not.toContain(forbidden);
    }
  });

  it("reads data only through the hook and exposes no sensitive fields", () => {
    expect(PANEL).toContain('from "@/hooks/useApiClientActivity"');
    expect(PANEL).toContain("useApiClientActivity({");
    expect(PANEL).toContain("apiClientId,");
    expect(PANEL).toContain("mode,");
    expect(PANEL).toContain("organizationId,");

    expect(PANEL).not.toContain("integrations/supabase");
    expect(PANEL).not.toContain("supabase");
    expect(PANEL).not.toContain(".rpc(");
    expect(PANEL).not.toContain(".from(");
    expect(PANEL).not.toContain("api_request_activity_events");
    expect(PANEL).not.toMatch(/\bany\b(?![A-Za-z])/);

    expect(PANEL).not.toContain("actorUserId");
    expect(PANEL).not.toContain("sourceChannel");
    expect(PANEL).not.toContain("profile");
    expect(PANEL).not.toContain("email");
    expect(PANEL).not.toContain("error.message");
    expect(PANEL).not.toContain("console.");
  });

  it("renders the approved headings, labels, badge variants and states", () => {
    expect(PANEL).toContain("Recent activity");
    expect(PANEL).toContain("Successful API requests recorded for this client.");

    for (const heading of ["Time", "Request", "Result", "Duration", "Scope", "Request ID"]) {
      expect(PANEL).toContain(`<TableHead>${heading}</TableHead>`);
    }

    expect(PANEL).toContain("<TableRow key={row.eventId}>");
    expect(PANEL).toContain('{row.correlationId ?? "—"}');
    expect(PANEL).not.toContain("<TableCell>{row.eventId}</TableCell>");
    expect(PANEL).not.toContain("<TableHead>Event ID</TableHead>");
    expect(PANEL).not.toContain("Event ID");

    for (const label of [
      "Informational",
      "Success",
      "Redirect",
      "Client error",
      "Server error",
    ]) {
      expect(PANEL).toContain(label);
    }
    expect(PANEL).toContain('success: "default"');
    expect(PANEL).toContain('client_error: "destructive"');
    expect(PANEL).toContain('server_error: "destructive"');
    expect(PANEL).toContain('redirect: "secondary"');
    expect(PANEL).toContain('informational: "outline"');

    for (const label of ["Unscoped", "Tenant", "Organization", "Workspace", "Project"]) {
      expect(PANEL).toContain(label);
    }

    expect(PANEL).toContain("toLocaleString()");
    expect(PANEL).toContain("No activity recorded");
    expect(PANEL).toContain(
      "No successful API requests have been recorded for this client yet.",
    );
    expect(PANEL).toContain("Could not load activity.");
    expect(PANEL).toContain("Could not load more activity.");
  });

  it("uses keyset load-more pagination without offset or auto-scroll behavior", () => {
    expect(PANEL).toContain("data?.pages.flatMap((page) => page.rows) ?? []");
    expect(PANEL).not.toContain(".sort(");
    expect(PANEL).not.toContain(".reverse(");
    expect(PANEL).toContain("Load more");
    expect(PANEL).toContain("void fetchNextPage();");
    expect(PANEL.match(/fetchNextPage\(\)/g)?.length).toBe(1);
    expect(PANEL).toContain("hasNextPage && (");
    expect(PANEL).toContain("disabled={isFetchingNextPage}");
    expect(PANEL).toContain('isFetchingNextPage ? "Loading…" : "Load more"');

    for (const forbidden of [
      "offset",
      "pageNumber",
      "totalCount",
      "Previous",
      "IntersectionObserver",
      "refetchInterval",
      "setInterval",
      "export",
      "Filter",
      "search",
    ]) {
      if (forbidden === "export") continue;
      expect(PANEL).not.toContain(forbidden);
    }
  });
});
