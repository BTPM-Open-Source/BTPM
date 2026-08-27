// API-I.9B — Focused live-HTTP activation tests for the single external
// mutation route POST /v1/execution-updates.
//
// These tests use only injected dependencies. They touch no environment,
// network, database, Supabase client or live adapter.

import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleApiV1Request,
  type ApiV1HttpHandlerDependencies,
} from "../handler.ts";
import type {
  ApiAppendExecutionUpdateRouteDependencies,
  ApiProtectedRouteDependencies,
  ApiRuntimeControls,
} from "../router.ts";
import { EXECUTION_UPDATES_APPEND_ROUTE } from "../routes/executionUpdates.ts";
import { VERSION_ROUTE, buildVersionPayload } from "../routes/version.ts";
import { ApiAuthenticationError } from "../../_shared/btpm-api/apiErrors.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import type {
  ApiRateLimitDependencies,
  ApiRateLimitStore,
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../_shared/btpm-api/rateLimit.ts";
import type {
  ApiV1AppendExecutionUpdateResult,
} from "../../_shared/btpm-api/supabaseAppendExecutionUpdate.ts";
import type { ApiActivityRecordInput } from "../../_shared/btpm-api/supabaseActivity.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "44444444-4444-4444-8444-444444444444";
const EXECUTION_UPDATE_ID = "55555555-5555-4555-8555-555555555555";
const OAUTH_CLIENT_ID = "oauth-client-abc";
const ALLOWED_ORIGIN = "https://app.example.com";
const FIXED_REQUEST_ID = "req-fixed-uuid-0001";
const IDEMPOTENCY_KEY = "idem-key-0001";

const SUMMARY = "Confidential narrative that must never be logged or echoed.";
const STATUS_LABEL = "AMBER-secret-label";

const BODY = Object.freeze({
  targetType: "task",
  targetId: TARGET_ID,
  summary: SUMMARY,
  updateDate: "2026-08-07",
  statusLabel: STATUS_LABEL,
});

const AUTH_CONTEXT: AuthenticatedApiContext = Object.freeze({
  token: Object.freeze({ userId: USER_ID, clientId: OAUTH_CLIENT_ID }),
  client: Object.freeze({
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    oauthClientId: OAUTH_CLIENT_ID,
  }),
}) as unknown as AuthenticatedApiContext;

const MUTATIONS_ON: ApiRuntimeControls = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: true,
});

const MUTATIONS_OFF: ApiRuntimeControls = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: false,
});

const API_OFF: ApiRuntimeControls = Object.freeze({
  apiEnabled: false,
  readsEnabled: false,
  mutationsEnabled: false,
});

const APPLIED: ApiV1AppendExecutionUpdateResult = Object.freeze({
  ok: true,
  outcome: "applied",
  executionUpdateId: EXECUTION_UPDATE_ID,
  targetType: "task",
  targetId: TARGET_ID,
  updateDate: "2026-08-07",
  hasStatusLabel: true,
});

const REPLAYED: ApiV1AppendExecutionUpdateResult = Object.freeze({
  ok: true,
  outcome: "replayed",
  executionUpdateId: EXECUTION_UPDATE_ID,
  targetType: "task",
  targetId: TARGET_ID,
  updateDate: "2026-08-07",
  hasStatusLabel: true,
});

function makeStore(allowed: boolean): ApiRateLimitStore {
  return {
    consume(_input: ApiRateLimitStoreInput): Promise<ApiRateLimitStoreResult> {
      return Promise.resolve({
        allowed,
        remaining: allowed ? 99 : 0,
        resetAtEpochMs: 1_700_000_000_000,
      });
    },
  };
}

function makeRateLimit(allowed: boolean): ApiRateLimitDependencies {
  return { store: makeStore(allowed), now: () => 1_600_000_000_000 };
}

interface Trace {
  authenticate: number;
  authorizeRoute: number;
  executor: number;
  requestIds: string[];
  executionContexts: unknown[];
  activity: ApiActivityRecordInput[];
}

