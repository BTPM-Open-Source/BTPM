// API-Q Portfolio-7 — MCP Registry Metadata Closure.
//
// Proves that the six canonical Portfolio API operations each carry exactly one
// declarative MCP registry entry with the correct durable metadata (tool name,
// operation class, confirmation, concurrency token, result shape), and that the
// coverage and tool-registry invariants hold.
//
// Portfolio-7 owns durable registry metadata only. Final MCP exposure state and
// runtime wiring for the Portfolio mutations are owned exclusively by their own
// exposure steps: Portfolio-9D (create), Portfolio-10D (update) and
// Portfolio-11D (assign_project). No exposure assertion belongs in this file.

import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  type McpToolMetadata,
  MCP_TOOL_REGISTRY,
  validateMcpRegistryCoverage,
  validateMcpToolRegistry,
} from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";


interface PortfolioCase {
  readonly operationId: string;
  readonly toolName: string;
  readonly operationClass: "read" | "mutation";
  readonly confirmation: "required" | "not_required";
  readonly resultShape: "bounded_collection" | "single_object";
  readonly concurrencyToken: "required" | "not_applicable";
}

const PORTFOLIO_CASES: readonly PortfolioCase[] = Object.freeze([
  {
    operationId: "portfolios.get",
    toolName: "btpm_list_portfolios",
    operationClass: "read",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  },
  {
    operationId: "portfolios.get_by_id",
    toolName: "btpm_get_portfolio",
    operationClass: "read",
    confirmation: "not_required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  },
  {
    operationId: "portfolios.projects.get",
    toolName: "btpm_list_portfolio_projects",
    operationClass: "read",
    confirmation: "not_required",
    resultShape: "bounded_collection",
    concurrencyToken: "not_applicable",
  },
  {
    operationId: "portfolios.create",
    toolName: "btpm_create_portfolio",
    operationClass: "mutation",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  },
  {
    operationId: "portfolios.update",
    toolName: "btpm_update_portfolio",
    operationClass: "mutation",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "required",
  },
  {
    operationId: "portfolios.assign_project",
    toolName: "btpm_assign_project_portfolio",
    operationClass: "mutation",
    confirmation: "required",
    resultShape: "single_object",
    concurrencyToken: "not_applicable",
  },
]);

function entryFor(operationId: string): McpToolMetadata {
  const matches = MCP_TOOL_REGISTRY.filter((e) => e.operationId === operationId);
  assertStrictEquals(matches.length, 1, `${operationId} must exist exactly once`);
  return matches[0];
}

Deno.test("Portfolio-7: each Portfolio operationId exists exactly once", () => {
  for (const c of PORTFOLIO_CASES) {
    const matches = MCP_TOOL_REGISTRY.filter((e) => e.operationId === c.operationId);
    assertStrictEquals(matches.length, 1, `${c.operationId} must appear exactly once`);
  }
});

Deno.test("Portfolio-7: exact tool names", () => {
  for (const c of PORTFOLIO_CASES) {
    assertStrictEquals(entryFor(c.operationId).toolName, c.toolName);
  }
});

Deno.test("Portfolio-7: exact operation classes — first three read, final three mutation", () => {
  const reads = PORTFOLIO_CASES.slice(0, 3);
  const mutations = PORTFOLIO_CASES.slice(3);
  for (const c of reads) {
    assertStrictEquals(entryFor(c.operationId).operationClass, "read", `${c.operationId} must be read`);
  }
  for (const c of mutations) {
    assertStrictEquals(entryFor(c.operationId).operationClass, "mutation", `${c.operationId} must be mutation`);
  }
});

Deno.test("Portfolio-7: read entries require no confirmation", () => {
  for (const c of PORTFOLIO_CASES.filter((x) => x.operationClass === "read")) {
    assertStrictEquals(entryFor(c.operationId).confirmation, "not_required", `${c.operationId} confirmation`);
  }
});

Deno.test("Portfolio-7: mutation entries require confirmation", () => {
  for (const c of PORTFOLIO_CASES.filter((x) => x.operationClass === "mutation")) {
    assertStrictEquals(entryFor(c.operationId).confirmation, "required", `${c.operationId} confirmation`);
  }
});

Deno.test("Portfolio-7: concurrency — portfolios.update required, all others not_applicable", () => {
  for (const c of PORTFOLIO_CASES) {
    assertStrictEquals(entryFor(c.operationId).concurrencyToken, c.concurrencyToken, `${c.operationId} concurrencyToken`);
  }
});

Deno.test("Portfolio-7: result shapes", () => {
  for (const c of PORTFOLIO_CASES) {
    assertStrictEquals(entryFor(c.operationId).resultShape, c.resultShape, `${c.operationId} resultShape`);
  }
});

Deno.test("Portfolio-7: validateMcpRegistryCoverage returns []", () => {
  assertEquals([...validateMcpRegistryCoverage(MCP_TOOL_REGISTRY)], []);
});

Deno.test("Portfolio-7: validateMcpToolRegistry returns []", () => {
  assertEquals([...validateMcpToolRegistry(MCP_TOOL_REGISTRY)], []);
});
