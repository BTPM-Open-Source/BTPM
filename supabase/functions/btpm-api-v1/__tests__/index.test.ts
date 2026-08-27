// API-G.1L — Focused tests for the pure protected HTTP transport shell.
//
// These tests use only injected dependencies. They do not touch the
// environment, network, database, Supabase, or any live adapter.

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
  ApiProtectedRouteDependencies,
  ApiRuntimeControls,
} from "../router.ts";
import { ApiAuthenticationError } from "../../_shared/btpm-api/apiErrors.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import type {
  ApiRateLimitDependencies,
  ApiRateLimitStore,
  ApiRateLimitStoreInput,
  ApiRateLimitStoreResult,
} from "../../_shared/btpm-api/rateLimit.ts";
import { buildVersionPayload } from "../routes/version.ts";
import { buildCapabilitiesPayload } from "../routes/capabilities.ts";
import { ME_ROUTE } from "../routes/me.ts";
import { VERSION_ROUTE } from "../routes/version.ts";
import { CAPABILITIES_ROUTE } from "../routes/capabilities.ts";
import { ORGANIZATIONS_ROUTE } from "../routes/organizations.ts";
import { WORKSPACES_ROUTE } from "../routes/workspaces.ts";
import { PROJECTS_ROUTE } from "../routes/projects.ts";
import type { ApiV1MePayload } from "../../_shared/btpm-api/supabaseReadMe.ts";
import type { ApiV1OrganizationsPayload } from "../../_shared/btpm-api/supabaseOrganizations.ts";
import type { ApiV1ProjectsPayload } from "../../_shared/btpm-api/supabaseProjects.ts";
import type { ApiV1WorkspacesPayload } from "../../_shared/btpm-api/supabaseWorkspaces.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "11111111-1111-4111-8111-111111111111";
const API_CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const POLICY_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OAUTH_CLIENT_ID = "oauth-client-abc";
const ALLOWED_ORIGIN = "https://app.example.com";
const FIXED_REQUEST_ID = "req-fixed-uuid-0001";

const AUTH_CONTEXT: AuthenticatedApiContext = Object.freeze({
  token: Object.freeze({ userId: USER_ID, clientId: OAUTH_CLIENT_ID }),
  client: Object.freeze({
    userId: USER_ID,
    apiClientId: API_CLIENT_ID,
    policyVersionId: POLICY_VERSION_ID,
    oauthClientId: OAUTH_CLIENT_ID,
  }),
}) as unknown as AuthenticatedApiContext;

const ENABLED_CONTROLS: ApiRuntimeControls = Object.freeze({
  apiEnabled: true,
  readsEnabled: true,
  mutationsEnabled: false,
});

const DISABLED_CONTROLS: ApiRuntimeControls = Object.freeze({
  apiEnabled: false,
  readsEnabled: false,
  mutationsEnabled: false,
});

type CallCounts = {
  authenticate: number;
  authorizeRoute: number;
  resolveRateLimitProfile: number;
  storeConsume: number;
  readMe: number;
};

const ME_PAYLOAD = Object.freeze({ userId: USER_ID }) as ApiV1MePayload;

function makeAllowStore(): ApiRateLimitStore {
  return {
    consume(_input: ApiRateLimitStoreInput): Promise<ApiRateLimitStoreResult> {
      return Promise.resolve({
        allowed: true,
        remaining: 99,
        resetAtEpochMs: 1_700_000_000_000,
      });
    },
  };
}

function makeDenyStore(): ApiRateLimitStore {
  return {
    consume(_input: ApiRateLimitStoreInput): Promise<ApiRateLimitStoreResult> {
      return Promise.resolve({
        allowed: false,
        remaining: 0,
        resetAtEpochMs: 1_700_000_000_000,
      });
    },
  };
}

function makeRateLimit(store: ApiRateLimitStore): ApiRateLimitDependencies {
  return { store, now: () => 1_600_000_000_000 };
}

interface DepsOverrides {
  controls?: ApiRuntimeControls;
  allowedOrigins?: ReadonlySet<string>;
  timeoutMs?: number;
  requestIdValue?: string;
  authenticate?: ApiProtectedRouteDependencies["authenticate"];
  authorizeRoute?: ApiProtectedRouteDependencies["authorizeRoute"];
  resolveRateLimitProfile?:
    ApiProtectedRouteDependencies["resolveRateLimitProfile"];
  rateLimit?: ApiRateLimitDependencies;
  readMe?: ApiProtectedRouteDependencies["readMe"];
  readOrganizations?: ApiProtectedRouteDependencies["readOrganizations"];
  readWorkspaces?: ApiProtectedRouteDependencies["readWorkspaces"];
  readProjects?: ApiProtectedRouteDependencies["readProjects"];
  readProjectDetail?: ApiProtectedRouteDependencies["readProjectDetail"];
  readProjectPlanning?: ApiProtectedRouteDependencies["readProjectPlanning"];
  counts?: CallCounts;
}

function makeDeps(o: DepsOverrides = {}): ApiV1HttpHandlerDependencies {
  const counts = o.counts;
  const store = o.rateLimit
    ? o.rateLimit
    : makeRateLimit({
        consume(input) {
          if (counts) counts.storeConsume++;
          return makeAllowStore().consume(input);
        },
      });
  return Object.freeze({
    controls: o.controls ?? ENABLED_CONTROLS,
    allowedOrigins: o.allowedOrigins ?? new Set<string>([ALLOWED_ORIGIN]),
    timeoutMs: o.timeoutMs ?? 5000,
    requestId: {
      randomUUID: () => o.requestIdValue ?? FIXED_REQUEST_ID,
    },
    protectedRoute: {
      authenticate: o.authenticate ??
        ((_req) => {
          if (counts) counts.authenticate++;
          return Promise.resolve(AUTH_CONTEXT);
        }),
      authorizeRoute: o.authorizeRoute ??
        ((_ctx, _route) => {
          if (counts) counts.authorizeRoute++;
          return Promise.resolve();
        }),
      resolveRateLimitProfile: o.resolveRateLimitProfile ??
        ((_ctx, _route) => {
          if (counts) counts.resolveRateLimitProfile++;
          return Promise.resolve({ limit: 100, windowSeconds: 60 });
        }),
      rateLimit: store,
      readMe: o.readMe ??
        ((_req, _ctx) => {
          if (counts) counts.readMe++;
          return Promise.resolve(ME_PAYLOAD);
        }),
      readOrganizations: o.readOrganizations ??
        ((_req, _ctx, _q) =>
          Promise.reject(new ApiHttpError("internal_error"))),
      readWorkspaces: o.readWorkspaces ??
        ((_req, _ctx, _q) =>
          Promise.reject(new ApiHttpError("internal_error"))),
      readProjects: o.readProjects ??
        ((_req, _ctx, _q) =>
          Promise.reject(new ApiHttpError("internal_error"))),
      readProjectDetail: o.readProjectDetail ??
        ((_req, _ctx, _id) =>
          Promise.reject(new ApiHttpError("internal_error"))),
      readProjectPlanning: o.readProjectPlanning ??
        ((_req, _ctx, _id) =>
          Promise.reject(new ApiHttpError("internal_error"))),
    },
  });
}

