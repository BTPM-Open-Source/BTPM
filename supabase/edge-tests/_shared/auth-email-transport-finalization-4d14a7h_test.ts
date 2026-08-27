// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/auth-email-transport-finalization-4d14a7h_test.ts', import.meta.url).href;
// Phase 4D.14A.7H — sendAuthEmail final contract.
// Ensures: Organization ID is required; on missing org the helper
// returns a safe failed_configuration outcome without ever calling
// any fallback transport.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sendAuthEmail } from "../../functions/_shared/authOutboundEmail.ts";

Deno.test("sendAuthEmail rejects missing Organization context safely", async () => {
  const r = await sendAuthEmail({
    // deno-lint-ignore no-explicit-any
    organizationId: undefined as any,
    recipientEmail: "user@example.com",
    emailType: "test",
    eventKey: "test:missing_org",
    subject: "s",
    htmlBody: "<p/>",
    functionName: "unit-test",
  });
  assertEquals(r.ok, false);
  assertEquals(r.transport, "tenant_smtp");
  assertEquals(r.status, "failed_configuration");
  assertEquals(r.errorCode, "organization_context_missing");
});

Deno.test("sendAuthEmail rejects empty Organization string safely", async () => {
  const r = await sendAuthEmail({
    organizationId: "",
    recipientEmail: "user@example.com",
    emailType: "test",
    eventKey: "test:empty_org",
    subject: "s",
    htmlBody: "<p/>",
    functionName: "unit-test",
  });
  assertEquals(r.ok, false);
  assertEquals(r.transport, "tenant_smtp");
  assertEquals(r.errorCode, "organization_context_missing");
});

Deno.test("sendAuthEmail source contains no Graph or fallback plumbing", async () => {
  const p = new URL("./authOutboundEmail.ts", __BTPM_SRC_BASE__);
  const text = await Deno.readTextFile(p);
  const banned = [
    "sendGraphMail",
    "global_graph_fallback",
    "sent_fallback",
    "failed_fallback",
    "graphMail.ts",
  ];
  for (const term of banned) {
    if (text.includes(term)) {
      throw new Error(`authOutboundEmail.ts must not contain: ${term}`);
    }
  }
});
