// API-I.6 — Focused tests for the POST /v1/execution-updates route contract
// and strict request-body parser.

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  EXECUTION_UPDATES_APPEND_ROUTE,
  parseApiV1AppendExecutionUpdateBody,
} from "../routes/executionUpdates.ts";
import { API_V1_ROUTE_ALLOWLIST } from "../router.ts";

const UUID = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";

function base(overrides: Record<string, unknown> = {}) {
  return {
    targetType: "phase",
    targetId: UUID,
    summary: "Progress narrative.",
    updateDate: "2026-08-07",
    ...overrides,
  };
}

function assertInvalid(input: unknown) {
  const err = assertThrows(
    () => parseApiV1AppendExecutionUpdateBody(input),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
  assertEquals(err.status, 400);
  assertEquals(err.publicMessage, "Request validation failed.");
}

Deno.test("API-I.6: route contract is frozen and exact", () => {
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.id, "execution_updates.append");
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.method, "POST");
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.path, "/v1/execution-updates");
  assertEquals(EXECUTION_UPDATES_APPEND_ROUTE.operation, "mutation");
  assertEquals(Object.keys(EXECUTION_UPDATES_APPEND_ROUTE).length, 4);
  assert(Object.isFrozen(EXECUTION_UPDATES_APPEND_ROUTE));
});

Deno.test("API-I.6/API-I.8: route is registered exactly once in the allowlist", () => {
  const matches = API_V1_ROUTE_ALLOWLIST.filter(
    (route) =>
      route.id === "execution_updates.append" &&
      route.method === "POST" &&
      route.path === "/v1/execution-updates" &&
      route.operation === "mutation",
  );
  assert(matches.length === 1);
});

Deno.test("API-I.6: valid phase request parses", () => {
  const parsed = parseApiV1AppendExecutionUpdateBody(base());
  assertEquals(parsed, {
    targetType: "phase",
    targetId: UUID,
    summary: "Progress narrative.",
    updateDate: "2026-08-07",
    statusLabel: null,
  });
  assert(Object.isFrozen(parsed));
});

Deno.test("API-I.6: valid task request parses", () => {
  const parsed = parseApiV1AppendExecutionUpdateBody(
    base({ targetType: "task", statusLabel: "On track" }),
  );
  assertEquals(parsed.targetType, "task");
  assertEquals(parsed.statusLabel, "On track");
});

Deno.test("API-I.6: omitted statusLabel normalizes to null", () => {
  assertEquals(parseApiV1AppendExecutionUpdateBody(base()).statusLabel, null);
});

Deno.test("API-I.6: explicit null statusLabel stays null", () => {
  assertEquals(
    parseApiV1AppendExecutionUpdateBody(base({ statusLabel: null })).statusLabel,
    null,
  );
});

Deno.test("API-I.6: blank status label is accepted untouched", () => {
  assertEquals(
    parseApiV1AppendExecutionUpdateBody(base({ statusLabel: "   " }))
      .statusLabel,
    "   ",
  );
  assertEquals(
    parseApiV1AppendExecutionUpdateBody(base({ statusLabel: "" })).statusLabel,
    "",
  );
});

Deno.test("API-I.6: status label over 255 chars rejected", () => {
  assertInvalid(base({ statusLabel: "x".repeat(256) }));
  assertEquals(
    parseApiV1AppendExecutionUpdateBody(base({ statusLabel: "x".repeat(255) }))
      .statusLabel!.length,
    255,
  );
});

Deno.test("API-I.6: targetType is exact, case-sensitive and alias-free", () => {
  for (
    const bad of ["Phase", "TASK", " phase", "phase ", "phases", "", null, 1, undefined]
  ) {
    assertInvalid(base({ targetType: bad }));
  }
});

Deno.test("API-I.6: targetId must be a canonical UUID", () => {
  for (
    const bad of [
      "nope",
      ` ${UUID} `,
      "00000000-0000-0000-0000-000000000000",
      UUID.replace(/-/g, ""),
      null,
      123,
      undefined,
    ]
  ) {
    assertInvalid(base({ targetId: bad }));
  }
});