function makeGet(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { method: "GET", headers });
}

// ---------------------------------------------------------------------------
// Log capture
// ---------------------------------------------------------------------------

interface CapturedLog {
  level: "log" | "warn" | "error";
  payload: Record<string, unknown>;
}

function withLogCapture<T>(fn: () => Promise<T>): Promise<{
  value: T;
  logs: CapturedLog[];
}>;
function withLogCapture<T>(fn: () => T): { value: T; logs: CapturedLog[] };
function withLogCapture(fn: () => unknown): unknown {
  const logs: CapturedLog[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const capture = (level: "log" | "warn" | "error") => (line: unknown) => {
    if (typeof line === "string") {
      try {
        logs.push({ level, payload: JSON.parse(line) });
        return;
      } catch {
        // ignore non-JSON
      }
    }
  };
  console.log = capture("log") as typeof console.log;
  console.warn = capture("warn") as typeof console.warn;
  console.error = capture("error") as typeof console.error;
  const restore = () => {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then((v) => {
        restore();
        return { value: v, logs };
      }, (e) => {
        restore();
        throw e;
      });
    }
    restore();
    return { value: result, logs };
  } catch (e) {
    restore();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Success — GET /v1/version and /v1/capabilities
// ---------------------------------------------------------------------------

Deno.test("GET /v1/version returns 200 with exact payload", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps(),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, buildVersionPayload());
});

Deno.test("GET /v1/capabilities returns 200 with exact ordered payload", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/capabilities", { Origin: ALLOWED_ORIGIN }),
    makeDeps(),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, buildCapabilitiesPayload());
});

Deno.test("success responses contain safe mandatory headers", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps(),
  );
  assertEquals(
    res.headers.get("Content-Type"),
    "application/json; charset=utf-8",
  );
  assertEquals(res.headers.get("X-Request-ID"), FIXED_REQUEST_ID);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  await res.body?.cancel();
});

Deno.test("allowed Origin receives accepted CORS headers", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps(),
  );
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(res.headers.get("Access-Control-Expose-Headers"), "X-Request-ID");
  await res.body?.cancel();
});

Deno.test("request without Origin succeeds with Vary: Origin only", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version"),
    makeDeps(),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  await res.body?.cancel();
});

// ---------------------------------------------------------------------------
// CORS denial
// ---------------------------------------------------------------------------

Deno.test("denied Origin returns cors_origin_denied without allow-origin", async () => {
  const counts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: "https://evil.example" }),
    makeDeps({ counts }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "cors_origin_denied");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(counts.authenticate, 0);
  assertEquals(counts.storeConsume, 0);
});

// ---------------------------------------------------------------------------
// Route targeting
// ---------------------------------------------------------------------------

Deno.test("query-bearing target returns route_not_found", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version?x=1"),
    makeDeps(),
  );
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "route_not_found");
});

Deno.test("fragment-bearing target does not match", async () => {
  // Note: URL constructor strips fragments from most fetch requests, but a
  // request whose URL has a fragment would still not match /v1/version.
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/capabilities?a=b"),
    makeDeps(),
  );
  assertEquals(res.status, 404);
});

Deno.test("trailing slash is unsupported", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version/"),
    makeDeps(),
  );
  assertEquals(res.status, 404);
});

Deno.test("case-changed path is unsupported", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/V1/Version"),
    makeDeps(),
  );
  assertEquals(res.status, 404);
});

Deno.test("unsupported HTTP method returns route_not_found before auth", async () => {
  const counts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  const res = await handleApiV1Request(
    new Request("http://localhost/v1/version", { method: "DELETE" }),
    makeDeps({ counts }),
  );
  assertEquals(res.status, 404);
  assertEquals(counts.authenticate, 0);
});

// ---------------------------------------------------------------------------
// Bodyless size enforcement
// ---------------------------------------------------------------------------

Deno.test("missing Content-Length is accepted", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version"),
    makeDeps(),
  );
  assertEquals(res.status, 200);
  await res.body?.cancel();
});

Deno.test("exact Content-Length: 0 is accepted", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { "Content-Length": "0" }),
    makeDeps(),
  );
  assertEquals(res.status, 200);
  await res.body?.cancel();
});

Deno.test("positive content length returns request_too_large before auth", async () => {
  const counts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { "Content-Length": "5" }),
    makeDeps({ counts }),
  );
  assertEquals(res.status, 413);
  const body = await res.json();
  assertEquals(body.error.code, "request_too_large");
  assertEquals(counts.authenticate, 0);
});

Deno.test("malformed content length returns invalid_content_length", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { "Content-Length": "abc" }),
    makeDeps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "invalid_content_length");
});

Deno.test("non-null body on OPTIONS is rejected before authentication", async () => {
  const counts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  // OPTIONS permits a body in the Fetch/Request API construction path.
  const req = new Request("http://localhost/v1/version", {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "GET",
      "Content-Length": "0",
    },
    body: "hello",
  });
  const res = await handleApiV1Request(req, makeDeps({ counts }));
  assertEquals(res.status, 413);
  const body = await res.json();
  assertEquals(body.error.code, "request_too_large");
  assertEquals(counts.authenticate, 0);
});

// ---------------------------------------------------------------------------
// CORS preflight
// ---------------------------------------------------------------------------