function newTrace(): Trace {
  return {
    authenticate: 0,
    authorizeRoute: 0,
    executor: 0,
    requestIds: [],
    executionContexts: [],
    activity: [],
  };
}

interface Options {
  controls?: ApiRuntimeControls;
  result?: ApiV1AppendExecutionUpdateResult;
  executorError?: unknown;
  authenticateError?: unknown;
  authorizeError?: unknown;
  rateAllowed?: boolean;
  omitMutationDeps?: boolean;
  withActivity?: boolean;
}

const READ_DEPS: ApiProtectedRouteDependencies = {
  authenticate: () => Promise.resolve(AUTH_CONTEXT),
  authorizeRoute: () => Promise.resolve(),
  resolveRateLimitProfile: () =>
    Promise.resolve({ limit: 100, windowSeconds: 60 }),
  rateLimit: makeRateLimit(true),
  readMe: () => Promise.resolve({ userId: USER_ID }),
  readOrganizations: () => Promise.resolve({ organizations: [] }),
  readWorkspaces: () => Promise.resolve({ workspaces: [] }),
  readProjects: () => Promise.resolve({ projects: [] }),
  readProjectDetail: () => Promise.resolve({ project: null }),
  readProjectPlanning: () => Promise.resolve({ project: null }),
} as unknown as ApiProtectedRouteDependencies;

function makeDeps(
  trace: Trace,
  options: Options = {},
): ApiV1HttpHandlerDependencies {
  const mutation: ApiAppendExecutionUpdateRouteDependencies = {
    authenticate: (_request: Request) => {
      trace.authenticate += 1;
      if (options.authenticateError !== undefined) {
        return Promise.reject(options.authenticateError);
      }
      return Promise.resolve(AUTH_CONTEXT);
    },
    authorizeRoute: (_context: unknown, _route: unknown) => {
      trace.authorizeRoute += 1;
      if (options.authorizeError !== undefined) {
        return Promise.reject(options.authorizeError);
      }
      return Promise.resolve();
    },
    resolveRateLimitProfile: () =>
      Promise.resolve({ limit: 100, windowSeconds: 60 }),
    rateLimit: makeRateLimit(options.rateAllowed !== false),
    appendExecutionUpdate: (
      _request: Request,
      _context: unknown,
      _body: unknown,
      executionContext: { readonly requestId: string },
    ) => {
      trace.executor += 1;
      trace.requestIds.push(executionContext.requestId);
      trace.executionContexts.push(executionContext);
      if (options.executorError !== undefined) {
        return Promise.reject(options.executorError);
      }
      return Promise.resolve(options.result ?? APPLIED);
    },
  } as unknown as ApiAppendExecutionUpdateRouteDependencies;

  const base: Record<string, unknown> = {
    controls: options.controls ?? MUTATIONS_ON,
    allowedOrigins: new Set<string>([ALLOWED_ORIGIN]),
    timeoutMs: 5_000,
    requestId: { randomUUID: () => FIXED_REQUEST_ID },
    protectedRoute: READ_DEPS,
  };
  if (options.omitMutationDeps !== true) {
    base.appendExecutionUpdateRoute = mutation;
  }
  if (options.withActivity === true) {
    let t = 1_000;
    base.activity = {
      recorder: {
        record: (input: ApiActivityRecordInput) => {
          trace.activity.push(input);
          return Promise.resolve(true);
        },
      },
      nowMs: () => (t += 5),
      schedule: (_task: Promise<boolean>) => {},
    };
  }
  return base as unknown as ApiV1HttpHandlerDependencies;
}

function makePost(
  body: string | null,
  init: {
    url?: string;
    contentType?: string | null;
    idempotencyKey?: string | null;
    contentLength?: string;
  } = {},
): Request {
  const headers = new Headers({ Origin: ALLOWED_ORIGIN });
  const ct = init.contentType === undefined
    ? "application/json"
    : init.contentType;
  if (ct !== null) headers.set("Content-Type", ct);
  const key = init.idempotencyKey === undefined
    ? IDEMPOTENCY_KEY
    : init.idempotencyKey;
  if (key !== null) headers.set("Idempotency-Key", key);
  if (init.contentLength !== undefined) {
    headers.set("Content-Length", init.contentLength);
  }
  return new Request(
    init.url ?? "https://api.example.test/v1/execution-updates",
    { method: "POST", headers, body },
  );
}

