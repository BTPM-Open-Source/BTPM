// Phase 4D.14A.7C.1 — Unit tests for shared SharePoint binding validation.
// No live Microsoft, Supabase, or Vault calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  matchWorkspaceLibrary,
  SHAREPOINT_BINDING_PUBLIC_NOTES,
  type SharePointBindingValidationCode,
  transportToBindingCode,
  validateProjectBindingAgainstRuntime,
} from "../../functions/_shared/sharePointBindingValidation.ts";
import type { SharePointRuntimeConfig } from "../../functions/_shared/tenantSharePoint.ts";

const RUNTIME: SharePointRuntimeConfig = {
  tenantId: "tenant",
  organizationId: "org",
  integrationId: "int",
  integrationName: "default",
  siteUrl: {
    href: "https://contoso.sharepoint.com/sites/btpm",
    hostname: "contoso.sharepoint.com",
    path: "/sites/btpm",
    isRootSite: false,
  },
  siteId: null,
};

// ---------- Public notes / code contract ----------

Deno.test("workspace_binding_not_validated code exists with safe note", () => {
  const code: SharePointBindingValidationCode = "workspace_binding_not_validated";
  assertEquals(
    SHAREPOINT_BINDING_PUBLIC_NOTES[code],
    "Validate the workspace SharePoint library binding before validating the project folder.",
  );
});

