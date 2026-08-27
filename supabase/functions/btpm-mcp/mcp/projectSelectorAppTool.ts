// API-Q.PS.2 — Universal Project Selector: MCP App bootstrap tool.
//
// ARCHITECTURE BOUNDARY
// ---------------------
// `MCP_TOOL_REGISTRY` governs canonical BTPM API-backed MCP tools only. The
// tool in this module is NOT a canonical BTPM API operation: it is an MCP Apps
// presentation/bootstrap operation whose only effect is to make an MCP
// Apps-capable host render the already accepted PS.1 resource
// `ui://btpm/project-selector`. It therefore has no canonical `operationId`,
// is deliberately absent from `MCP_TOOL_REGISTRY`, and is registered here
// through one explicit, narrow registration path — never through a generic
// MCP-App tool dispatcher.
//
// This module contains NO BTPM business behavior: no Supabase client, no RPC,
// no service-role credential, no table read, no mutation, no persistence, no
// authority-bearing identifier, no logging of user/project/token data, and no
// consumer-specific behavior. It is universal: any compatible
// agent connected to `btpm-mcp` may invoke it.
//
// It also does not duplicate the PS.1 resource HTML or CSP: only the resource
// URI constant is reused.

import { registerAppTool } from "npm:@modelcontextprotocol/ext-apps@1.7.5/server";

import { BTPM_PROJECT_SELECTOR_RESOURCE_URI } from "./projectSelectorAppResource.ts";

/** Exact MCP tool name for the universal Project-selector bootstrap. */
export const BTPM_PROJECT_SELECTOR_TOOL_NAME = "btpm_choose_project";

/** Human-readable tool title. */
export const BTPM_PROJECT_SELECTOR_TOOL_TITLE = "Choose BTPM Project";

/** Generic, consumer-neutral tool description. */
export const BTPM_PROJECT_SELECTOR_TOOL_DESCRIPTION =
  "Open the BTPM Workspace and Project selector when a Project must be selected or changed for the current conversation.";

/**
 * Empty input contract. The tool accepts an empty object only: no Tenant,
 * Organization, Workspace, Project or user identifier, no URL and no
 * persistence flag is accepted.
 */
export const BTPM_PROJECT_SELECTOR_TOOL_INPUT_SCHEMA = Object.freeze({});

/** Presentation hints only; never used as authorization logic. */
export const BTPM_PROJECT_SELECTOR_TOOL_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/**
 * MCP Apps UI linkage: the descriptor points at the single accepted PS.1
 * resource. No alternative URI is hardcoded and no second resource is created.
 */
export const BTPM_PROJECT_SELECTOR_TOOL_META = Object.freeze({
  ui: Object.freeze({ resourceUri: BTPM_PROJECT_SELECTOR_RESOURCE_URI }),
});

/** Bounded bootstrap structured result. Contains no business data. */
export const BTPM_PROJECT_SELECTOR_TOOL_STRUCTURED_CONTENT = Object.freeze({
  selector: "btpm_project",
  state: "ready",
});

/** Text fallback for hosts without MCP Apps rendering. */
export const BTPM_PROJECT_SELECTOR_TOOL_TEXT =
  "Choose a BTPM Workspace and Project using the Project selector.";

/** Minimal structural surface required from the MCP server for registration. */
type AppToolCapableServer = Parameters<typeof registerAppTool>[0];

/**
 * Registers the single universal MCP App Project-selector bootstrap tool on the
 * supplied per-request MCP server. Registration only: the callback resolves a
 * constant bounded result and performs no I/O.
 */
export function registerBtpmProjectSelectorAppTool(
  server: AppToolCapableServer,
): void {
  registerAppTool(
    server,
    BTPM_PROJECT_SELECTOR_TOOL_NAME,
    {
      title: BTPM_PROJECT_SELECTOR_TOOL_TITLE,
      description: BTPM_PROJECT_SELECTOR_TOOL_DESCRIPTION,
      inputSchema: BTPM_PROJECT_SELECTOR_TOOL_INPUT_SCHEMA,
      annotations: {
        title: BTPM_PROJECT_SELECTOR_TOOL_TITLE,
        ...BTPM_PROJECT_SELECTOR_TOOL_ANNOTATIONS,
      },
      _meta: BTPM_PROJECT_SELECTOR_TOOL_META,
    },
    () => ({
      content: [
        { type: "text" as const, text: BTPM_PROJECT_SELECTOR_TOOL_TEXT },
      ],
      structuredContent: { ...BTPM_PROJECT_SELECTOR_TOOL_STRUCTURED_CONTENT },
    }),
  );
}