function jsonBody(): string {
  return JSON.stringify(BODY);
}

async function readJson(response: Response): Promise<unknown> {
  return await response.json();
}

// ---------------------------------------------------------------------------
// Success mapping
// ---------------------------------------------------------------------------

Deno.test("API-I.9B: applied mutation returns 201 with the exact bounded payload", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace),
  );
  assertEquals(response.status, 201);
  assertEquals(trace.executor, 1);
  const payload = await readJson(response) as Record<string, unknown>;
  assertEquals(payload, {
    ok: true,
    outcome: "applied",
    executionUpdateId: EXECUTION_UPDATE_ID,
    targetType: "task",
    targetId: TARGET_ID,
    updateDate: "2026-08-07",
    hasStatusLabel: true,
  });
  // No narrative, status label text, scope, provenance or hash.
  const serialized = JSON.stringify(payload);
  assertFalse(serialized.includes(SUMMARY));
  assertFalse(serialized.includes(STATUS_LABEL));
  assertFalse(serialized.includes("payloadHash"));
  assertEquals(
    response.headers.get("Content-Type"),
    "application/json; charset=utf-8",
  );
  assertEquals(response.headers.get("X-Request-ID"), FIXED_REQUEST_ID);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    ALLOWED_ORIGIN,
  );
});

Deno.test("API-I.9B: replayed mutation returns 200 with the exact replay payload", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace, { result: REPLAYED }),
  );
  assertEquals(response.status, 200);
  const payload = await readJson(response) as Record<string, unknown>;
  assertEquals((payload as { outcome: string }).outcome, "replayed");
  assertEquals(Object.keys(payload).length, 7);
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

Deno.test("API-I.9B: invalid business body maps to 400", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(JSON.stringify({ ...BODY, targetType: "project" })),
    makeDeps(trace),
  );
  assertEquals(response.status, 400);
  assertEquals(trace.executor, 0);
  await response.body?.cancel();
});

Deno.test("API-I.9B: missing Idempotency-Key maps to 400", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody(), { idempotencyKey: null }),
    makeDeps(trace),
  );
  assertEquals(response.status, 400);
  assertEquals(trace.executor, 0);
  await response.body?.cancel();
});

Deno.test("API-I.9B: invalid Idempotency-Key maps to 400", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody(), { idempotencyKey: "bad key with spaces" }),
    makeDeps(trace),
  );
  assertEquals(response.status, 400);
  assertEquals(trace.executor, 0);
  await response.body?.cancel();
});

Deno.test("API-I.9B: idempotency conflict maps to 409", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace, {
      result: Object.freeze({ ok: false, outcome: "idempotency_conflict" }),
    }),
  );
  assertEquals(response.status, 409);
  const payload = await readJson(response) as {
    error: { code: string; message: string };
  };
  assertEquals(payload.error.code, "idempotency_conflict");
  assertFalse(JSON.stringify(payload).includes(SUMMARY));
});

Deno.test("API-I.9B: idempotency pending maps to 409", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace, {
      result: Object.freeze({ ok: false, outcome: "idempotency_pending" }),
    }),
  );
  assertEquals(response.status, 409);
  const payload = await readJson(response) as { error: { code: string } };
  assertEquals(payload.error.code, "idempotency_pending");
});

Deno.test("API-I.9B: not authorized maps to 403", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace, {
      result: Object.freeze({ ok: false, outcome: "not_authorized" }),
    }),
  );
  assertEquals(response.status, 403);
  await response.body?.cancel();
});

