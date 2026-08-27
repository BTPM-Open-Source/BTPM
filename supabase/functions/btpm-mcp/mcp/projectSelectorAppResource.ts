// API-Q.PS.1 — Universal Project Selector: MCP Apps resource foundation.
//
// This module owns the single MCP Apps UI resource that will later host the
// universal BTPM Workspace -> Project selector. It deliberately contains NO
// BTPM business behavior: no Supabase client, no SQL, no RPC, no Workspace or
// Project discovery, no selection validation and no tool registration.
//
// Scope of this step:
//   * the stable resource URI constant;
//   * the MCP Apps MIME type usage (via the pinned MCP Apps server helper);
//   * the committed, generated single-file HTML App document (PS.3);
//   * registration of that resource on a supplied McpServer.
//
// `serverFactory.ts` remains responsible for composition only.

import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "npm:@modelcontextprotocol/ext-apps@1.7.5/server";

import { BTPM_PROJECT_SELECTOR_GENERATED_HTML } from "./projectSelectorAppHtml.generated.ts";

/** Stable MCP Apps resource URI for the universal BTPM Project selector. */
export const BTPM_PROJECT_SELECTOR_RESOURCE_URI = "ui://btpm/project-selector";

/** Human-readable resource name advertised in `resources/list`. */
export const BTPM_PROJECT_SELECTOR_RESOURCE_NAME = "BTPM Project Selector";

/** MCP Apps MIME type: exactly `text/html;profile=mcp-app`. */
export const BTPM_PROJECT_SELECTOR_RESOURCE_MIME_TYPE = RESOURCE_MIME_TYPE;

/**
 * Deny-by-default MCP Apps resource metadata.
 *
 * Every CSP domain list is explicitly empty and no browser/device permission is
 * requested. This step performs no widget-origin network call, so no host CORS
 * or dedicated-origin configuration is declared either.
 */
export const BTPM_PROJECT_SELECTOR_RESOURCE_META = Object.freeze({
  ui: Object.freeze({
    csp: Object.freeze({
      connectDomains: Object.freeze([]) as unknown as string[],
      resourceDomains: Object.freeze([]) as unknown as string[],
      frameDomains: Object.freeze([]) as unknown as string[],
      baseUriDomains: Object.freeze([]) as unknown as string[],
    }),
    permissions: Object.freeze({}),
  }),
});

/**
 * Complete, built single-file Project-selector HTML document.
 *
 * The document is produced by the dedicated widget build
 * (`npm run build:project-selector-app`) and committed as a generated
 * TypeScript module, so this Edge Function performs no runtime Vite build and
 * no runtime filesystem read. All widget JavaScript and CSS is inlined; there
 * is no external script, stylesheet, font, image or other network asset, no
 * storage API, no dynamic innerHTML, no secret and no Tenant identifier.
 */
export const BTPM_PROJECT_SELECTOR_RESOURCE_HTML =
  BTPM_PROJECT_SELECTOR_GENERATED_HTML;

/**
 * Minimal structural surface required from the MCP server for registration.
 * Keeping this narrow avoids coupling this module to the full server type.
 */
type AppResourceCapableServer = Parameters<typeof registerAppResource>[0];

/**
 * Registers the single BTPM Project-selector MCP Apps resource on the supplied
 * per-request MCP server. Returns nothing meaningful: registration only.
 */
export function registerBtpmProjectSelectorAppResource(
  server: AppResourceCapableServer,
): void {
  registerAppResource(
    server,
    BTPM_PROJECT_SELECTOR_RESOURCE_NAME,
    BTPM_PROJECT_SELECTOR_RESOURCE_URI,
    {
      // The MCP Apps helper defaults the listing MIME type to
      // RESOURCE_MIME_TYPE (`text/html;profile=mcp-app`).
      _meta: BTPM_PROJECT_SELECTOR_RESOURCE_META,
    },
    () => ({
      contents: [
        {
          uri: BTPM_PROJECT_SELECTOR_RESOURCE_URI,
          mimeType: BTPM_PROJECT_SELECTOR_RESOURCE_MIME_TYPE,
          text: BTPM_PROJECT_SELECTOR_RESOURCE_HTML,
          _meta: BTPM_PROJECT_SELECTOR_RESOURCE_META,
        },
      ],
    }),
  );
}