Deno.test("valid OPTIONS preflight returns 204 with correct headers", async () => {
  const counts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  const req = new Request("http://localhost/v1/version", {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "GET",
    },
  });
  const res = await handleApiV1Request(req, makeDeps({ counts }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
  assertEquals(res.headers.get("X-Request-ID"), FIXED_REQUEST_ID);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  const raw = await res.arrayBuffer();
  assertEquals(raw.byteLength, 0);
  assertEquals(counts.authenticate, 0);
  assertEquals(counts.authorizeRoute, 0);
  assertEquals(counts.resolveRateLimitProfile, 0);
  assertEquals(counts.storeConsume, 0);
});

Deno.test("preflight missing Origin returns cors_origin_denied", async () => {
  const req = new Request("http://localhost/v1/version", {
    method: "OPTIONS",
    headers: { "Access-Control-Request-Method": "GET" },
  });
  const res = await handleApiV1Request(req, makeDeps());
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "cors_origin_denied");
});

Deno.test("preflight non-GET Access-Control-Request-Method returns route_not_found", async () => {
  const req = new Request("http://localhost/v1/version", {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "POST",
    },
  });
  const res = await handleApiV1Request(req, makeDeps());
  assertEquals(res.status, 404);
});

Deno.test("preflight missing Access-Control-Request-Method returns route_not_found", async () => {
  const req = new Request("http://localhost/v1/version", {
    method: "OPTIONS",
    headers: { Origin: ALLOWED_ORIGIN },
  });
  const res = await handleApiV1Request(req, makeDeps());
  assertEquals(res.status, 404);
});

Deno.test("preflight for unsupported path returns route_not_found", async () => {
  const req = new Request("http://localhost/v1/unknown", {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "GET",
    },
  });
  const res = await handleApiV1Request(req, makeDeps());
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------------------
// Authentication error safety
// ---------------------------------------------------------------------------

Deno.test("ApiAuthenticationError status/code/message are returned safely", async () => {
  const secretCause = { token: "supersecret", stack: "leak" };
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps({
      authenticate: () =>
        Promise.reject(new ApiAuthenticationError("client_disabled", secretCause)),
    }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "client_disabled");
  assertEquals(body.error.message, "Client is not authorized.");
  assertEquals(body.requestId, FIXED_REQUEST_ID);
  const serialized = JSON.stringify(body);
  assertFalse(serialized.includes("supersecret"));
  assertFalse(serialized.includes("stack"));
  // CORS still applied for allowed origin.
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
});

Deno.test("ApiAuthenticationError with token_expired maps to 401", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps({
      authenticate: () =>
        Promise.reject(new ApiAuthenticationError("token_expired")),
    }),
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "token_expired");
});

// ---------------------------------------------------------------------------
// Other error paths
// ---------------------------------------------------------------------------

Deno.test("ApiHttpError from authorize preserves safe status/code/message", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps({
      authorizeRoute: () =>
        Promise.reject(new ApiHttpError("invalid_request")),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "invalid_request");
});

Deno.test("unknown thrown value maps to safe internal_error", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps({
      authenticate: () => Promise.reject(new Error("boom")),
    }),
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "internal_error");
  assertFalse(JSON.stringify(body).includes("boom"));
});

Deno.test("rate-limit denial returns 429 safely", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps({ rateLimit: makeRateLimit(makeDenyStore()) }),
  );
  assertEquals(res.status, 429);
  const body = await res.json();
  assertEquals(body.error.code, "rate_limit_exceeded");
});

Deno.test("disabled API returns 503 safely", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps({ controls: DISABLED_CONTROLS }),
  );
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.error.code, "api_unavailable");
});

Deno.test("timeout returns request_timeout with 504", async () => {
  let timerHandle: number | undefined;
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps({
      timeoutMs: 1,
      authenticate: () =>
        new Promise<AuthenticatedApiContext>((resolve) => {
          timerHandle = setTimeout(() => resolve(AUTH_CONTEXT), 200);
        }),
    }),
  );
  if (timerHandle !== undefined) clearTimeout(timerHandle);
  assertEquals(res.status, 504);
  const body = await res.json();
  assertEquals(body.error.code, "request_timeout");
});

Deno.test("successful execution runs the protected pipeline exactly once", async () => {
  const counts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps({ counts }),
  );
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(counts.authenticate, 1);
  assertEquals(counts.authorizeRoute, 1);
  assertEquals(counts.resolveRateLimitProfile, 1);
  assertEquals(counts.storeConsume, 1);
});

Deno.test("error responses retain CORS headers for an allowed Origin", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    makeDeps({
      authorizeRoute: () => Promise.reject(new ApiHttpError("invalid_request")),
    }),
  );
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), ALLOWED_ORIGIN);
  assertEquals(res.headers.get("X-Request-ID"), FIXED_REQUEST_ID);
  await res.body?.cancel();
});

// ---------------------------------------------------------------------------
// Request ID handling
// ---------------------------------------------------------------------------

Deno.test("invalid supplied X-Request-ID uses fallback 'unavailable' and is not echoed", async () => {
  const req = makeGet("http://localhost/v1/version", {
    "X-Request-ID": "bad id with spaces",
    Origin: ALLOWED_ORIGIN,
  });
  const res = await handleApiV1Request(req, makeDeps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "invalid_request_id");
  assertEquals(body.requestId, "unavailable");
  assertEquals(res.headers.get("X-Request-ID"), "unavailable");
  assertFalse(JSON.stringify(body).includes("bad id"));
});

Deno.test("valid supplied X-Request-ID is preserved", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version", {
      "X-Request-ID": "abc-123",
      Origin: ALLOWED_ORIGIN,
    }),
    makeDeps(),
  );
  assertEquals(res.headers.get("X-Request-ID"), "abc-123");
  await res.body?.cancel();
});

// ---------------------------------------------------------------------------
// Malformed internal invocation
// ---------------------------------------------------------------------------

Deno.test("non-Request first argument returns safe 500 with fallback requestId", async () => {
  const res = await handleApiV1Request(
    // deno-lint-ignore no-explicit-any
    ({ url: "http://x/v1/version" } as any) as Request,
    makeDeps(),
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "internal_error");
  assertEquals(body.requestId, "unavailable");
});

