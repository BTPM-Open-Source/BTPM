// BTPM API v1 — permanent public-contract regression guard.
//
// This test binds the current public OpenAPI contract to the live runtime
// allowlist and /v1/capabilities payload. It is static and local: no network,
// database, secrets, Supabase client, or route execution is used.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse as parseYaml } from "https://deno.land/std@0.224.0/yaml/mod.ts";

import {
  API_V1_ROUTE_ALLOWLIST,
  type ApiRouteDefinition,
} from "../router.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";

const REPO_ROOT = new URL("../../../../", import.meta.url);
const OPENAPI_URL = new URL("docs/api/BTPM_API_V1_OPENAPI.yaml", REPO_ROOT);
const HTTP_MODULE_URL = new URL(
  "supabase/functions/_shared/btpm-api/http.ts",
  REPO_ROOT,
);
const CORS_MODULE_URL = new URL(
  "supabase/functions/_shared/btpm-api/cors.ts",
  REPO_ROOT,
);

const openApiText = await Deno.readTextFile(OPENAPI_URL);
const httpModuleText = await Deno.readTextFile(HTTP_MODULE_URL);
const corsModuleText = await Deno.readTextFile(CORS_MODULE_URL);

// deno-lint-ignore no-explicit-any
const openApi = parseYaml(openApiText) as any;

const HTTP_METHODS = ["get", "post", "patch", "put", "delete", "head"] as const;

interface DocumentedOperation {
  readonly path: string;
  readonly method: string;
  readonly operationId: string;
  // deno-lint-ignore no-explicit-any
  readonly operation: any;
}

function collectDocumentedOperations(): DocumentedOperation[] {
  const out: DocumentedOperation[] = [];
  for (const [path, item] of Object.entries(openApi.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      // deno-lint-ignore no-explicit-any
      const operation = (item as any)?.[method];
      if (operation === undefined) continue;
      assert(
        typeof operation.operationId === "string" && operation.operationId.length > 0,
        `missing operationId for ${method.toUpperCase()} ${path}`,
      );
      out.push({
        path,
        method: method.toUpperCase(),
        operationId: operation.operationId,
        operation,
      });
    }
  }
  return out;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].slice().sort();
}

function normalizePath(path: string): string {
  return path
    .replace(/:[A-Za-z0-9_]+/g, "{}")
    .replace(/\{[^}]+\}/g, "{}")
    .toLowerCase();
}

/** Codes and statuses declared by the shared HTTP error registry. */
function runtimeErrorRegistry(): Map<string, number> {
  const start = httpModuleText.indexOf("const CODE_TO_STATUS");
  assert(start > -1, "CODE_TO_STATUS not found in http.ts");
  const open = httpModuleText.indexOf("{", start);
  const close = httpModuleText.indexOf("};", open);
  assert(open > -1 && close > open, "CODE_TO_STATUS body not parseable");
  const body = httpModuleText.slice(open + 1, close);
  const map = new Map<string, number>();
  for (const line of body.split("\n")) {
    const match = /^\s*([a-z_]+)\s*:\s*(\d{3})\s*,\s*$/.exec(line);
    if (match) map.set(match[1], Number(match[2]));
  }
  assert(map.size > 0, "no error codes extracted from http.ts");
  return map;
}

const documentedOperations = collectDocumentedOperations();
const errorRegistry = runtimeErrorRegistry();
const documentedById = new Map(
  documentedOperations.map((operation) => [operation.operationId, operation]),
);

Deno.test("BTPM API public contract: OpenAPI covers the complete live route allowlist", () => {
  assertEquals(documentedOperations.length, API_V1_ROUTE_ALLOWLIST.length);
  assertEquals(
    sorted(documentedOperations.map((operation) => operation.operationId)),
    sorted(API_V1_ROUTE_ALLOWLIST.map((route) => route.id)),
  );
  assertEquals(
    new Set(documentedOperations.map((operation) => operation.operationId)).size,
    documentedOperations.length,
  );
});

Deno.test("BTPM API public contract: every OpenAPI path and method matches its live route", () => {
  for (const route of API_V1_ROUTE_ALLOWLIST) {
    const documented = documentedById.get(route.id);
    assert(documented !== undefined, `undocumented live operation: ${route.id}`);
    assertEquals(documented.method, route.method, `method drift: ${route.id}`);
    assertEquals(
      normalizePath(documented.path),
      normalizePath(route.path),
      `path drift: ${route.id}`,
    );
  }
});

