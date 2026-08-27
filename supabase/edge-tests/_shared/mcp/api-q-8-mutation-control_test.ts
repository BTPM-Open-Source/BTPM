// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../functions/btpm-mcp/mcp/api-q-8-mutation-control_test.ts', import.meta.url).href;
// API-Q.8 — Focused MCP mutation-control foundation tests.
//
// Pure/synthetic only. No database, RPC, network or environment access.

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMcpMutationExecutionContext,
  MCP_CONFIRMATION_FIELD,
  MCP_IDEMPOTENCY_KEY_FIELD,
  McpMutationControlError,
  requireMcpMutationConfirmation,
  validateMcpIdempotencyKey,
} from "../../../functions/btpm-mcp/mcp/mutationControl.ts";
import {
  hashCanonicalPayload,
  IdempotencyValidationError,
  validateIdempotencyKey,
} from "../../../functions/_shared/btpm-api/idempotency.ts";
import type { McpTrustedExecutionContext } from "../../../functions/btpm-mcp/mcp/buildMcpExecutionContext.ts";

const TRUSTED: McpTrustedExecutionContext = Object.freeze({
  requestedUserId: "user-1",
  executingUserId: "user-1",
  apiClientId: "api-client-1",
  oauthClientId: "oauth-client-1",
  policyVersionId: "policy-v1",
  requestId: "req-1",
  correlationId: "req-1",
  sourceChannel: "mcp",
  sourceClientId: "api-client-1",
  delegationMode: "delegated_user",
});

const PAYLOAD = Object.freeze({ projectId: "p-1", name: "Alpha" });

// -----------------------------------------------------------------------------
// (M/N) Confirmation semantics
// -----------------------------------------------------------------------------

Deno.test("API-Q.8 (M): literal true confirmation succeeds", () => {
  requireMcpMutationConfirmation(true);
});

Deno.test("API-Q.8 (N): every non-literal-true confirmation fails closed", () => {
  const rejected: unknown[] = [
    undefined,
    null,
    false,
    "true",
    "TRUE",
    "false",
    1,
    0,
    {},
    [],
    { confirmation: true },
    new Boolean(true),
  ];
  for (const value of rejected) {
    assertThrows(
      () => requireMcpMutationConfirmation(value),
      McpMutationControlError,
      "mcp_mutation_confirmation_required",
    );
  }
});

Deno.test("API-Q.8: control field names are exact, with no aliases", () => {
  assertStrictEquals(MCP_CONFIRMATION_FIELD, "confirmation");
  assertStrictEquals(MCP_IDEMPOTENCY_KEY_FIELD, "idempotencyKey");
  const source = Deno.readTextFileSync(
    new URL("./mutationControl.ts", __BTPM_SRC_BASE__),
  );
  // Aliases may only appear inside the documented rejection comment, never as
  // an accepted argument name.
  for (const alias of ["confirmed", "approve", "approved", "yes", "force"]) {
    assert(
      !source.includes(`"${alias}"`),
      `alias must not be an accepted literal: ${alias}`,
    );
  }
});

// -----------------------------------------------------------------------------
// (P/R/S) Canonical idempotency reuse
// -----------------------------------------------------------------------------

Deno.test("API-Q.8 (P): MCP idempotency validation is the canonical API-F validator", () => {
  for (const raw of ["abc._~:@/+!=-XYZ123", "  abc  ", "a".repeat(255)]) {
    assertStrictEquals(
      validateMcpIdempotencyKey(raw),
      validateIdempotencyKey(raw),
    );
  }
  for (const raw of [undefined, null, "", "   ", 1, {}, "a b", "a,b", "a".repeat(256)]) {
    let mcpCode: string | null = null;
    let canonicalCode: string | null = null;
    try {
      validateMcpIdempotencyKey(raw);
    } catch (error) {
      mcpCode = (error as IdempotencyValidationError).code;
    }
    try {
      validateIdempotencyKey(raw);
    } catch (error) {
      canonicalCode = (error as IdempotencyValidationError).code;
    }
    assert(mcpCode !== null, "MCP validation must fail closed");
    assertStrictEquals(mcpCode, canonicalCode);
  }
});

Deno.test("API-Q.8 (R): valid MCP key is preserved with canonical trimming", async () => {
  const context = await buildMcpMutationExecutionContext(
    TRUSTED,
    "  key-123  ",
    PAYLOAD,
  );
  assertStrictEquals(context.idempotencyKey, "key-123");
});

Deno.test("API-Q.8 (S): malformed MCP key fails before any context is produced", async () => {
  for (const raw of [undefined, null, "", "bad key", "a".repeat(256), 7]) {
    await assertRejects(
      () => buildMcpMutationExecutionContext(TRUSTED, raw, PAYLOAD),
      IdempotencyValidationError,
    );
  }
});