Deno.test("malformed dependencies return safe 500 without serialization", async () => {
  const secret = { serviceRoleKey: "SUPER_SECRET" };
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version"),
    // deno-lint-ignore no-explicit-any
    (secret as any) as ApiV1HttpHandlerDependencies,
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "internal_error");
  assertFalse(JSON.stringify(body).includes("SUPER_SECRET"));
});

Deno.test("dependencies with non-positive timeoutMs are rejected safely", async () => {
  const deps: ApiV1HttpHandlerDependencies = {
    controls: ENABLED_CONTROLS,
    allowedOrigins: new Set<string>([ALLOWED_ORIGIN]),
    timeoutMs: 0,
    requestId: { randomUUID: () => FIXED_REQUEST_ID },
    protectedRoute: {
      authenticate: () => Promise.resolve(AUTH_CONTEXT),
      authorizeRoute: () => Promise.resolve(),
      resolveRateLimitProfile: () =>
        Promise.resolve({ limit: 100, windowSeconds: 60 }),
      rateLimit: makeRateLimit(makeAllowStore()),
      readMe: () => Promise.resolve(ME_PAYLOAD),
      readOrganizations: () =>
        Promise.reject(new ApiHttpError("internal_error")),
      readWorkspaces: () =>
        Promise.reject(new ApiHttpError("internal_error")),
      readProjects: () =>
        Promise.reject(new ApiHttpError("internal_error")),
      readProjectDetail: () =>
        Promise.reject(new ApiHttpError("internal_error")),
      readProjectPlanning: () =>
        Promise.reject(new ApiHttpError("internal_error")),
    },
  };
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version"),
    deps,
  );
  assertEquals(res.status, 500);
});

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

Deno.test("successful GET emits exactly one received and one completed event", async () => {
  const captured = await withLogCapture(async () => {
    const res = await handleApiV1Request(
      makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
      makeDeps(),
    );
    await res.body?.cancel();
    return res;
  });
  const logs = captured.logs;
  assertEquals(logs.length, 2);
  assertEquals(logs[0].payload.event, "api.request.received");
  assertEquals(logs[0].payload.requestId, FIXED_REQUEST_ID);
  assertEquals(logs[0].payload.method, "GET");
  assertEquals(logs[1].payload.event, "api.request.completed");
  assertEquals(logs[1].payload.method, "GET");
  assertEquals(logs[1].payload.routeId, "version.get");
  assertEquals(logs[1].payload.status, 200);
});

Deno.test("failure log contains no URL, path, origin, token, IDs, or cause", async () => {
  const captured = await withLogCapture(async () => {
    const res = await handleApiV1Request(
      makeGet(
        "http://localhost/v1/version?leak=1",
        { Origin: ALLOWED_ORIGIN, Authorization: "Bearer SECRET_TOKEN" },
      ),
      makeDeps({
        authenticate: () =>
          Promise.reject(
            new ApiAuthenticationError("client_disabled", {
              userId: "leak-user",
            }),
          ),
      }),
    );
    await res.body?.cancel();
    return res;
  });
  const all = JSON.stringify(captured.logs);
  assertFalse(all.includes("/v1/version"));
  assertFalse(all.includes("leak=1"));
  assertFalse(all.includes(ALLOWED_ORIGIN));
  assertFalse(all.includes("SECRET_TOKEN"));
  assertFalse(all.includes("leak-user"));
  // Auth error codes must not appear in the ApiHttpErrorCode logging field.
  for (const l of captured.logs) {
    assertNotEqual(l.payload.code, "client_disabled");
  }
});

Deno.test("preflight emits exactly one received and one completed event", async () => {
  const captured = await withLogCapture(async () => {
    const req = new Request("http://localhost/v1/version", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    });
    return await handleApiV1Request(req, makeDeps());
  });
  const logs = captured.logs;
  assertEquals(logs.length, 2);
  assertEquals(logs[0].payload.event, "api.request.received");
  assertEquals(logs[0].payload.method, "OPTIONS");
  assertEquals(logs[1].payload.event, "api.request.completed");
  assertEquals(logs[1].payload.method, "OPTIONS");
  assertEquals(logs[1].payload.status, 204);
  assertEquals(logs[1].payload.routeId, "version.get");
});

// ---------------------------------------------------------------------------
// Static hygiene — no Deno.env / Deno.serve / Supabase in handler.ts
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// API-G.2D — GET /v1/me
// ---------------------------------------------------------------------------

Deno.test("GET /v1/me returns 200 with the exact reader payload", async () => {
  const counts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  const seen: { req: Request | null; ctx: unknown } = { req: null, ctx: null };
  const request = makeGet("http://localhost/v1/me", { Origin: ALLOWED_ORIGIN });
  const res = await handleApiV1Request(
    request,
    makeDeps({
      counts,
      readMe: (r, c) => {
        counts.readMe++;
        seen.req = r;
        seen.ctx = c;
        return Promise.resolve(ME_PAYLOAD);
      },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { userId: USER_ID });
  assertEquals(counts.readMe, 1);
  assertStrictEquals(seen.req, request);
  assertStrictEquals(seen.ctx, AUTH_CONTEXT);
  assertEquals(counts.authenticate, 1);
  assertEquals(counts.authorizeRoute, 1);
  assertEquals(counts.resolveRateLimitProfile, 1);
  assertEquals(counts.storeConsume, 1);
});

Deno.test("GET /v1/me is unavailable when reads are disabled", async () => {
  const counts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/me"),
    makeDeps({ controls: DISABLED_CONTROLS, counts }),
  );
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error.code, "api_unavailable");
  assertEquals(counts.readMe, 0);
});

Deno.test("GET /v1/me path variants are unsupported", async () => {
  for (
    const target of [
      "http://localhost/v1/me/",
      "http://localhost/v1/ME",
      "http://localhost/v1/me?x=1",
      "http://localhost/v1/me/extra",
    ]
  ) {
    const res = await handleApiV1Request(makeGet(target), makeDeps());
    assertEquals(res.status, 404);
    assertEquals((await res.json()).error.code, "route_not_found");
  }
});

