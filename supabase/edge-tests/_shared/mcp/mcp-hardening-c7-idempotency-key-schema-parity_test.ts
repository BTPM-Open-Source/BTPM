// MCP-HARDENING-C7 — canonical idempotency-key MCP schema discoverability.
//
// Proves that every exposed canonical MCP mutation advertises the single shared
// presentation schema `MCP_IDEMPOTENCY_KEY_SCHEMA`, that this schema is derived
// from the canonical exported API-F `IDEMPOTENCY_KEY_PATTERN`, and that its
// accept/reject/normalization behavior is exactly equivalent to the canonical
// `validateIdempotencyKey`. The exposed-mutation inventory is DERIVED from
// `MCP_TOOL_REGISTRY` at execution time; no mutation list or count is stored
// here, and no idempotency regex is copied. No network, no database, no Edge
// invocation, no service-role key.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { z } from "npm:zod@4.4.3";

import {
  IDEMPOTENCY_KEY_PATTERN,
  validateIdempotencyKey,
} from "../../../functions/_shared/btpm-api/idempotency.ts";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "../../../functions/btpm-mcp/mcp/idempotencyKeySchema.ts";
import { MCP_TOOL_REGISTRY } from "../../../functions/btpm-mcp/mcp/toolRegistry.ts";

const MCP_DIRECTORY = new URL("../../../functions/btpm-mcp/mcp/", import.meta.url);

// ---------------------------------------------------------------------------
// A. Canonical authority reuse
// ---------------------------------------------------------------------------

Deno.test("C7-A1: the canonical idempotency pattern is exported and unchanged in shape", () => {
  assert(IDEMPOTENCY_KEY_PATTERN instanceof RegExp);
  // The canonical pattern carries the normalized length bound itself.
  assert(IDEMPOTENCY_KEY_PATTERN.source.includes("{1,255}"));
});