Deno.test("BTPM API public contract: published counts match the current 50-operation topology", () => {
  const reads = API_V1_ROUTE_ALLOWLIST.filter((route) => route.operation === "read").length;
  const mutations = API_V1_ROUTE_ALLOWLIST.filter((route) => route.operation === "mutation").length;
  assertEquals(API_V1_ROUTE_ALLOWLIST.length, 50);
  assertEquals(reads, 24);
  assertEquals(mutations, 26);
  assertEquals(openApi.info["x-btpm-operation-count"], 50);
  assertEquals(openApi.info["x-btpm-read-operation-count"], 24);
  assertEquals(openApi.info["x-btpm-mutation-operation-count"], 26);
});

Deno.test("BTPM API public contract: OpenAPI capabilities enum equals the live capabilities payload", () => {
  const enumValues = openApi.components.schemas.CapabilitiesPayload
    .properties.supportedOperations.items.enum as string[];
  const advertised = buildCapabilitiesPayload().supportedOperations as string[];
  assertEquals(sorted(enumValues), sorted(advertised));
  assertEquals(sorted(advertised), sorted(API_V1_ROUTE_ALLOWLIST.map((route) => route.id)));
});

Deno.test("BTPM API public contract: OpenAPI error codes equal the shared HTTP registry", () => {
  const documentedCodes = openApi.components.schemas.ErrorEnvelope
    .properties.error.properties.code.enum as string[];
  assertEquals(sorted(documentedCodes), sorted(errorRegistry.keys()));
});

Deno.test("BTPM API public contract: every live mutation requires the canonical Idempotency-Key parameter", () => {
  for (const route of API_V1_ROUTE_ALLOWLIST) {
    if (route.operation !== "mutation") continue;
    const documented = documentedById.get(route.id);
    assert(documented !== undefined, `missing mutation ${route.id}`);
    // deno-lint-ignore no-explicit-any
    const refs = (documented.operation.parameters ?? []).map((parameter: any) =>
      parameter.$ref ?? parameter.name
    );
    assert(
      refs.includes("#/components/parameters/IdempotencyKey"),
      `mutation ${route.id} does not require Idempotency-Key`,
    );
  }
  assertEquals(openApi.components.parameters.IdempotencyKey.required, true);
});

Deno.test("BTPM API public contract: documented methods are transport-allowed", () => {
  const match = /const ALLOWED_METHODS\s*=\s*"([^"]+)"/.exec(corsModuleText);
  assert(match !== null, "ALLOWED_METHODS not found in cors.ts");
  const allowedMethods = match[1].split(",").map((method: string) => method.trim());
  for (const documented of documentedOperations) {
    assert(
      allowedMethods.includes(documented.method),
      `${documented.method} is documented but not transport-allowed`,
    );
  }
  assert(allowedMethods.includes("OPTIONS"), "preflight method must be allowed");
});

Deno.test("BTPM API public contract: no generic administrative or delete surface is published", () => {
  const forbiddenPathFragments = [
    "/v1/rpc",
    "/v1/commands",
    "/v1/command",
    "/v1/query",
    "/v1/sql",
    "/v1/batch",
    "/v1/graphql",
    "/v1/tables",
    "/v1/admin",
  ];
  for (const path of Object.keys(openApi.paths ?? {})) {
    for (const fragment of forbiddenPathFragments) {
      assert(!path.startsWith(fragment), `forbidden generic surface documented: ${path}`);
    }
  }
  for (const documented of documentedOperations) {
    assert(
      documented.method !== "DELETE",
      `delete surface is not part of the accepted v1 contract: ${documented.path}`,
    );
  }
});

Deno.test("BTPM API public contract: delegated bearer identity is the only published security scheme", () => {
  const schemes = openApi.components.securitySchemes;
  assertEquals(Object.keys(schemes), ["delegatedUserBearer"]);
  assertEquals(schemes.delegatedUserBearer.type, "http");
  assertEquals(schemes.delegatedUserBearer.scheme, "bearer");
  for (const forbidden of ["clientCredentials", "grant_type"]) {
    assert(
      !openApiText.includes(forbidden),
      `unsupported machine-identity grant property published: ${forbidden}`,
    );
  }
});

Deno.test("BTPM API public contract: no private deployment or company literal is published", () => {
  const lower = openApiText.toLowerCase();
  for (
    const forbidden of [
      "lovable.app",
      "lovableproject.com",
      "eyjhbGcioi",
    ]
  ) {
    assert(!lower.includes(forbidden), `private publication literal found: ${forbidden}`);
  }
});