// -----------------------------------------------------------------------------
// (T/U/V/W) Payload-hash boundary
// -----------------------------------------------------------------------------

Deno.test("API-Q.8 (T): payloadHash equals hashCanonicalPayload(validated payload)", async () => {
  const context = await buildMcpMutationExecutionContext(
    TRUSTED,
    "key-1",
    PAYLOAD,
  );
  assertStrictEquals(context.payloadHash, await hashCanonicalPayload(PAYLOAD));
});

Deno.test("API-Q.8 (U): changing the business payload changes payloadHash", async () => {
  const a = await buildMcpMutationExecutionContext(TRUSTED, "key-1", PAYLOAD);
  const b = await buildMcpMutationExecutionContext(TRUSTED, "key-1", {
    ...PAYLOAD,
    name: "Beta",
  });
  assertNotEquals(a.payloadHash, b.payloadHash);
});

Deno.test("API-Q.8 (V/W): confirmation and idempotencyKey never affect payloadHash", async () => {
  const base = await buildMcpMutationExecutionContext(
    TRUSTED,
    "key-1",
    PAYLOAD,
  );
  const otherKey = await buildMcpMutationExecutionContext(
    TRUSTED,
    "key-2",
    PAYLOAD,
  );
  assertStrictEquals(base.payloadHash, otherKey.payloadHash);
  // Confirmation is not an input to the builder at all, so it is structurally
  // incapable of influencing the hash.
  assertStrictEquals(buildMcpMutationExecutionContext.length, 3);
});

// -----------------------------------------------------------------------------
// (O/X/Y/Z) Context contract
// -----------------------------------------------------------------------------

Deno.test("API-Q.8 (O/X/Y): context carries exactly the trusted fields plus mutation fields", async () => {
  const context = await buildMcpMutationExecutionContext(
    TRUSTED,
    "key-1",
    PAYLOAD,
  );
  assertEquals(Object.keys(context).sort(), [
    "apiClientId",
    "correlationId",
    "delegationMode",
    "executingUserId",
    "idempotencyKey",
    "oauthClientId",
    "payloadHash",
    "policyVersionId",
    "requestId",
    "requestedUserId",
    "sourceChannel",
    "sourceClientId",
  ]);
  assert(!("confirmation" in context), "confirmation must never be retained");
  assertStrictEquals(context.requestedUserId, TRUSTED.requestedUserId);
  assertStrictEquals(context.executingUserId, TRUSTED.executingUserId);
  assertStrictEquals(context.apiClientId, TRUSTED.apiClientId);
  assertStrictEquals(context.oauthClientId, TRUSTED.oauthClientId);
  assertStrictEquals(context.policyVersionId, TRUSTED.policyVersionId);
  assertStrictEquals(context.requestId, TRUSTED.requestId);
  assertStrictEquals(context.correlationId, TRUSTED.correlationId);
  assertStrictEquals(context.sourceClientId, TRUSTED.apiClientId);
  assertStrictEquals(context.sourceChannel, "mcp");
  assertStrictEquals(context.delegationMode, "delegated_user");
  assert(Object.isFrozen(context));
});

Deno.test("API-Q.8 (Z): malformed or non-MCP trusted contexts fail closed", async () => {
  const malformed: unknown[] = [
    null,
    undefined,
    {},
    { ...TRUSTED, sourceChannel: "external_api" },
    { ...TRUSTED, sourceChannel: "browser" },
    { ...TRUSTED, delegationMode: "service" },
    { ...TRUSTED, requestedUserId: "" },
    { ...TRUSTED, apiClientId: "   " },
    { ...TRUSTED, requestId: 5 },
  ];
  for (const candidate of malformed) {
    await assertRejects(
      () =>
        buildMcpMutationExecutionContext(
          candidate as McpTrustedExecutionContext,
          "key-1",
          PAYLOAD,
        ),
      McpMutationControlError,
      "mcp_mutation_context_invalid",
    );
  }
});

// -----------------------------------------------------------------------------
// (AD/AE/AF) API-Q.8-C1 — Internal identity/provenance consistency invariants
// -----------------------------------------------------------------------------

// A payload that is structurally incapable of passing canonical hashing
// (non-serializable). Proves the context inconsistency is the FIRST failure
// when the trusted context is internally inconsistent.
const UNHASHABLE_PAYLOAD: unknown = (() => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  return cyclic;
})();

Deno.test("API-Q.8-C1 (AD): requestedUserId !== executingUserId fails closed with mcp_mutation_context_invalid", async () => {
  const inconsistent: McpTrustedExecutionContext = {
    ...TRUSTED,
    executingUserId: "user-other",
  };
  await assertRejects(
    () => buildMcpMutationExecutionContext(inconsistent, "key-1", PAYLOAD),
    McpMutationControlError,
    "mcp_mutation_context_invalid",
  );
});

