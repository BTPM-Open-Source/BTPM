// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../../../functions/_shared/btpm-api/__tests__/schemas.test.ts', import.meta.url).href;
// API-G.1G — Focused tests for the common Zod validation foundation.

import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { z } from "npm:zod@3.25.76";

import { ApiHttpError, toSafeHttpErrorResponse } from "../../../../functions/_shared/btpm-api/http.ts";
import {
  apiEmptyObjectSchema,
  apiOrganizationPathParamsSchema,
  apiPhasePathParamsSchema,
  apiProjectPathParamsSchema,
  apiTaskPathParamsSchema,
  apiUuidSchema,
  parseApiSchema,
} from "../../../../functions/_shared/btpm-api/schemas.ts";

const VALID_UUID_LOWER = "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d21";
const VALID_UUID_UPPER = "8F14E45F-CEEA-467A-A4A7-2B4B0C7F4D21";

Deno.test("apiUuidSchema accepts a valid lowercase UUID unchanged", () => {
  const parsed = apiUuidSchema.parse(VALID_UUID_LOWER);
  assertStrictEquals(parsed, VALID_UUID_LOWER);
});

Deno.test("apiUuidSchema accepts a valid uppercase UUID unchanged", () => {
  const parsed = apiUuidSchema.parse(VALID_UUID_UPPER);
  assertStrictEquals(parsed, VALID_UUID_UPPER);
});

Deno.test("apiUuidSchema does not trim UUID input", () => {
  const padded = ` ${VALID_UUID_LOWER} `;
  const result = apiUuidSchema.safeParse(padded);
  assert(!result.success);
});

Deno.test("apiUuidSchema rejects the nil UUID", () => {
  const result = apiUuidSchema.safeParse(
    "00000000-0000-0000-0000-000000000000",
  );
  assert(!result.success);
});

Deno.test("apiUuidSchema rejects malformed values", () => {
  for (const bad of [
    "",
    "not-a-uuid",
    "8f14e45f-ceea-467a-a4a7-2b4b0c7f4d2",
    "8f14e45fceea467aa4a72b4b0c7f4d21",
  ]) {
    assert(!apiUuidSchema.safeParse(bad).success);
  }
});

Deno.test("apiUuidSchema rejects unsupported UUID version", () => {
  // version 6 (unsupported)
  const result = apiUuidSchema.safeParse(
    "8f14e45f-ceea-667a-a4a7-2b4b0c7f4d21",
  );
  assert(!result.success);
});

Deno.test("apiUuidSchema rejects unsupported UUID variant", () => {
  // variant nibble 'c' is outside 8-b
  const result = apiUuidSchema.safeParse(
    "8f14e45f-ceea-467a-c4a7-2b4b0c7f4d21",
  );
  assert(!result.success);
});

Deno.test("apiUuidSchema rejects non-string inputs", () => {
  for (const bad of [undefined, null, 0, 1, true, false, {}, [], VALID_UUID_LOWER.length]) {
    assert(!apiUuidSchema.safeParse(bad).success);
  }
});

Deno.test("apiEmptyObjectSchema accepts {}", () => {
  const parsed = apiEmptyObjectSchema.parse({});
  assertEquals(parsed, {});
});

Deno.test("apiEmptyObjectSchema rejects extra keys", () => {
  assert(!apiEmptyObjectSchema.safeParse({ extra: 1 }).success);
});

Deno.test("apiEmptyObjectSchema rejects non-object values", () => {
  for (const bad of [undefined, null, 0, "", "x", true, false, [], [1]]) {
    assert(!apiEmptyObjectSchema.safeParse(bad).success);
  }
});

Deno.test("path schemas accept exact valid shape", () => {
  assertEquals(
    apiOrganizationPathParamsSchema.parse({ organizationId: VALID_UUID_LOWER }),
    { organizationId: VALID_UUID_LOWER },
  );
  assertEquals(
    apiProjectPathParamsSchema.parse({ projectId: VALID_UUID_LOWER }),
    { projectId: VALID_UUID_LOWER },
  );
  assertEquals(
    apiPhasePathParamsSchema.parse({ phaseId: VALID_UUID_LOWER }),
    { phaseId: VALID_UUID_LOWER },
  );
  assertEquals(
    apiTaskPathParamsSchema.parse({ taskId: VALID_UUID_LOWER }),
    { taskId: VALID_UUID_LOWER },
  );
});

Deno.test("path schemas reject missing identifier", () => {
  assert(!apiOrganizationPathParamsSchema.safeParse({}).success);
  assert(!apiProjectPathParamsSchema.safeParse({}).success);
  assert(!apiPhasePathParamsSchema.safeParse({}).success);
  assert(!apiTaskPathParamsSchema.safeParse({}).success);
});

Deno.test("path schemas reject malformed identifier", () => {
  assert(
    !apiOrganizationPathParamsSchema.safeParse({ organizationId: "nope" })
      .success,
  );
  assert(
    !apiProjectPathParamsSchema.safeParse({ projectId: "nope" }).success,
  );
  assert(!apiPhasePathParamsSchema.safeParse({ phaseId: "nope" }).success);
  assert(!apiTaskPathParamsSchema.safeParse({ taskId: "nope" }).success);
});