Deno.test("/v1/me reader errors map to safe responses", async () => {
  const cases: Array<[unknown, number, string]> = [
    [new ApiAuthenticationError("invalid_token"), 401, "invalid_token"],
    [new ApiHttpError("not_authorized"), 403, "not_authorized"],
    [new ApiHttpError("internal_error"), 500, "internal_error"],
    ["unexpected", 500, "internal_error"],
  ];
  for (const [thrown, status, code] of cases) {
    const res = await handleApiV1Request(
      makeGet("http://localhost/v1/me"),
      makeDeps({ readMe: () => Promise.reject(thrown) }),
    );
    assertEquals(res.status, status);
    assertEquals((await res.json()).error.code, code);
  }
});

Deno.test("no /v1/me read occurs when authentication, authorization, profile or rate limit fails", async () => {
  const overrides: DepsOverrides[] = [
    { authenticate: () => Promise.reject(new ApiAuthenticationError("invalid_token")) },
    { authorizeRoute: () => Promise.reject(new ApiHttpError("not_authorized")) },
    { resolveRateLimitProfile: () => Promise.reject(new ApiHttpError("internal_error")) },
    { rateLimit: makeRateLimit(makeDenyStore()) },
  ];
  for (const o of overrides) {
    let reads = 0;
    const res = await handleApiV1Request(
      makeGet("http://localhost/v1/me"),
      makeDeps({
        ...o,
        readMe: () => {
          reads++;
          return Promise.resolve(ME_PAYLOAD);
        },
      }),
    );
    assertFalse(res.ok);
    assertEquals(reads, 0);
  }
});

Deno.test("metadata routes never invoke readMe", async () => {
  let reads = 0;
  const deps = makeDeps({
    readMe: () => {
      reads++;
      return Promise.resolve(ME_PAYLOAD);
    },
  });
  await (await handleApiV1Request(makeGet("http://localhost/v1/version"), deps))
    .body?.cancel();
  await (await handleApiV1Request(
    makeGet("http://localhost/v1/capabilities"),
    deps,
  )).body?.cancel();
  assertEquals(reads, 0);
});

Deno.test("live index.ts wires the caller-scoped reader with the anon key only", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(src.includes("createDelegatedApiV1MeReader("));
  assert(
    src.includes(
      "createDelegatedApiV1MeReader(\n    supabaseUrl,\n    supabaseAnonKey,\n    (url, key, options) => createClient(url, key, options),\n  )",
    ),
  );
  assert(src.includes("readMe,"));
  // The reader must never be built from the privileged/service-role client.
  const readerBlockStart = src.indexOf("createDelegatedApiV1MeReader(");
  const readerBlock = src.slice(readerBlockStart, readerBlockStart + 300);
  assertFalse(readerBlock.includes("privilegedClient"));
  assertFalse(readerBlock.includes("supabaseServiceRoleKey"));
  // API-N.RG2 — live route-authorization registration parity (and the route
  // import structure that proves it) is owned centrally by
  // api-v1-live-authorization-registration.test.ts.

  assert(src.includes("createDelegatedApiV1OrganizationsReader("));
  assert(src.includes("readOrganizations,"));
  assert(src.includes("createDelegatedApiV1WorkspacesReader("));
  assert(src.includes("readWorkspaces,"));
  assert(
    src.includes(
      "createDelegatedApiV1ProjectsReader(\n    supabaseUrl,\n    supabaseAnonKey,\n    (url, key, options) => createClient(url, key, options),\n  )",
    ),
  );
  assert(src.includes("readProjects,"));
  assert(src.includes("readProjectDetail,"));
  assert(src.includes("readProjectPlanning,"));
  assert(
    src.includes(
      'import { PROJECT_PLANNING_ROUTE } from "./routes/projectPlanning.ts";',
    ),
  );
  assert(src.includes("createDelegatedApiV1ProjectPlanningReader("));
  assert(
    src.includes(
      'import { PROJECT_DETAIL_ROUTE } from "./routes/projectDetail.ts";',
    ),
  );
  assert(src.includes("createDelegatedApiV1ProjectDetailReader("));
  const projectsBlockStart = src.indexOf("createDelegatedApiV1ProjectsReader(");
  const projectsBlock = src.slice(projectsBlockStart, projectsBlockStart + 300);
  assertFalse(projectsBlock.includes("privilegedClient"));
  assertFalse(projectsBlock.includes("supabaseServiceRoleKey"));
  // Rate-profile resolution still uses the exact route id.
  assert(src.includes("profileResolver.resolve(context.client.apiClientId, route.id)"));
  assertEquals(ME_ROUTE.id, "me.get");
  assertEquals(VERSION_ROUTE.id, "version.get");
  assertEquals(CAPABILITIES_ROUTE.id, "capabilities.get");
  assertEquals(ORGANIZATIONS_ROUTE.id, "organizations.get");
  assertEquals(WORKSPACES_ROUTE.id, "workspaces.get");
  assertEquals(PROJECTS_ROUTE.id, "projects.get");
});

const PROJECTS_WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const PROJECTS_PAYLOAD = Object.freeze({
  items: Object.freeze([]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 0, total: 0 }),
}) as unknown as ApiV1ProjectsPayload;

const WORKSPACES_ORGANIZATION_ID = "55555555-5555-4555-8555-555555555555";
const WORKSPACES_PAYLOAD = Object.freeze({
  items: Object.freeze([]),
  pagination: Object.freeze({ limit: 50, offset: 0, returned: 0, total: 0 }),
}) as unknown as ApiV1WorkspacesPayload;