Deno.test("API-Q.8-C1 (AD-alt): inconsistent requestedUserId fails before idempotency validation and payload hashing", async () => {
  const inconsistent: McpTrustedExecutionContext = {
    ...TRUSTED,
    executingUserId: "user-other",
  };
  // An invalid idempotency key and an unhashable payload are supplied; the
  // context inconsistency must remain the first failure, so the bounded
  // mutation-control error is thrown rather than the canonical idempotency or
  // hashing error.
  await assertRejects(
    () => buildMcpMutationExecutionContext(inconsistent, "", UNHASHABLE_PAYLOAD),
    McpMutationControlError,
    "mcp_mutation_context_invalid",
  );
});

Deno.test("API-Q.8-C1 (AE): sourceClientId !== apiClientId fails closed with mcp_mutation_context_invalid", async () => {
  const inconsistent: McpTrustedExecutionContext = {
    ...TRUSTED,
    sourceClientId: "api-client-other",
  };
  await assertRejects(
    () => buildMcpMutationExecutionContext(inconsistent, "key-1", PAYLOAD),
    McpMutationControlError,
    "mcp_mutation_context_invalid",
  );
});

Deno.test("API-Q.8-C1 (AE-alt): inconsistent sourceClientId fails before idempotency validation and payload hashing", async () => {
  const inconsistent: McpTrustedExecutionContext = {
    ...TRUSTED,
    sourceClientId: "api-client-other",
  };
  await assertRejects(
    () => buildMcpMutationExecutionContext(inconsistent, "", UNHASHABLE_PAYLOAD),
    McpMutationControlError,
    "mcp_mutation_context_invalid",
  );
});

Deno.test("API-Q.8-C1 (AF): correlationId !== requestId fails closed with mcp_mutation_context_invalid", async () => {
  const inconsistent: McpTrustedExecutionContext = {
    ...TRUSTED,
    correlationId: "corr-other",
  };
  await assertRejects(
    () => buildMcpMutationExecutionContext(inconsistent, "key-1", PAYLOAD),
    McpMutationControlError,
    "mcp_mutation_context_invalid",
  );
});

Deno.test("API-Q.8-C1 (AF-alt): inconsistent correlationId fails before idempotency validation and payload hashing", async () => {
  const inconsistent: McpTrustedExecutionContext = {
    ...TRUSTED,
    correlationId: "corr-other",
  };
  await assertRejects(
    () => buildMcpMutationExecutionContext(inconsistent, "", UNHASHABLE_PAYLOAD),
    McpMutationControlError,
    "mcp_mutation_context_invalid",
  );
});

Deno.test("API-Q.8-C1: canonical valid trusted context still produces a frozen mutation context unchanged", async () => {
  const context = await buildMcpMutationExecutionContext(
    TRUSTED,
    "key-1",
    PAYLOAD,
  );
  assert(Object.isFrozen(context));
  assertStrictEquals(context.requestedUserId, TRUSTED.requestedUserId);
  assertStrictEquals(context.executingUserId, TRUSTED.executingUserId);
  assertStrictEquals(context.apiClientId, TRUSTED.apiClientId);
  assertStrictEquals(context.sourceClientId, TRUSTED.sourceClientId);
  assertStrictEquals(context.requestId, TRUSTED.requestId);
  assertStrictEquals(context.correlationId, TRUSTED.correlationId);
  assertStrictEquals(context.sourceChannel, "mcp");
  assertStrictEquals(context.delegationMode, "delegated_user");
  assertStrictEquals(context.idempotencyKey, "key-1");
  assertStrictEquals(context.payloadHash, await hashCanonicalPayload(PAYLOAD));
});

// -----------------------------------------------------------------------------
// (AA/AB/AC) Module boundary
// -----------------------------------------------------------------------------

Deno.test("API-Q.8 (AA/AB/AC): mutationControl.ts has no execution or I/O surface", () => {
  const source = Deno.readTextFileSync(
    new URL("./mutationControl.ts", __BTPM_SRC_BASE__),
  );
  const forbidden = [
    "createClient",
    "Deno.env",
    "fetch(",
    ".rpc(",
    ".from(",
    "service_role",
    "SUPABASE_",
    "external_api OR mcp",
    "genericMutation",
    "apply_",
  ];
  for (const needle of forbidden) {
    assert(!source.includes(needle), `forbidden in mutationControl: ${needle}`);
  }
  // No mutation executor and no tool registration is introduced.
  assert(!source.includes("registerTool"));
  assert(!source.includes("executeMcp"));
});