Deno.test("API-I.9B: authentication error retains the existing safe response", async () => {
  const trace = newTrace();
  const authError = new ApiAuthenticationError("invalid_token");
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace, { authenticateError: authError }),
  );
  assertEquals(response.status, authError.status);
  assertEquals(response.status, 401);
  const payload = await readJson(response) as {
    error: { code: string; message: string };
    requestId: string;
  };
  assertEquals(payload.error.code, authError.code);
  assertEquals(payload.error.message, authError.publicMessage);
  assertEquals(payload.requestId, FIXED_REQUEST_ID);
  assertEquals(trace.executor, 0);
});

Deno.test("API-I.9B: rate rejection maps to 429", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace, { rateAllowed: false }),
  );
  assertEquals(response.status, 429);
  assertEquals(trace.executor, 0);
  await response.body?.cancel();
});

Deno.test("API-I.9B: mutations disabled maps to 503 without invoking the executor", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace, { controls: MUTATIONS_OFF }),
  );
  assertEquals(response.status, 503);
  assertEquals(trace.executor, 0);
  assertEquals(trace.authenticate, 0);
  await response.body?.cancel();
});

Deno.test("API-I.9B: global API switch disabled maps to 503", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace, { controls: API_OFF }),
  );
  assertEquals(response.status, 503);
  assertEquals(trace.executor, 0);
  await response.body?.cancel();
});

Deno.test("API-I.9B: missing mutation dependency fails closed with 500", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace, { omitMutationDeps: true }),
  );
  assertEquals(response.status, 500);
  const payload = await readJson(response) as { error: { code: string } };
  assertEquals(payload.error.code, "internal_error");
});

Deno.test("API-I.9B: wrong POST path maps to 404", async () => {
  const trace = newTrace();
  for (
    const url of [
      "https://api.example.test/v1/execution-updates/extra",
      // API-N.5 — POST /v1/projects is now a live external command and is no
      // longer an unknown mutation path.
      "https://api.example.test/v1/execution-update",
      "https://api.example.test/",
    ]
  ) {
    const response = await handleApiV1Request(
      makePost(jsonBody(), { url }),
      makeDeps(trace),
    );
    assertEquals(response.status, 404);
    await response.body?.cancel();
  }
  assertEquals(trace.executor, 0);
});

Deno.test("API-I.9B: query-bearing mutation path maps to 400", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody(), {
      url: "https://api.example.test/v1/execution-updates?dry_run=1",
    }),
    makeDeps(trace),
  );
  assertEquals(response.status, 400);
  assertEquals(trace.executor, 0);
  await response.body?.cancel();
});

Deno.test("API-I.9B: unsupported Content-Type maps to 415", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody(), { contentType: "text/plain" }),
    makeDeps(trace),
  );
  assertEquals(response.status, 415);
  assertEquals(trace.executor, 0);
  await response.body?.cancel();
});

Deno.test("API-I.9B: invalid JSON maps to 400", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost("{not json"),
    makeDeps(trace),
  );
  assertEquals(response.status, 400);
  assertEquals(trace.executor, 0);
  await response.body?.cancel();
});

Deno.test("API-I.9B: 65536-byte body maps to 413", async () => {
  const trace = newTrace();
  const filler = "a".repeat(65_536);
  const oversize = JSON.stringify({ ...BODY, summary: filler });
  assert(oversize.length > 65_536);
  const response = await handleApiV1Request(
    makePost(oversize),
    makeDeps(trace),
  );
  assertEquals(response.status, 413);
  assertEquals(trace.executor, 0);
  await response.body?.cancel();
});

// ---------------------------------------------------------------------------
// Read-surface preservation
// ---------------------------------------------------------------------------

Deno.test("API-I.9B: GET routes remain bodyless and unchanged", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  const withBody = new Request("https://api.example.test/v1/version", {
    method: "GET",
    headers: { Origin: ALLOWED_ORIGIN, "Content-Length": "12" },
  });
  const rejected = await handleApiV1Request(withBody, deps);
  assertEquals(rejected.status, 413);
  await rejected.body?.cancel();

  const ok = await handleApiV1Request(
    new Request("https://api.example.test/v1/version", {
      method: "GET",
      headers: { Origin: ALLOWED_ORIGIN },
    }),
    deps,
  );
  assertEquals(ok.status, 200);
  assertEquals(await readJson(ok), buildVersionPayload());
  assertEquals(trace.executor, 0);
});

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