// API-H.3E-C1 — Query-aware transport targeting for the approved collection
// routes. `handler.ts` matches `/v1/organizations`, `/v1/workspaces` and
// `/v1/projects` by pathname only, while the original Request (and therefore
// the original query string) reaches the strict downstream parsers.
Deno.test("API-H.3E-C1 transport: GET /v1/workspaces with a query reaches the workspaces reader", async () => {
  let calls = 0;
  let seenQuery: unknown = null;
  const res = await handleApiV1Request(
    makeGet(
      `http://localhost/v1/workspaces?organization_id=${WORKSPACES_ORGANIZATION_ID}`,
      { Authorization: "Bearer token" },
    ),
    makeDeps({
      readWorkspaces: (_req, _ctx, q) => {
        calls++;
        seenQuery = q;
        return Promise.resolve(WORKSPACES_PAYLOAD);
      },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), JSON.parse(JSON.stringify(WORKSPACES_PAYLOAD)));
  assertEquals(calls, 1);
  assertEquals(seenQuery, {
    organizationId: WORKSPACES_ORGANIZATION_ID,
    limit: 50,
    offset: 0,
    search: null,
  });
});

Deno.test("API-H.3E-C1 transport: GET /v1/projects with a query reaches the projects reader", async () => {
  let calls = 0;
  let seenQuery: unknown = null;
  const res = await handleApiV1Request(
    makeGet(
      `http://localhost/v1/projects?workspace_id=${PROJECTS_WORKSPACE_ID}`,
      { Authorization: "Bearer token" },
    ),
    makeDeps({
      readProjects: (_req, _ctx, q) => {
        calls++;
        seenQuery = q;
        return Promise.resolve(PROJECTS_PAYLOAD);
      },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), JSON.parse(JSON.stringify(PROJECTS_PAYLOAD)));
  assertEquals(calls, 1);
  assertEquals(seenQuery, {
    workspaceId: PROJECTS_WORKSPACE_ID,
    limit: 50,
    offset: 0,
    search: null,
  });
});

Deno.test("API-H.3E-C1 transport: invalid /v1/projects query fails before authentication", async () => {
  const counts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  let readProjectsCalls = 0;
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/projects?workspace_id=not-a-uuid", {
      Authorization: "Bearer token",
    }),
    makeDeps({
      counts,
      readProjects: () => {
        readProjectsCalls++;
        return Promise.resolve(PROJECTS_PAYLOAD);
      },
    }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "invalid_request");
  assertEquals(counts.authenticate, 0);
  assertEquals(counts.authorizeRoute, 0);
  assertEquals(counts.resolveRateLimitProfile, 0);
  assertEquals(counts.storeConsume, 0);
  assertEquals(readProjectsCalls, 0);
});

Deno.test("API-H.3E-C1 transport: static route with a query stays unsupported", async () => {
  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/version?x=1"),
    makeDeps(),
  );
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "route_not_found");
});


Deno.test("handler.ts contains no forbidden runtime constructs", async () => {
  const src = await Deno.readTextFile(
    new URL("../handler.ts", import.meta.url),
  );
  assertFalse(src.includes("Deno.env"));
  assertFalse(src.includes("Deno.serve"));
  assertFalse(src.includes("process.env"));
  assertFalse(src.includes("createClient"));
  assertFalse(src.includes("supabase-js"));
  assertFalse(src.includes("service_role"));
  assertFalse(src.includes("SERVICE_ROLE"));
  // No wildcard CORS.
  assertFalse(src.includes('"*"'));
});

Deno.test("invalid request ID emits fallback received and terminal events", async () => {
  const captured = await withLogCapture(async () => {
    const req = makeGet("http://localhost/v1/version", {
      "X-Request-ID": "bad id with spaces",
      Origin: ALLOWED_ORIGIN,
    });
    const res = await handleApiV1Request(req, makeDeps());
    await res.body?.cancel();
    return res;
  });
  const logs = captured.logs;
  assertEquals(logs.length, 2);
  assertEquals(logs[0].payload.event, "api.request.received");
  assertEquals(logs[0].payload.requestId, "unavailable");
  assertEquals(
    logs[1].payload.event === "api.request.rejected" ||
      logs[1].payload.event === "api.request.failed",
    true,
  );
  const serialized = JSON.stringify(logs);
  assertFalse(serialized.includes("bad id"));
  assertFalse(serialized.includes("bad id with spaces"));
});

// ---------------------------------------------------------------------------
// Tiny helper used above
// ---------------------------------------------------------------------------

function assertNotEqual(actual: unknown, forbidden: unknown): void {
  assert(actual !== forbidden, `expected value not to equal ${String(forbidden)}`);
}

// silence unused import warnings for types imported only for narrowing
export type _Unused = ApiProtectedRouteDependencies;
export type _UnusedOrgs = ApiV1OrganizationsPayload;
export const _unusedStrict = assertStrictEquals;

// ---------------------------------------------------------------------------
// API-G.2H — GET /v1/organizations end-to-end wiring
// ---------------------------------------------------------------------------

const ORGANIZATIONS_PAYLOAD: ApiV1OrganizationsPayload = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Acme",
      role: "org_admin" as const,
    }),
  ]) as ReadonlyArray<{
    readonly organizationId: string;
    readonly name: string;
    readonly role: "org_admin" | "org_member";
  }>,
  pagination: Object.freeze({
    limit: 25,
    offset: 10,
    returned: 1,
    total: 1,
  }),
}) as ApiV1OrganizationsPayload;

