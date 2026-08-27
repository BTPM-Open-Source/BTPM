/**
 * Step API-ADM.6B — Model extraction and legacy dialog removal.
 *
 * Repository-only proof: the four Connected App admin models are pure, the
 * production surfaces consume them, and the five legacy dialog files are gone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ADMIN = resolve(process.cwd(), "src/pages/admin");
const read = (f: string) => readFileSync(resolve(ADMIN, f), "utf8");

const MODELS = [
  "connectedAppWorkspaceAccessModel.ts",
  "connectedAppProjectAccessModel.ts",
  "connectedAppOrganizationPermissionsModel.ts",
  "connectedAppWorkspacePermissionsModel.ts",
] as const;

const DELETED = [
  "ConnectedAppWorkspaceScopeDialog.tsx",
  "ConnectedAppProjectScopeDialog.tsx",
  "ConnectedAppWorkspaceCapabilityDialog.tsx",
  "ConnectedAppOrganizationCapabilityDialog.tsx",
  "ConnectedAppActivityDialog.tsx",
] as const;

const CONSUMERS: ReadonlyArray<readonly [string, string]> = [
  ["ConnectedAppWorkspaceAccess.tsx", "./connectedAppWorkspaceAccessModel"],
  ["ConnectedAppProjectAccess.tsx", "./connectedAppProjectAccessModel"],
  ["ConnectedAppOrganizationPermissions.tsx", "./connectedAppOrganizationPermissionsModel"],
  ["ConnectedAppWorkspacePermissions.tsx", "./connectedAppWorkspacePermissionsModel"],
];

describe("API-ADM.6B — pure models", () => {
  it("all four model modules exist", () => {
    for (const m of MODELS) expect(existsSync(resolve(ADMIN, m))).toBe(true);
  });

  it("models carry no React, Supabase, context or query dependency", () => {
    for (const m of MODELS) {
      const src = read(m);
      for (const banned of [
        "react",
        "React",
        "supabase",
        "@tanstack/react-query",
        "useQuery",
        "useMutation",
        "ActiveContext",
        "useActive",
        "@/components/ui/",
        "console.",
      ]) {
        expect(src, `${m} must not reference ${banned}`).not.toContain(banned);
      }
      expect(src).not.toMatch(/\bimport\s+/);
      expect(src).not.toMatch(/<[A-Z][A-Za-z]*/);
    }
  });
});

describe("API-ADM.6B — production consumption", () => {
  it("each production surface imports its pure model", () => {
    for (const [file, spec] of CONSUMERS) {
      expect(read(file)).toContain(`from "${spec}"`);
    }
  });

  it("no admin source references a deleted dialog module", () => {
    const files = readdirSync(ADMIN).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    for (const f of files) {
      const src = read(f);
      for (const dialog of DELETED) {
        expect(src, `${f} still references ${dialog}`).not.toContain(dialog.replace(/\.tsx$/, ""));
      }
    }
  });
});

describe("API-ADM.6B — legacy removal", () => {
  it("all five legacy dialog files are deleted", () => {
    for (const d of DELETED) expect(existsSync(resolve(ADMIN, d))).toBe(false);
  });
});