Deno.test("public notes never leak URLs or IDs", () => {
  for (const note of Object.values(SHAREPOINT_BINDING_PUBLIC_NOTES)) {
    assert(!/https?:\/\//.test(note), `note leaks a URL: ${note}`);
    assert(!/[0-9a-f]{8}-[0-9a-f]{4}/i.test(note), `note leaks an ID: ${note}`);
  }
});

// ---------- Library matching ----------

Deno.test("matchWorkspaceLibrary exact match wins", () => {
  const r = matchWorkspaceLibrary(
    [
      { id: "d1", webUrl: "https://contoso.sharepoint.com/sites/btpm/Docs" },
      { id: "d2", webUrl: "https://contoso.sharepoint.com/sites/btpm/Other" },
    ],
    "https://contoso.sharepoint.com/sites/btpm/Docs",
  );
  assertEquals(r.status, "ok");
  assertEquals(r.drive?.id, "d1");
});

Deno.test("matchWorkspaceLibrary ambiguous match", () => {
  const r = matchWorkspaceLibrary(
    [
      { id: "d1", webUrl: "https://contoso.sharepoint.com/sites/btpm/Docs" },
      { id: "d2", webUrl: "https://contoso.sharepoint.com/sites/btpm/Docs" },
    ],
    "https://contoso.sharepoint.com/sites/btpm/Docs",
  );
  assertEquals(r.status, "ambiguous");
});

Deno.test("matchWorkspaceLibrary not-found returns not_found", () => {
  const r = matchWorkspaceLibrary(
    [{ id: "d1", webUrl: "https://contoso.sharepoint.com/sites/btpm/Docs" }],
    "https://contoso.sharepoint.com/sites/btpm/Missing",
  );
  assertEquals(r.status, "not_found");
});

// ---------- Transport → binding-code mapping ----------

Deno.test("transportToBindingCode maps token_rejected to graph_not_configured", () => {
  assertEquals(
    transportToBindingCode("token_rejected", "site"),
    "sharepoint_graph_not_configured",
  );
});

Deno.test("transportToBindingCode maps timeout and rate_limited safely", () => {
  assertEquals(transportToBindingCode("timeout", "site"), "sharepoint_timeout");
  assertEquals(
    transportToBindingCode("rate_limited", "libraries"),
    "sharepoint_unavailable",
  );
});

// ---------- Project binding default-mode workspace validation gate ----------

async function runProjectDefault(
  wb: { binding_status: string | null; site_web_url: string | null; library_web_url: string | null } | null,
) {
  return await validateProjectBindingAgainstRuntime({
    accessToken: "unused",
    requestId: "req",
    runtime: RUNTIME,
    // fetchImpl must never be called for this contract path.
    fetchImpl: (() => {
      throw new Error("fetch must not be called before workspace-binding gate");
    }) as unknown as typeof fetch,
    binding: {
      binding_mode: "workspace_library_default",
      folder_web_url: "https://contoso.sharepoint.com/sites/btpm/Docs/Proj",
      resolved_site_web_url: null,
      resolved_library_web_url: null,
    },
    workspaceBinding: wb,
  });
}

Deno.test("project default mode rejects null workspace binding", async () => {
  const r = await runProjectDefault(null);
  assertEquals(r.code, "workspace_binding_not_validated");
  assertEquals(r.status, "invalid");
});

Deno.test("project default mode rejects configured_unvalidated workspace binding", async () => {
  const r = await runProjectDefault({
    binding_status: "configured_unvalidated",
    site_web_url: "https://contoso.sharepoint.com/sites/btpm",
    library_web_url: "https://contoso.sharepoint.com/sites/btpm/Docs",
  });
  assertEquals(r.code, "workspace_binding_not_validated");
});

Deno.test("project default mode rejects invalid workspace binding", async () => {
  const r = await runProjectDefault({
    binding_status: "invalid",
    site_web_url: "https://contoso.sharepoint.com/sites/btpm",
    library_web_url: "https://contoso.sharepoint.com/sites/btpm/Docs",
  });
  assertEquals(r.code, "workspace_binding_not_validated");
});

Deno.test("project default mode rejects disabled workspace binding", async () => {
  const r = await runProjectDefault({
    binding_status: "disabled",
    site_web_url: "https://contoso.sharepoint.com/sites/btpm",
    library_web_url: "https://contoso.sharepoint.com/sites/btpm/Docs",
  });
  assertEquals(r.code, "workspace_binding_not_validated");
});

Deno.test("project default mode rejects validated wb with missing library URL", async () => {
  const r = await runProjectDefault({
    binding_status: "validated",
    site_web_url: "https://contoso.sharepoint.com/sites/btpm",
    library_web_url: null,
  });
  assertEquals(r.code, "workspace_binding_not_validated");
});

// ---------- Restricted-site outside Tenant SharePoint ----------

Deno.test("restricted_site_override outside Tenant site is rejected safely", async () => {
  const r = await validateProjectBindingAgainstRuntime({
    accessToken: "unused",
    requestId: "req",
    runtime: RUNTIME,
    fetchImpl: (() => {
      throw new Error("fetch must not be called for site mismatch");
    }) as unknown as typeof fetch,
    binding: {
      binding_mode: "restricted_site_override",
      folder_web_url: "https://other.sharepoint.com/sites/x/Docs/Proj",
      resolved_site_web_url: "https://other.sharepoint.com/sites/x",
      resolved_library_web_url: "https://other.sharepoint.com/sites/x/Docs",
    },
    workspaceBinding: null,
  });
  assertEquals(r.code, "restricted_site_outside_tenant_sharepoint");
});

// ---------- Configuration invalid guards ----------

Deno.test("project binding without folder URL is configuration_invalid", async () => {
  const r = await validateProjectBindingAgainstRuntime({
    accessToken: "unused",
    requestId: "req",
    runtime: RUNTIME,
    fetchImpl: (() => {
      throw new Error("fetch must not be called for missing folder");
    }) as unknown as typeof fetch,
    binding: {
      binding_mode: "workspace_library_default",
      folder_web_url: null,
      resolved_site_web_url: null,
      resolved_library_web_url: null,
    },
    workspaceBinding: {
      binding_status: "validated",
      site_web_url: RUNTIME.siteUrl.href,
      library_web_url: RUNTIME.siteUrl.href + "/Docs",
    },
  });
  assertEquals(r.code, "sharepoint_configuration_invalid");
});

Deno.test("unknown project binding mode is configuration_invalid", async () => {
  const r = await validateProjectBindingAgainstRuntime({
    accessToken: "unused",
    requestId: "req",
    runtime: RUNTIME,
    fetchImpl: (() => {
      throw new Error("fetch must not be called for unknown mode");
    }) as unknown as typeof fetch,
    binding: {
      binding_mode: "made_up_mode",
      folder_web_url: "https://contoso.sharepoint.com/sites/btpm/Docs/Proj",
      resolved_site_web_url: null,
      resolved_library_web_url: null,
    },
    workspaceBinding: null,
  });
  assertEquals(r.code, "sharepoint_configuration_invalid");
});