Deno.test("API-G.2H wires GET /v1/organizations through the protected pipeline", async () => {
  // Case A — valid query returns the exact reader payload; the reader
  // receives the exact Request, authenticated context and parsed frozen
  // query; the protected pipeline runs once with route id
  // "organizations.get".
  const counts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  const storeInputs: ApiRateLimitStoreInput[] = [];
  const rateLimit: ApiRateLimitDependencies = {
    store: {
      consume(input) {
        storeInputs.push(input);
        counts.storeConsume++;
        return Promise.resolve({
          allowed: true,
          remaining: 99,
          resetAtEpochMs: 1_700_000_000_000,
        });
      },
    },
    now: () => 1_600_000_000_000,
  };
  const seenAuthorize: {
    ctx: unknown;
    route: unknown;
  } = { ctx: null, route: null };
  const seenReader: {
    req: Request | null;
    ctx: unknown;
    query: unknown;
  } = { req: null, ctx: null, query: null };
  const validRequest = makeGet(
    "http://localhost/v1/organizations?limit=25&offset=10&search=hello+world",
    { Origin: ALLOWED_ORIGIN },
  );
  const okDeps = makeDeps({
    counts,
    rateLimit,
    authorizeRoute: (ctx, route) => {
      counts.authorizeRoute++;
      seenAuthorize.ctx = ctx;
      seenAuthorize.route = route;
      return Promise.resolve();
    },
    readOrganizations: (r, c, q) => {
      seenReader.req = r;
      seenReader.ctx = c;
      seenReader.query = q;
      return Promise.resolve(ORGANIZATIONS_PAYLOAD);
    },
  });
  const okRes = await handleApiV1Request(validRequest, okDeps);
  assertEquals(okRes.status, 200);
  assertEquals(await okRes.json(), {
    items: [
      {
        organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Acme",
        role: "org_admin",
      },
    ],
    pagination: { limit: 25, offset: 10, returned: 1, total: 1 },
  });
  assertStrictEquals(seenReader.req, validRequest);
  assertStrictEquals(seenReader.ctx, AUTH_CONTEXT);
  assertEquals(seenReader.query, { limit: 25, offset: 10, search: "hello world" });
  assert(Object.isFrozen(seenReader.query as object));
  assertStrictEquals(seenAuthorize.route, ORGANIZATIONS_ROUTE);
  assertEquals(counts.authenticate, 1);
  assertEquals(counts.authorizeRoute, 1);
  assertEquals(counts.resolveRateLimitProfile, 1);
  assertEquals(counts.storeConsume, 1);
  assertEquals(storeInputs.length, 1);
  assertEquals(storeInputs[0].routeId, "organizations.get");
  assertEquals(counts.readMe, 0);

  // Case B — malformed Organizations query returns invalid_request BEFORE
  // authentication or reader execution.
  const badCounts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  let orgReaderCalls = 0;
  const badRes = await handleApiV1Request(
    makeGet("http://localhost/v1/organizations?limit=abc", {
      Origin: ALLOWED_ORIGIN,
    }),
    makeDeps({
      counts: badCounts,
      readOrganizations: (_r, _c, _q) => {
        orgReaderCalls++;
        return Promise.resolve(ORGANIZATIONS_PAYLOAD);
      },
    }),
  );
  assertEquals(badRes.status, 400);
  assertEquals((await badRes.json()).error.code, "invalid_request");
  assertEquals(badCounts.authenticate, 0);
  assertEquals(orgReaderCalls, 0);

  // Case C — a query on /v1/me remains route_not_found.
  const meQueryRes = await handleApiV1Request(
    makeGet("http://localhost/v1/me?x=1", { Origin: ALLOWED_ORIGIN }),
    makeDeps(),
  );
  assertEquals(meQueryRes.status, 404);
  assertEquals((await meQueryRes.json()).error.code, "route_not_found");

  // Case D — OPTIONS for /v1/organizations with a query returns 204
  // without authentication or reader execution.
  const optCounts: CallCounts = {
    authenticate: 0,
    authorizeRoute: 0,
    resolveRateLimitProfile: 0,
    storeConsume: 0,
    readMe: 0,
  };
  let optReaderCalls = 0;
  const optRes = await handleApiV1Request(
    new Request(
      "http://localhost/v1/organizations?limit=25&offset=10&search=hello+world",
      {
        method: "OPTIONS",
        headers: {
          Origin: ALLOWED_ORIGIN,
          "Access-Control-Request-Method": "GET",
        },
      },
    ),
    makeDeps({
      counts: optCounts,
      readOrganizations: (_r, _c, _q) => {
        optReaderCalls++;
        return Promise.resolve(ORGANIZATIONS_PAYLOAD);
      },
    }),
  );
  assertEquals(optRes.status, 204);
  assertEquals(optCounts.authenticate, 0);
  assertEquals(optReaderCalls, 0);
});

// ---------------------------------------------------------------------------
// API-G.5.10A-3 — durable-activity composition and scheduling
// ---------------------------------------------------------------------------

import type {
  ApiActivityRecordInput,
  ApiActivityRecorder,
} from "../../_shared/btpm-api/supabaseActivity.ts";
import type { ApiV1ActivityDependencies } from "../handler.ts";

interface ActivityHarness {
  readonly inputs: ApiActivityRecordInput[];
  readonly scheduled: Promise<boolean>[];
  readonly activity: ApiV1ActivityDependencies;
}

function makeActivity(options: {
  clock?: (() => number)[];
  nowMs?: () => number;
  record?: ApiActivityRecorder["record"];
  schedule?: (task: Promise<boolean>) => void;
} = {}): ActivityHarness {
  const inputs: ApiActivityRecordInput[] = [];
  const scheduled: Promise<boolean>[] = [];
  const clock = options.clock ? [...options.clock] : undefined;
  const activity: ApiV1ActivityDependencies = {
    recorder: {
      record: options.record ??
        ((input: ApiActivityRecordInput) => {
          inputs.push(input);
          return Promise.resolve(true);
        }),
    },
    nowMs: options.nowMs ??
      (() => {
        const next = clock?.shift();
        if (next === undefined) return 0;
        return next();
      }),
    schedule: options.schedule ?? ((task) => {
      scheduled.push(task);
      task.catch(() => false);
    }),
  };
  return { inputs, scheduled, activity };
}

function withActivity(
  base: ApiV1HttpHandlerDependencies,
  activity: unknown,
): ApiV1HttpHandlerDependencies {
  return Object.freeze({
    ...base,
    activity,
  }) as ApiV1HttpHandlerDependencies;
}

Deno.test("successful GET schedules exactly one non-blocking activity record", async () => {
  let resolveRecord: ((v: boolean) => void) | undefined;
  const captured: ApiActivityRecordInput[] = [];
  const harness = makeActivity({
    clock: [() => 1_000, () => 1_042],
    record: (input) => {
      captured.push(input);
      return new Promise<boolean>((resolve) => {
        resolveRecord = resolve;
      });
    },
  });

  const res = await handleApiV1Request(
    makeGet("http://localhost/v1/me", { Origin: ALLOWED_ORIGIN }),
    withActivity(makeDeps(), harness.activity),
  );

  // HTTP result resolves before the recording promise settles.
  assertEquals(res.status, 200);
  assertEquals(await res.json(), ME_PAYLOAD);
  assertEquals(res.headers.get("X-Request-ID"), FIXED_REQUEST_ID);

  assertStrictEquals(harness.scheduled.length, 1);
  assertStrictEquals(captured.length, 1);
  assertEquals(captured[0], {
    apiClientId: API_CLIENT_ID,
    apiVersion: "v1",
    routeId: ME_ROUTE.id,
    method: "GET",
    status: 200,
    durationMs: 42,
    actorUserId: USER_ID,
    tenantId: null,
    organizationId: null,
    workspaceId: null,
    projectId: null,
    correlationId: FIXED_REQUEST_ID,
  });
  // No request or response payload data enters the activity input.
  assertFalse(JSON.stringify(captured[0]).includes("userId"));

  resolveRecord?.(true);
  assertStrictEquals(await harness.scheduled[0], true);
});

