/**
 * API-G.5.10B-3B — Organization Connected Apps activity UX contract tests.
 *
 * Step API-ADM.6B removed the obsolete organization activity dialog; activity is
 * now reachable only through the unified management view, which renders the
 * accepted `ApiClientActivityPanel` in Organization mode. Source-contract only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const LIST = readFileSync(
  resolve(process.cwd(), "src/pages/admin/ConnectedAppsOrganizationSurface.tsx"),
  "utf8",
);
const SHELL = readFileSync(
  resolve(process.cwd(), "src/pages/admin/ConnectedAppManagementView.tsx"),
  "utf8",
);
const PANEL = readFileSync(
  resolve(process.cwd(), "src/pages/admin/ApiClientActivityPanel.tsx"),
  "utf8",
);

describe("API-G.5.10B-3B Organization activity contract", () => {
  it("API-ADM.6A — the legacy Activity row action is retired from the list", () => {
    expect(LIST).not.toContain("openActivity");
    expect(LIST).not.toContain("setActivitySelection");
    expect(LIST).not.toContain("<ConnectedAppActivityDialog");
    expect(LIST).not.toContain("View scope");
    expect(LIST).not.toContain("Capabilities");
  });

  it("API-ADM.6B — the obsolete activity dialog no longer exists", () => {
    expect(
      existsSync(resolve(process.cwd(), "src/pages/admin/ConnectedAppActivityDialog.tsx")),
    ).toBe(false);
    expect(LIST).not.toContain("ConnectedAppActivityDialog");
    expect(SHELL).not.toContain("ConnectedAppActivityDialog");
  });

  it("API-ADM.6A — activity is reachable only through the unified management view", () => {
    expect(LIST).toContain("<ConnectedAppManagementView");
    expect(LIST).toContain("}, [organizationId]);");
  });

  it("renders the panel in Organization mode with an explicit Organization", () => {
    expect(SHELL).toContain(
      'import { ApiClientActivityPanel } from "./ApiClientActivityPanel"',
    );
    expect(SHELL).toContain("<ApiClientActivityPanel");
    expect(SHELL).toContain("apiClientId={app.apiClientId}");
    expect(SHELL).toContain('mode="organization"');
    expect(SHELL).toContain("organizationId={organizationId}");
    expect(SHELL).toContain('value="activity"');

    expect(SHELL).not.toContain("supabase");
    expect(SHELL).not.toContain(".rpc(");
    expect(SHELL).not.toContain(".from(");
    expect(SHELL).not.toContain("useApiClientActivity");
    expect(SHELL).not.toContain("useQuery");
    expect(SHELL).not.toContain("useMutation");
  });

  it("keeps mode-aware copy and preserves all Platform panel behavior", () => {
    expect(PANEL).toContain("Successful API requests attributed to this Organization.");
    expect(PANEL).toContain(
      "No successful API requests have been attributed to this Organization yet.",
    );
    expect(PANEL).toContain("Successful API requests recorded for this client.");
    expect(PANEL).toContain(
      "No successful API requests have been recorded for this client yet.",
    );
    expect(PANEL).toContain('mode === "organization"');
    expect(PANEL).toContain("Recent activity");

    expect(PANEL).toContain("key={row.eventId}");
    expect(PANEL).toContain('{row.correlationId ?? "—"}');
    expect(PANEL).toContain("Load more");
    expect(PANEL).toContain("void fetchNextPage();");
    expect(PANEL).toContain("hasNextPage && (");
    expect(PANEL).toContain("Could not load activity.");
    expect(PANEL).toContain("Could not load more activity.");
    expect(PANEL).toContain("No activity recorded");
  });
});
