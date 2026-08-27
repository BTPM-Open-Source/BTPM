// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/graph-mail-retirement-4d14a7h_static_test.ts', import.meta.url).href;
// Phase 4D.14A.7H — static invariants for Graph mail retirement.
// Pure filesystem checks; no network, no Supabase, no external calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readAll(root: string, exts: string[]): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  async function walk(dir: string) {
    for await (const entry of Deno.readDir(dir)) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(full);
      } else if (
        exts.some((e) => entry.name.endsWith(e)) &&
        !/(_test\.ts|\.test\.ts|\.test\.tsx)$/.test(entry.name)
      ) {
        try {
          out.push({ path: full, text: await Deno.readTextFile(full) });
        } catch (_) { /* ignore */ }
      }
    }
  }
  await walk(root);
  return out;
}

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__).pathname;

Deno.test("4D.14A.7H — graphMail.ts is deleted", async () => {
  const p = `${REPO_ROOT}supabase/functions/_shared/graphMail.ts`;
  assertEquals(await exists(p), false);
});

Deno.test("4D.14A.7H — no source file imports sendGraphMail", async () => {
  const files = [
    ...(await readAll(`${REPO_ROOT}supabase/functions`, [".ts"])),
    ...(await readAll(`${REPO_ROOT}src`, [".ts", ".tsx"])),
  ];
  const offenders = files.filter((f) => /sendGraphMail/.test(f.text));
  assertEquals(
    offenders.map((f) => f.path),
    [],
    "sendGraphMail must not appear in any source file",
  );
});

Deno.test("4D.14A.7H — no /sendMail endpoint reference in BTPM code", async () => {
  const files = [
    ...(await readAll(`${REPO_ROOT}supabase/functions`, [".ts"])),
    ...(await readAll(`${REPO_ROOT}src`, [".ts", ".tsx"])),
  ];
  const offenders = files.filter((f) => f.text.includes("/sendMail"));
  assertEquals(offenders.map((f) => f.path), []);
});

Deno.test("4D.14A.7H — no retired transport-outcome literals", async () => {
  const files = [
    ...(await readAll(`${REPO_ROOT}supabase/functions`, [".ts"])),
    ...(await readAll(`${REPO_ROOT}src`, [".ts", ".tsx"])),
  ];
  const banned = /global_graph_fallback|sent_fallback|failed_fallback/;
  const offenders = files.filter((f) => banned.test(f.text));
  assertEquals(offenders.map((f) => f.path), []);
});

Deno.test("4D.14A.7H — no runtime reader of M365_SENDER_EMAIL / M365_SENDER_NAME", async () => {
  const files = await readAll(`${REPO_ROOT}supabase/functions`, [".ts"]);
  const banned = /Deno\.env\.get\("M365_SENDER_(EMAIL|NAME)"\)/;
  const offenders = files.filter((f) => banned.test(f.text));
  assertEquals(offenders.map((f) => f.path), []);
});


Deno.test("4D.14A.7H — sendAuthEmail transport literal is tenant_smtp only", async () => {
  const p = `${REPO_ROOT}supabase/functions/_shared/authOutboundEmail.ts`;
  const text = await Deno.readTextFile(p);
  assert(text.includes('transport: "tenant_smtp"'));
  assert(!text.includes("global_graph"));
  assert(!text.includes("sendGraphMail"));
});