Deno.test("instrumentation failures never alter the successful response", async () => {
  const expectedBody = buildVersionPayload();

  const assertUnchanged = async (
    activity: unknown,
    expectedRequestId = FIXED_REQUEST_ID,
    headers: Record<string, string> = { Origin: ALLOWED_ORIGIN },
  ): Promise<Response> => {
    const res = await handleApiV1Request(
      makeGet("http://localhost/v1/version", headers),
      withActivity(makeDeps(), activity),
    );
    assertEquals(res.status, 200);
    assertEquals(await res.json(), expectedBody);
    assertEquals(res.headers.get("X-Request-ID"), expectedRequestId);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
    assertEquals(
      res.headers.get("Access-Control-Allow-Origin"),
      ALLOWED_ORIGIN,
    );
    return res;
  };

  // Case A — nowMs() throws.
  const throwingClock = makeActivity({
    nowMs: () => {
      throw new Error("clock-boom");
    },
  });
  await assertUnchanged(throwingClock.activity);
  assertStrictEquals(throwingClock.scheduled.length, 0);

  // Case B — backwards clock.
  const backwards = makeActivity({ clock: [() => 5_000, () => 4_000] });
  await assertUnchanged(backwards.activity);
  assertStrictEquals(backwards.scheduled.length, 0);

  // Case C — recorder throws synchronously.
  const syncThrow = makeActivity({
    clock: [() => 10, () => 20],
    record: () => {
      throw new Error("record-boom");
    },
  });
  await assertUnchanged(syncThrow.activity);
  assertStrictEquals(syncThrow.scheduled.length, 1);
  assertStrictEquals(await syncThrow.scheduled[0], false);

  // Case D — recorder rejects.
  const rejecting = makeActivity({
    clock: [() => 10, () => 20],
    record: () => Promise.reject(new Error("record-reject")),
  });
  await assertUnchanged(rejecting.activity);
  assertStrictEquals(rejecting.scheduled.length, 1);
  assertStrictEquals(await rejecting.scheduled[0], false);

  // Case E — scheduler throws.
  const badScheduler = makeActivity({
    clock: [() => 10, () => 20],
    schedule: () => {
      throw new Error("schedule-boom");
    },
  });
  await assertUnchanged(badScheduler.activity);

  // Case F — malformed optional activity dependency.
  for (const malformed of [null, [], "x", 1, {}, { recorder: {} }]) {
    await assertUnchanged(malformed);
  }

  // Case G — unsafe but valid HTTP request ID schedules correlationId: null.
  const unsafeId = "req.id:1/2";
  const unsafe = makeActivity({ clock: [() => 100, () => 150] });
  await assertUnchanged(unsafe.activity, unsafeId, {
    Origin: ALLOWED_ORIGIN,
    "X-Request-ID": unsafeId,
  });
  assertStrictEquals(unsafe.scheduled.length, 1);
  assertStrictEquals(unsafe.inputs.length, 1);
  assertStrictEquals(unsafe.inputs[0].correlationId, null);
  assertStrictEquals(unsafe.inputs[0].routeId, VERSION_ROUTE.id);
});

Deno.test("non-success flows never record durable activity", async () => {
  // OPTIONS preflight.
  const preflight = makeActivity({ clock: [() => 1, () => 2] });
  const preflightRes = await handleApiV1Request(
    new Request("http://localhost/v1/version", {
      method: "OPTIONS",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Access-Control-Request-Method": "GET",
      },
    }),
    withActivity(makeDeps(), preflight.activity),
  );
  assertEquals(preflightRes.status, 204);
  assertStrictEquals(preflight.scheduled.length, 0);
  assertStrictEquals(preflight.inputs.length, 0);

  // Authentication failure.
  const authFail = makeActivity({ clock: [() => 1, () => 2] });
  const authRes = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    withActivity(
      makeDeps({
        authenticate: () =>
          Promise.reject(
            new ApiAuthenticationError("invalid_token", "Invalid token."),
          ),
      }),
      authFail.activity,
    ),
  );
  assertEquals(authRes.status, 401);
  assertStrictEquals(authFail.scheduled.length, 0);

  // Rate-limit rejection.
  const limited = makeActivity({ clock: [() => 1, () => 2] });
  const limitRes = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    withActivity(
      makeDeps({ rateLimit: makeRateLimit(makeDenyStore()) }),
      limited.activity,
    ),
  );
  assertEquals(limitRes.status, 429);
  assertEquals((await limitRes.json()).error.code, "rate_limit_exceeded");
  assertStrictEquals(limited.scheduled.length, 0);

  // Route not found.
  const missing = makeActivity({ clock: [() => 1, () => 2] });
  const missingRes = await handleApiV1Request(
    makeGet("http://localhost/v1/nope", { Origin: ALLOWED_ORIGIN }),
    withActivity(makeDeps(), missing.activity),
  );
  assertEquals(missingRes.status, 404);
  assertEquals((await missingRes.json()).error.code, "route_not_found");
  assertStrictEquals(missing.scheduled.length, 0);

  // Timeout.
  const timedOut = makeActivity({ clock: [() => 1, () => 2] });
  let timerHandle: number | undefined;
  const timeoutRes = await handleApiV1Request(
    makeGet("http://localhost/v1/version", { Origin: ALLOWED_ORIGIN }),
    withActivity(
      makeDeps({
        timeoutMs: 1,
        authenticate: () =>
          new Promise<AuthenticatedApiContext>((resolve) => {
            timerHandle = setTimeout(() => resolve(AUTH_CONTEXT), 200);
          }),
      }),
      timedOut.activity,
    ),
  );
  if (timerHandle !== undefined) clearTimeout(timerHandle);
  assertEquals(timeoutRes.status, 504);
  assertEquals((await timeoutRes.json()).error.code, "request_timeout");
  assertStrictEquals(timedOut.scheduled.length, 0);
});