function makePreflight(url: string, requestedMethod: string): Request {
  return new Request(url, {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": requestedMethod,
    },
  });
}

Deno.test("API-I.9B: POST preflight succeeds for the exact mutation route", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePreflight("https://api.example.test/v1/execution-updates", "POST"),
    makeDeps(trace),
  );
  assertEquals(response.status, 204);
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "GET, POST, PATCH, PUT, OPTIONS",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Headers"),
    "Authorization, Content-Type, X-Request-ID, X-Correlation-ID, Idempotency-Key",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    ALLOWED_ORIGIN,
  );
});

Deno.test("API-I.9B: GET preflight remains unchanged", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePreflight("https://api.example.test/v1/version", "GET"),
    makeDeps(trace),
  );
  assertEquals(response.status, 204);
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    "GET, POST, PATCH, PUT, OPTIONS",
  );
});

Deno.test("API-I.9B: unsupported and mismatched preflight targets are rejected", async () => {
  const trace = newTrace();
  const deps = makeDeps(trace);
  for (
    const [url, method] of [
      ["https://api.example.test/v1/execution-updates", "PATCH"],
      ["https://api.example.test/v1/execution-updates", "DELETE"],
      ["https://api.example.test/v1/version", "POST"],
      ["https://api.example.test/v1/execution-updates?x=1", "POST"],
    ] as const
  ) {
    const response = await handleApiV1Request(
      makePreflight(url, method),
      deps,
    );
    assertEquals(response.status, 404);
    await response.body?.cancel();
  }
});

// ---------------------------------------------------------------------------
// Request-ID propagation, activity and log safety
// ---------------------------------------------------------------------------

Deno.test("API-I.9B: HTTP-resolved request ID is passed into API-I.9A", async () => {
  const trace = newTrace();
  const response = await handleApiV1Request(
    makePost(jsonBody()),
    makeDeps(trace),
  );
  assertEquals(response.status, 201);
  assertEquals(trace.requestIds, [FIXED_REQUEST_ID]);
  await response.body?.cancel();
});

Deno.test("API-I.9B: durable activity uses POST and the actual status, with no narrative", async () => {
  for (
    const [result, expectedStatus] of [
      [APPLIED, 201],
      [REPLAYED, 200],
    ] as const
  ) {
    const trace = newTrace();
    const response = await handleApiV1Request(
      makePost(jsonBody()),
      makeDeps(trace, { result, withActivity: true }),
    );
    assertEquals(response.status, expectedStatus);
    await response.body?.cancel();
    assertEquals(trace.activity.length, 1);
    const input = trace.activity[0] as unknown as Record<string, unknown>;
    assertEquals(input.method, "POST");
    assertEquals(input.status, expectedStatus);
    assertEquals(input.routeId, EXECUTION_UPDATES_APPEND_ROUTE.id);
    assertEquals(input.apiClientId, API_CLIENT_ID);
    assertEquals(input.actorUserId, USER_ID);
    const serialized = JSON.stringify(input);
    assertFalse(serialized.includes(SUMMARY));
    assertFalse(serialized.includes(STATUS_LABEL));
    assertFalse(serialized.includes("payloadHash"));
    assertFalse(serialized.includes(IDEMPOTENCY_KEY));
  }
});