/** Removes line and block comments so documentation prose is not policy. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

Deno.test("C7-A2: no second idempotency regex or length policy exists in MCP production modules", async () => {
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(MCP_DIRECTORY)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".generated.ts")) continue;
    const source = stripComments(
      await Deno.readTextFile(new URL(entry.name, MCP_DIRECTORY)),
    );
    if (/255/.test(source)) offenders.push(`${entry.name}: literal 255`);
    if (/A-Za-z0-9\._~/.test(source)) {
      offenders.push(`${entry.name}: duplicated idempotency character class`);
    }
    if (/IDEMPOTENCY_KEY_PATTERN\s*=/.test(source)) {
      offenders.push(`${entry.name}: redeclared IDEMPOTENCY_KEY_PATTERN`);
    }
  }
  assertEquals(offenders, []);
});

// ---------------------------------------------------------------------------
// B / C / D. Parity with the canonical validator
// ---------------------------------------------------------------------------

const VALID_RAW_KEYS: ReadonlyArray<string> = [
  "a",
  "abc-123",
  "A.b_c~d:e@f/g+h!i=j-k",
  "x".repeat(255),
  "  abc-123  ",
];

const INVALID_RAW_VALUES: ReadonlyArray<unknown> = [
  "",
  "   ",
  "\t\n",
  "x".repeat(256),
  "abc 123",
  "abc\t123",
  "abc\n123",
  "abcé",
  "abc?123",
  "abc#123",
  "abc&123",
  null,
  undefined,
  42,
  {},
  ["abc"],
];

function canonicalOutcome(raw: unknown): { ok: boolean; value?: string } {
  try {
    return { ok: true, value: validateIdempotencyKey(raw) };
  } catch {
    return { ok: false };
  }
}

Deno.test("C7-B: valid keys parse identically through the MCP schema and the canonical validator", () => {
  for (const raw of VALID_RAW_KEYS) {
    const canonical = canonicalOutcome(raw);
    assert(canonical.ok, `canonical validator rejected fixture ${raw}`);
    assertEquals(MCP_IDEMPOTENCY_KEY_SCHEMA.parse(raw), canonical.value);
  }
});

Deno.test("C7-C: invalid values are rejected by both the MCP schema and the canonical validator", () => {
  for (const raw of INVALID_RAW_VALUES) {
    assertFalse(
      canonicalOutcome(raw).ok,
      `canonical validator accepted fixture ${String(raw)}`,
    );
    const parsed = MCP_IDEMPOTENCY_KEY_SCHEMA.safeParse(raw);
    assertFalse(
      parsed.success,
      `MCP schema accepted invalid fixture ${String(raw)}`,
    );
  }
});

Deno.test("C7-C2: outer whitespace normalization is canonically equivalent", () => {
  const raw = "  abc-123  ";
  assertEquals(
    MCP_IDEMPOTENCY_KEY_SCHEMA.parse(raw),
    validateIdempotencyKey(raw),
  );
  assertEquals(MCP_IDEMPOTENCY_KEY_SCHEMA.parse(raw), "abc-123");
});

Deno.test("C7-D: the shared schema actually advertises the canonical pattern constraint", () => {
  // Behavioural discoverability proof: an unrestricted z.string() would accept
  // these, so a revert to z.string() fails this assertion.
  assertFalse(MCP_IDEMPOTENCY_KEY_SCHEMA.safeParse("abc?123").success);
  assertFalse(MCP_IDEMPOTENCY_KEY_SCHEMA.safeParse("").success);

  // Structural discoverability proof through the generated JSON schema.
  const jsonSchema = JSON.stringify(z.toJSONSchema(MCP_IDEMPOTENCY_KEY_SCHEMA));
  assert(
    jsonSchema.includes(IDEMPOTENCY_KEY_PATTERN.source),
    `canonical pattern is not advertised: ${jsonSchema}`,
  );
});

// ---------------------------------------------------------------------------
// E / F. Every exposed mutation uses the shared schema
// ---------------------------------------------------------------------------

interface DiscoveredTool {
  readonly toolName: string;
  readonly schema: z.ZodObject<Record<string, z.ZodTypeAny>>;
  readonly moduleName: string;
}

async function discoverMutationToolSchemas(): Promise<
  ReadonlyMap<string, DiscoveredTool>
> {
  const discovered = new Map<string, DiscoveredTool>();
  for await (const entry of Deno.readDir(MCP_DIRECTORY)) {
    if (!entry.isFile || !entry.name.endsWith("MutationTool.ts")) continue;
    const moduleUrl = new URL(entry.name, MCP_DIRECTORY);
    const module = await import(moduleUrl.href) as Record<string, unknown>;
    const toolNames = Object.entries(module).filter(([key, value]) =>
      key.endsWith("_TOOL_NAME") && typeof value === "string"
    );
    const schemas = Object.entries(module).filter(([key, value]) =>
      key.endsWith("_TOOL_INPUT_SCHEMA") && value instanceof z.ZodType
    );
    assertEquals(
      toolNames.length,
      1,
      `${entry.name} must export exactly one tool name`,
    );
    assertEquals(
      schemas.length,
      1,
      `${entry.name} must export exactly one input schema`,
    );
    discovered.set(toolNames[0][1] as string, {
      toolName: toolNames[0][1] as string,
      schema: schemas[0][1] as z.ZodObject<Record<string, z.ZodTypeAny>>,
      moduleName: entry.name,
    });
  }
  return discovered;
}

Deno.test("C7-E: every exposed registry mutation uses the shared idempotency schema", async () => {
  const exposedMutations = MCP_TOOL_REGISTRY.filter(
    (tool) => tool.operationClass === "mutation" && tool.exposure === "exposed",
  );
  assert(
    exposedMutations.length > 0,
    "the canonical registry must expose at least one mutation",
  );

  const discovered = await discoverMutationToolSchemas();
  const uncovered: string[] = [];

  for (const mutation of exposedMutations) {
    const tool = discovered.get(mutation.toolName);
    if (tool === undefined) {
      uncovered.push(`${mutation.toolName}: no mutation tool module found`);
      continue;
    }
    const field = tool.schema.shape.idempotencyKey;
    if (field === undefined) {
      uncovered.push(`${mutation.toolName}: no idempotencyKey argument`);
      continue;
    }
    if (field !== MCP_IDEMPOTENCY_KEY_SCHEMA) {
      uncovered.push(
        `${mutation.toolName}: idempotencyKey is not the shared canonical schema`,
      );
    }
  }

  assertEquals(uncovered, []);
  console.log(
    `C7: exposed mutations derived from registry = ${exposedMutations.length}`,
  );
});

Deno.test("C7-F: no exposed mutation advertises a generic idempotency string", async () => {
  const exposedToolNames = new Set(
    MCP_TOOL_REGISTRY.filter((tool) =>
      tool.operationClass === "mutation" && tool.exposure === "exposed"
    ).map((tool) => tool.toolName),
  );
  const discovered = await discoverMutationToolSchemas();
  for (const [toolName, tool] of discovered) {
    if (!exposedToolNames.has(toolName)) continue;
    const field = tool.schema.shape.idempotencyKey as z.ZodTypeAny;
    // A generic string schema would accept an illegal-character key.
    assertFalse(
      field.safeParse("abc?123").success,
      `${toolName} (${tool.moduleName}) accepts a non-canonical idempotency key`,
    );
  }
});

// ---------------------------------------------------------------------------
// G. Read tools unaffected
// ---------------------------------------------------------------------------

Deno.test("C7-G: no read tool module gains an idempotencyKey argument", async () => {
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(MCP_DIRECTORY)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    if (!/ReadTool(s)?\.ts$/.test(entry.name)) continue;
    const source = await Deno.readTextFile(new URL(entry.name, MCP_DIRECTORY));
    if (source.includes("idempotencyKey")) offenders.push(entry.name);
  }
  assertEquals(offenders, []);
});