Deno.test("API-I.6: blank summary rejected", () => {
  for (const bad of ["", "   ", "\n\t", null, 5, undefined, {}]) {
    assertInvalid(base({ summary: bad }));
  }
});

Deno.test("API-I.6: summary limit is 4000 raw characters", () => {
  const ok = "a".repeat(4000);
  assertEquals(
    parseApiV1AppendExecutionUpdateBody(base({ summary: ok })).summary.length,
    4000,
  );
  assertInvalid(base({ summary: "a".repeat(4001) }));
});

Deno.test("API-I.6: strict YYYY-MM-DD only", () => {
  assertEquals(
    parseApiV1AppendExecutionUpdateBody(base({ updateDate: "2026-01-01" }))
      .updateDate,
    "2026-01-01",
  );
  for (
    const bad of [
      "2026-1-1",
      "26-01-01",
      "2026/01/01",
      "2026-01-01T00:00:00Z",
      "2026-01-01 00:00:00",
      "2026-01-01Z",
      " 2026-01-01",
      "2026-00-10",
      "2026-13-01",
      "2026-01-00",
      "",
      null,
      20260101,
    ]
  ) {
    assertInvalid(base({ updateDate: bad }));
  }
});

Deno.test("API-I.6: impossible calendar dates rejected", () => {
  for (const bad of ["2026-02-30", "2026-02-29", "2026-04-31", "2026-06-31"]) {
    assertInvalid(base({ updateDate: bad }));
  }
  assertEquals(
    parseApiV1AppendExecutionUpdateBody(base({ updateDate: "2024-02-29" }))
      .updateDate,
    "2024-02-29",
  );
});

Deno.test("API-I.6: future dates remain allowed", () => {
  assertEquals(
    parseApiV1AppendExecutionUpdateBody(base({ updateDate: "2999-12-31" }))
      .updateDate,
    "2999-12-31",
  );
});

Deno.test("API-I.6: schema is closed — unknown keys rejected", () => {
  for (const key of ["extra", "Summary", "target_type", "targetid", "notes"]) {
    assertInvalid(base({ [key]: "x" }));
  }
});

Deno.test("API-I.6: privileged scope, provenance and dispatch keys rejected", () => {
  for (
    const key of [
      "tenantId",
      "organizationId",
      "workspaceId",
      "projectId",
      "requestedUserId",
      "executingUserId",
      "sourceChannel",
      "sourceClientId",
      "integrationId",
      "apiClientId",
      "capabilityKey",
      "command",
      "function",
      "rpc",
      "table",
      "sql",
      "requestId",
      "correlationId",
      "idempotencyKey",
      "payloadHash",
    ]
  ) {
    assertInvalid(base({ [key]: "x" }));
  }
});

Deno.test("API-I.6: primitive, array and null bodies rejected", () => {
  for (const bad of [null, undefined, 0, 1, "", "{}", true, false, [], [base()]]) {
    assertInvalid(bad);
  }
});

Deno.test("API-I.6: parser never mutates or normalizes narrative content", () => {
  const summary = "  Line one\n\tLine two  ";
  const input = base({ summary, statusLabel: " Amber " });
  const before = { ...input };
  const parsed = parseApiV1AppendExecutionUpdateBody(input);
  assertEquals(input, before);
  assertEquals(parsed.summary, summary);
  assertEquals(parsed.statusLabel, " Amber ");
});

Deno.test("API-I.6: module is pure — no runtime, env, network or db access", async () => {
  const source = await Deno.readTextFile(
    new URL("../routes/executionUpdates.ts", import.meta.url),
  );
  for (
    const needle of [
      "Deno.env",
      "createClient",
      "supabase",
      "service_role",
      "fetch(",
      "console.log",
      "console.warn",
      "console.error",
      "Deno.serve",
      "request.json",
      ".headers",
      "crypto",
      "api_v1_append_execution_update",
      "API_V1_ROUTE_ALLOWLIST",
      "setTimeout",
    ]
  ) {
    assert(!source.includes(needle), `must not contain: ${needle}`);
  }
});
