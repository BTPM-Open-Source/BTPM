// Phase 4D.14A.7G — Static retirement tests for the OneNote readiness
// diagnostic. The diagnostic is retired (not migrated); OneNote
// evidence-reference support and export-to-supported-file guidance
// remain intact.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("4D.14A.7G: m365-onenote-readiness-check source has been removed", async () => {
  const url = new URL("../m365-onenote-readiness-check/index.ts", import.meta.url);
  let exists = true;
  try {
    await Deno.stat(url);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) exists = false;
    else throw e;
  }
  assert(!exists, "m365-onenote-readiness-check/index.ts must no longer exist");
});

Deno.test("4D.14A.7G: no active edge function invokes m365-onenote-readiness-check", async () => {
  const root = new URL("../../functions/", import.meta.url);
  for await (const entry of Deno.readDir(root)) {
    if (!entry.isDirectory) continue;
    for await (const f of Deno.readDir(new URL(`${entry.name}/`, root))) {
      if (!f.isFile || !f.name.endsWith(".ts")) continue;
      // Skip retirement/static test files that legitimately name the retired function.
      if (f.name.includes("onenote-readiness-retirement")) continue;
      const url = new URL(`${entry.name}/${f.name}`, root);
      const src = await Deno.readTextFile(url);
      assert(
        !src.includes("m365-onenote-readiness-check"),
        `${entry.name}/${f.name} still references m365-onenote-readiness-check`,
      );
    }
  }
});