Deno.test("API-I.9B: structured logs never contain narrative, status label or payload hash", async () => {
  const trace = newTrace();
  const captured: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const capture = (...args: unknown[]) => {
    captured.push(args.map((a) => String(a)).join(" "));
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    const response = await handleApiV1Request(
      makePost(jsonBody()),
      makeDeps(trace),
    );
    await response.body?.cancel();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  const joined = captured.join("\n");
  assert(joined.length > 0, "handler must emit structured logs");
  assert(joined.includes("execution_updates.append"));
  assertFalse(joined.includes(SUMMARY));
  assertFalse(joined.includes(STATUS_LABEL));
  assertFalse(joined.includes(IDEMPOTENCY_KEY));
  assertFalse(joined.includes("payloadHash"));
});

// ---------------------------------------------------------------------------
// Static runtime-composition proofs
// ---------------------------------------------------------------------------

Deno.test("API-I.9B: live runtime builds the delegated executor with the anon key only", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(
    src.includes(
      "createDelegatedApiV1AppendExecutionUpdateExecutor(\n      supabaseUrl,\n      supabaseAnonKey,\n      (url, key, options) => createClient(url, key, options),\n    )",
    ),
    "mutation executor must be constructed with the anon key",
  );
  const at = src.indexOf("createDelegatedApiV1AppendExecutionUpdateExecutor(");
  const block = src.slice(at, at + 300);
  assertFalse(block.includes("supabaseServiceRoleKey"));
  assertFalse(block.includes("privilegedClient"));
  // Shared accepted components, not parallel infrastructure.
  assert(
    /appendExecutionUpdateRoute:\s*ApiAppendExecutionUpdateRouteDependencies\s*=\s*\{\s*\n\s*authenticate,\s*\n\s*authorizeRoute,\s*\n\s*resolveRateLimitProfile,\s*\n\s*rateLimit,\s*\n\s*appendExecutionUpdate,/
      .test(src),
    "mutation dependency must reuse the accepted read-path components",
  );
  // Later accepted mutation families append after this prefix; this step owns
  // only its own placement, not the global composition tail.
  assert(
    src.includes(
      "appendExecutionUpdateRoute,\n    riskMutationRoute,\n    blockerMutationRoute,\n    projectMutationRoute,\n    phaseMutationRoute,\n    taskMutationRoute,",
    ),
  );
  // No runtime flag was changed in code.
  assert(src.includes('Deno.env.get("BTPM_API_MUTATIONS_ENABLED")'));
  assertFalse(src.includes("BTPM_API_MUTATIONS_ENABLED="));
});

// API-N.RG2 — the structural authorization registration for this mutation route
// is owned centrally by api-v1-live-authorization-registration.test.ts.



Deno.test("API-I.9B: function-prefix normalization preserves the POST body", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(src.includes("body: request.body,"));
  assert(src.includes('duplex: "half"'));
  // The body is never read in index.ts.
  assertFalse(src.includes("await request.text()"));
  assertFalse(src.includes("await request.json()"));
  assertFalse(src.includes("request.body.getReader()"));

  // Behavioural proof of stream forwarding using the same construction.
  const original = new Request(
    "https://api.example.test/btpm-api-v1/v1/execution-updates",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody(),
    },
  );
  const url = new URL(original.url);
  url.pathname = "/v1/execution-updates";
  const forwarded = new Request(url, {
    method: original.method,
    headers: original.headers,
    body: original.body,
    signal: original.signal,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  assertEquals(new URL(forwarded.url).pathname, "/v1/execution-updates");
  assertEquals(forwarded.method, "POST");
  assertEquals(await forwarded.text(), jsonBody());
});

Deno.test("API-I.9B: handler caps the mutation body at exactly 65536 bytes", async () => {
  const src = await Deno.readTextFile(
    new URL("../handler.ts", import.meta.url),
  );
  assert(src.includes("const MUTATION_MAX_BODY_BYTES = 65_536;"));
  assert(src.includes("readBoundedJson(\n        request,\n        MUTATION_MAX_BODY_BYTES,\n      )"));
  assertFalse(src.includes("request.json()"));
  assertFalse(src.includes("await request.text()"));
});

Deno.test("API-I.9B: exactly one mutation route is exposed", () => {
  assertStrictEquals(EXECUTION_UPDATES_APPEND_ROUTE.method, "POST");
  assertStrictEquals(EXECUTION_UPDATES_APPEND_ROUTE.path, "/v1/execution-updates");
  assertStrictEquals(VERSION_ROUTE.method, "GET");
});