Deno.test("path schemas reject unexpected additional keys", () => {
  assert(
    !apiOrganizationPathParamsSchema.safeParse({
      organizationId: VALID_UUID_LOWER,
      extra: "x",
    }).success,
  );
  assert(
    !apiProjectPathParamsSchema.safeParse({
      projectId: VALID_UUID_LOWER,
      other: 1,
    }).success,
  );
  assert(
    !apiPhasePathParamsSchema.safeParse({
      phaseId: VALID_UUID_LOWER,
      x: null,
    }).success,
  );
  assert(
    !apiTaskPathParamsSchema.safeParse({
      taskId: VALID_UUID_LOWER,
      y: true,
    }).success,
  );
});

Deno.test("parsed path output contains only the expected key", () => {
  const parsed = apiProjectPathParamsSchema.parse({
    projectId: VALID_UUID_LOWER,
  });
  assertEquals(Object.keys(parsed), ["projectId"]);
});

Deno.test("input objects are not mutated by strict path schemas", () => {
  const input = { projectId: VALID_UUID_LOWER };
  const before = { ...input };
  const parsed = apiProjectPathParamsSchema.parse(input);
  assertEquals(input, before);
  assertNotStrictEquals(parsed, input);
});

Deno.test("parseApiSchema returns parsed output on success", () => {
  const parsed = parseApiSchema(apiProjectPathParamsSchema, {
    projectId: VALID_UUID_LOWER,
  });
  assertEquals(parsed, { projectId: VALID_UUID_LOWER });
});

Deno.test("parseApiSchema throws invalid_request on validation failure", () => {
  const err = assertThrows(
    () => parseApiSchema(apiProjectPathParamsSchema, { projectId: "bad" }),
    ApiHttpError,
  );
  assertEquals(err.code, "invalid_request");
});

Deno.test("invalid_request maps to status 400 and safe public message", () => {
  const err = new ApiHttpError("invalid_request");
  assertEquals(err.status, 400);
  assertEquals(err.publicMessage, "Request validation failed.");
});

Deno.test("parseApiSchema failure retains no Zod error or input as cause", () => {
  try {
    parseApiSchema(apiProjectPathParamsSchema, {
      projectId: "not-a-uuid",
      secretField: "leaked?",
    });
    throw new Error("expected throw");
  } catch (err) {
    assert(err instanceof ApiHttpError);
    // internalCause is defined non-enumerable; assert it is undefined
    assertStrictEquals((err as unknown as { internalCause?: unknown }).internalCause, undefined);
  }
});

Deno.test("parseApiSchema preserves ApiHttpError thrown by schema execution", () => {
  const existing = new ApiHttpError("unsupported_media_type");
  const fakeSchema = {
    safeParse() {
      throw existing;
    },
  } as unknown as z.ZodTypeAny;
  const thrown = assertThrows(
    () => parseApiSchema(fakeSchema, {}),
    ApiHttpError,
  );
  assertStrictEquals(thrown, existing);
});

Deno.test("parseApiSchema wraps ordinary schema errors as internal_error", () => {
  const boom = new Error("boom");
  const fakeSchema = {
    safeParse() {
      throw boom;
    },
  } as unknown as z.ZodTypeAny;
  const thrown = assertThrows(
    () => parseApiSchema(fakeSchema, {}),
    ApiHttpError,
  );
  assertEquals(thrown.code, "internal_error");
  assertStrictEquals((thrown as unknown as { internalCause?: unknown }).internalCause, boom);
});

Deno.test("safe error response exposes only stable code, message and request id", async () => {
  const err = new ApiHttpError("invalid_request");
  const response = toSafeHttpErrorResponse(err, "req-123");
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body, {
    error: {
      code: "invalid_request",
      message: "Request validation failed.",
    },
    requestId: "req-123",
  });
  const text = JSON.stringify(body);
  assert(!text.includes("not-a-uuid"));
  assert(!text.includes("Zod"));
  assert(!text.includes("regex"));
  assert(!text.includes("projectId"));
});

Deno.test("schemas.ts uses exact pinned npm:zod@3.25.76 import", async () => {
  const source = await Deno.readTextFile(
    new URL("../schemas.ts", __BTPM_SRC_BASE__),
  );
  assert(source.includes(`from "npm:zod@3.25.76"`));
});

Deno.test("schemas.ts contains no runtime, network, env, supabase or logging", async () => {
  const source = await Deno.readTextFile(
    new URL("../schemas.ts", __BTPM_SRC_BASE__),
  );
  const forbidden = [
    "Deno.env",
    "createClient",
    "supabase",
    "SERVICE_ROLE",
    "service_role",
    "fetch(",
    "console.log",
    "console.warn",
    "console.error",
    "Deno.serve",
    "serve(",
  ];
  for (const needle of forbidden) {
    assert(
      !source.includes(needle),
      `schemas.ts must not contain: ${needle}`,
    );
  }
});
