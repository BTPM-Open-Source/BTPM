/**
 * API-ADM-ME-1 — current-state guard for generic administration of Me reads.
 *
 * The OSS baseline has no migration chronology to preserve. This guard locks
 * the final generic administration/runtime behaviour without requiring the
 * historical migration that flipped the catalogue metadata.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentFunction } from "./ossSqlContract";

const ORG_TRANSITION = currentFunction("api_g_5_7_admin_transition_organization_client_capability");
const ME = currentFunction("api_v1_get_me");
const ADMIN_DIR = resolve(__dirname, "../pages/admin");
const ORG_MODEL = readFileSync(resolve(ADMIN_DIR, "connectedAppOrganizationPermissionsModel.ts"), "utf8");
const PROJECT = readFileSync(resolve(ADMIN_DIR, "ConnectedAppProjectAccess.tsx"), "utf8");
const REGISTRY = readFileSync(
  resolve(__dirname, "../../supabase/functions/btpm-mcp/mcp/toolRegistry.ts"),
  "utf8",
);

describe("API-ADM-ME-1 generic Organization capability administration", () => {
  it("requires enabled support, active catalogue, administrator assignability and Organization scope", () => {
    for (const token of [
      "s.lifecycle_status = 'enabled'", "cat.lifecycle_status = 'active'",
      "cat.administrator_assignable = true", "cat.scope_level = 'organization'",
    ]) expect(ORG_TRANSITION).toContain(token);
  });

  it("remains capability-generic with no me:read special branch", () => {
    expect(ORG_TRANSITION).not.toContain("me:read");
    expect(ORG_TRANSITION).not.toContain("btpm_get_me");
    expect(ORG_MODEL).not.toContain("me:read");
  });

  it("auto-provisions no supported-capability or grant inside the transition path", () => {
    expect(ORG_TRANSITION).not.toMatch(/INSERT\s+INTO\s+public\.api_client_supported_capabilities/i);
    expect(ORG_TRANSITION).not.toMatch(/INSERT\s+INTO\s+public\.api_organization_client_enablements/i);
  });

  it("keeps Project access capability-toggle-free", () => {
    expect(PROJECT).not.toContain("api_capability_grants");
    expect(PROJECT).not.toContain("capability_key");
  });
});

describe("API-ADM-ME-1 Me runtime and MCP exposure", () => {
  it("runtime requires the Organization-level me:read grant", () => {
    expect(ME).toContain("capability_key = 'me:read'");
    expect(ME).toContain("api_organization_client_enablements");
    expect(ME).toContain("api_capability_grants");
    expect(ME).toMatch(/workspace_id\s+IS\s+NULL/i);
  });

  it("MCP still exposes me.get as btpm_get_me", () => {
    const start = REGISTRY.indexOf('operationId: "me.get"');
    expect(start).toBeGreaterThan(-1);
    const entry = REGISTRY.slice(start, start + 600);
    expect(entry).toContain('toolName: "btpm_get_me"');
    expect(entry).toContain('exposure: "exposed"');
  });
});
