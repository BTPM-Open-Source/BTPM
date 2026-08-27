// BTPM — Notification Pipeline Correction Step 1
// Secure Scheduler Authentication — static contract test.
//
// Structural inspection of the committed worker source, config.toml and the
// forward migration only. No live calls, no secrets read.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const WORKER_URL = new URL(
  "../../functions/process-notifications/index.ts",
  import.meta.url,
);
const CONFIG_URL = new URL("../../config.toml", import.meta.url);
const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

const worker = await Deno.readTextFile(WORKER_URL);
const config = await Deno.readTextFile(CONFIG_URL);

const idx = (needle: string) => worker.indexOf(needle);

Deno.test("worker reads NOTIFICATION_WORKER_SCHEDULER_SECRET", () => {
  assertStringIncludes(
    worker,
    'Deno.env.get("NOTIFICATION_WORKER_SCHEDULER_SECRET")',
  );
});

Deno.test("worker reads the x-notification-worker-secret header", () => {
  assertStringIncludes(
    worker,
    'req.headers.get("x-notification-worker-secret")',
  );
});

Deno.test("worker compares the scheduler secret in constant time", () => {
  assertStringIncludes(worker, "async function secureSecretEqual(");
  assertStringIncludes(worker, "difference |= providedBytes[i] ^ expectedBytes[i]");
  assertStringIncludes(
    worker,
    "secureSecretEqual(presentedSecret, schedulerSecret)",
  );
});

Deno.test("missing/incorrect scheduler secret is rejected with a generic 401", () => {
  assertStringIncludes(worker, 'JSON.stringify({ error: "Unauthorized" })');
  assert(
    /if\s*\(!presentedSecret\)\s*\{\s*return unauthorizedResponse\(\);/.test(worker),
    "Missing header must short-circuit to Unauthorized.",
  );
  assert(
    /if\s*\(!\(await secureSecretEqual\(presentedSecret, schedulerSecret\)\)\)\s*\{\s*return unauthorizedResponse\(\);/
      .test(worker),
    "Mismatched secret must short-circuit to Unauthorized.",
  );
});

Deno.test("caller Authorization Bearer is not worker authority", () => {
  assert(
    !worker.includes('req.headers.get("Authorization")'),
    "The worker must not read a caller Authorization header as authority.",
  );
  assert(
    !/Bearer\s*"\.length/.test(worker) && !worker.includes('startsWith("Bearer '),
    "No Bearer token parsing may remain.",
  );
});

Deno.test("incoming data is never compared against SUPABASE_SERVICE_ROLE_KEY", () => {
  assert(
    !/secureSecretEqual\([^)]*serviceRoleKey/.test(worker),
    "Service-role key must not be used as an incoming credential.",
  );
});

Deno.test("service-role key is still used internally for the backend client", () => {
  assertStringIncludes(worker, 'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
  assertStringIncludes(worker, "createClient(supabaseUrl, serviceRoleKey)");
});

Deno.test("service-role client is constructed only after secret verification", () => {
  const verify = idx("secureSecretEqual(presentedSecret, schedulerSecret)");
  const readKey = idx('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
  const client = idx("createClient(supabaseUrl, serviceRoleKey)");
  assert(verify > 0 && readKey > verify, "Service-role key read must follow verification.");
  assert(client > readKey, "Client construction must follow verification.");
});

Deno.test("no anon-key client is introduced", () => {
  assert(!worker.includes("SUPABASE_ANON_KEY"), "No anon key in the worker.");
  assert(
    !worker.includes("SUPABASE_PUBLISHABLE_KEY"),
    "No publishable key in the worker.",
  );
  assertEquals((worker.match(/createClient\(/g) ?? []).length, 1);
});

Deno.test("batch size remains 20 and retry ceiling remains 3", () => {
  assertStringIncludes(worker, ".limit(20)");
  assert(/retry_count[^\n]*>=\s*3|newRetry\s*>=\s*3|>=\s*3/.test(worker), "Retry ceiling of 3 must remain.");
});

Deno.test("sendTenantEmail remains the outbound transport", () => {
  assertStringIncludes(
    worker,
    'import { sendTenantEmail } from "../_shared/tenantOutboundEmail.ts"',
  );
  assertStringIncludes(worker, "sendTenantEmail(");
  assert(!/nodemailer/i.test(worker), "No direct nodemailer transport.");
  assert(
    !/graph\.microsoft\.com|microsoftgraph/i.test(worker),
    "No Microsoft Graph sending in the worker.",
  );
});

Deno.test("config.toml disables gateway JWT verification for the worker", () => {
  assertStringIncludes(config, "[functions.process-notifications]");
  const section = config.slice(config.indexOf("[functions.process-notifications]"));
  assertStringIncludes(section.split("\n").slice(0, 3).join("\n"), "verify_jwt = false");
  assertStringIncludes(config, "NOTIFICATION_WORKER_SCHEDULER_SECRET");
});

Deno.test("forward migration carries the NOTIF-CORR.1 correction contract", async () => {
  const matches: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (sql.includes("NOTIF-CORR.1")) matches.push(entry.name);
  }
  assertEquals(matches.length, 1, `Expected one NOTIF-CORR.1 migration, got: ${matches.join(", ")}`);
  const sql = await Deno.readTextFile(new URL(matches[0], MIGRATIONS_DIR));
  assertStringIncludes(sql, "NOTIFICATION_WORKER_SCHEDULER_SECRET");
  assertStringIncludes(sql, "x-notification-worker-secret");
  assertStringIncludes(sql, "vault.decrypted_secrets");
  assertStringIncludes(sql, "DISABLE TRIGGER trg_notification_encrypt_payload");
  assertStringIncludes(sql, "ENABLE TRIGGER trg_notification_encrypt_payload");
  assertStringIncludes(sql, "'process-notifications-every-minute'");
  assertStringIncludes(sql, "'* * * * *'");
  assert(!/Authorization/i.test(sql), "Cron command must not carry an Authorization credential.");
  assert(!/eyJ[A-Za-z0-9_-]{10,}/.test(sql), "No JWT may be embedded in the migration.");
  assert(
    !/SUPABASE_SERVICE_ROLE_KEY/.test(sql),
    "Service-role key must not appear in the migration.",
  );
});
