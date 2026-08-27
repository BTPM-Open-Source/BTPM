// API-G.5.10A-4 — Static verification of live durable activity activation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SOURCE = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

function countOf(needle: string): number {
  return SOURCE.split(needle).length - 1;
}

Deno.test("A-4 composes exactly one service-role activity recorder", () => {
  assert(SOURCE.includes("API-G.5.10A-4 — Live durable activity activation"));
  assert(
    SOURCE.includes(
      'import { createSupabaseActivityRecorder } from "../_shared/btpm-api/supabaseActivity.ts";',
    ),
  );

  assertEquals(countOf("const activityRecorder = createSupabaseActivityRecorder("), 1);
  assert(
    /createSupabaseActivityRecorder\(\s*privilegedClient as unknown as Parameters</
      .test(SOURCE),
  );
  assert(!/createSupabaseActivityRecorder\(\s*authClient/.test(SOURCE));

  // No new Supabase client introduced for activity: the two existing clients only.
  assertEquals(countOf("createClient(supabaseUrl,"), 2);

  assert(!SOURCE.includes("api_request_activity_events"));
  assert(!SOURCE.includes(".from("));
  assert(!SOURCE.includes(".insert("));
});

Deno.test("A-4 supplies the live activity dependencies", () => {
  assert(SOURCE.includes("activity: Object.freeze({"));
  assert(SOURCE.includes("recorder: activityRecorder,"));
  assert(SOURCE.includes("nowMs: () => Date.now(),"));
  assert(SOURCE.includes("schedule: (task: Promise<boolean>) => {"));
  assert(SOURCE.includes("EdgeRuntime.waitUntil(task);"));

  assert(SOURCE.includes("declare const EdgeRuntime: {"));
  assertEquals(countOf("EdgeRuntime.waitUntil("), 1);
  assert(!SOURCE.includes("await EdgeRuntime"));
  assert(!/waitUntil\(\s*task\s*\.\s*then/.test(SOURCE));
  assert(!/waitUntil\(\s*task\s*\.\s*catch/.test(SOURCE));

  // No new environment switch or feature flag for activity.
  assert(!/Deno\.env\.get\("[^"]*ACTIVITY[^"]*"\)/.test(SOURCE));
  assertEquals(countOf("Deno.env.get("), 7);
});

Deno.test("A-4 captures no sensitive data and preserves request handling", () => {
  for (
    const forbidden of [
      "req.json",
      "request.json",
      ".text()",
      "req.headers.get(\"authorization\")",
      "authorizationHeader",
      "cookie",
      "access_token",
      "refresh_token",
      "x-forwarded-for",
      "user-agent",
      "User-Agent",
      "console.log",
      "console.error",
      "console.warn",
      "retry",
      "setTimeout",
      "setInterval",
      "supabase/migrations",
      "integrations/supabase/types",
      "src/",
    ]
  ) {
    assert(!SOURCE.includes(forbidden), `unexpected: ${forbidden}`);
  }

  assert(
    SOURCE.includes(
      "return await handleApiV1Request(\n    normalizedRequest,\n    INITIALIZED_DEPENDENCIES,\n  );",
    ),
  );
});
