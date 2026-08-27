/**
 * UX-GAP.2A — Production activation containment.
 *
 * Proves that:
 *  H. Production source code no longer references the obsolete build-time
 *     consent UX flag mechanism (env name, helper, or module).
 *  I. `/consent/api-d` remains wrapped in `AuthGuardedRoute`.
 *
 * Historical governance/evidence documents under `docs/` and database
 * migrations are intentionally excluded — they describe the old
 * implementation as accepted history and must not be rewritten.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "VITE_API_D_CONSENT_UX_ENABLED",
  "isApiDConsentUxEnabled",
  "API_D_CONSENT_UX_FLAG_ENV",
  "apiDConsentFlag",
];

const SCAN_ROOTS = ["src", "supabase/functions", "supabase/edge-tests"];
const SKIP_DIRS = new Set(["node_modules", "dist", "docs", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|sql|json|md)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("UX-GAP.2A — obsolete consent UX flag is fully removed", () => {
  it("has no flag helper module or its dedicated test left in the repo", () => {
    expect(existsSync("src/lib/apiDConsentFlag.ts")).toBe(false);
    expect(existsSync("src/lib/__tests__/apiDConsentFlag.test.ts")).toBe(false);
  });

  it("contains no references to the flag env name, helper, or module in production or test source", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      if (!existsSync(root)) continue;
      for (const file of walk(root)) {
        // This containment test itself names the forbidden tokens.
        if (file.endsWith("uxGap2aConsentProductionActivation.test.ts")) continue;
        const text = readFileSync(file, "utf8");
        for (const token of FORBIDDEN) {
          if (text.includes(token)) offenders.push(`${file} :: ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  }, 15_000);

  it("does not reference the flag env variable in .env", () => {
    if (!existsSync(".env")) return;
    expect(readFileSync(".env", "utf8")).not.toContain(
      "VITE_API_D_CONSENT_UX_ENABLED",
    );
  });
});

describe("UX-GAP.2A — route authority", () => {
  const app = readFileSync("src/App.tsx", "utf8");

  it("keeps /consent/api-d behind AuthGuardedRoute", () => {
    const line = app
      .split("\n")
      .find((l) => l.includes('path="/consent/api-d"'));
    expect(line).toBeTruthy();
    expect(line as string).toContain("<AuthGuardedRoute>");
    expect(line as string).toContain("<ConsentApiD />");
    expect(line as string).toContain("</AuthGuardedRoute>");
  });

  it("no longer describes the consent route as feature-flagged", () => {
    const idx = app.indexOf('path="/consent/api-d"');
    const preamble = app.slice(Math.max(0, idx - 500), idx);
    expect(preamble.toLowerCase()).not.toContain("feature-flag");
    expect(preamble.toLowerCase()).not.toContain("when the flag is off");
  });
});
