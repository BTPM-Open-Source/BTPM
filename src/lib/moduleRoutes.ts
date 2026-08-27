/**
 * UX-1.8 — Module route persistence (frontend-only).
 *
 * Stores the last meaningful route per global module so sidebar items can
 * return the user to where they last were within a module.
 */

const STORAGE_KEY = "btpm:last-module-routes:v1";

export type ModuleKey =
  | "projects"
  | "my-work"
  | "team-work"
  | "roadmap"
  | "risks-blockers"
  | "files"
  | "knowledge"
  | "admin";

type Store = Partial<Record<ModuleKey, string>>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(s: Store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota / private mode
  }
}

export function setLastModuleRoute(module: ModuleKey, path: string) {
  if (!path || !path.startsWith("/")) return;
  const s = read();
  s[module] = path;
  write(s);
}

export function getLastModuleRoute(module: ModuleKey): string | null {
  return read()[module] ?? null;
}

/** Map a pathname to the module it belongs to, or null if not tracked. */
export function moduleForPath(pathname: string): ModuleKey | null {
  if (pathname.startsWith("/projects")) return "projects";
  // Work Hub — both legacy `/my-work` and canonical `/work/my-work` map to the
  // same logical module so navigation/active-state/back-links stay consistent.
  if (pathname.startsWith("/work/team-work")) return "team-work";
  if (pathname.startsWith("/my-work") || pathname.startsWith("/work/my-work") || pathname === "/work") return "my-work";
  if (pathname.startsWith("/roadmap")) return "roadmap";
  if (pathname.startsWith("/risks-blockers")) return "risks-blockers";
  if (pathname.startsWith("/files")) return "files";
  if (pathname.startsWith("/knowledge")) return "knowledge";
  if (pathname.startsWith("/admin")) return "admin";
  // Project-detail routes belong to Projects module. Workspace tab/management
  // routes (e.g. /workspace/:id, /workspace/:id/programs) are NOT tracked as
  // Projects — they are legacy redirects to the canonical /projects shell.
  if (/^\/workspace\/[^/]+\/project\/[^/]+/.test(pathname)) return "projects";
  return null;
}

/**
 * Determine if a given pathname is a meaningful route to remember.
 * Excludes auth, error, and transient utility routes.
 */
export function isMeaningfulRoute(pathname: string): boolean {
  if (!pathname.startsWith("/")) return false;
  const blocked = [
    "/auth",
    "/accept-invite",
    "/reset-password",
    "/account-deactivated",
    "/storage-verify",
    "/test-email",
    "/knowledge/seed",
    
  ];
  if (blocked.some((b) => pathname === b || pathname.startsWith(b + "/"))) return false;
  return true;
}

export const FROM_TO_PATH: Record<string, { path: string; label: string }> = {
  projects: { path: "/projects", label: "Back to Projects" },
  "my-work": { path: "/work/my-work", label: "Back to My Work" },
  "team-work": { path: "/work/team-work", label: "Back to Team Work" },
  roadmap: { path: "/roadmap", label: "Back to Roadmap" },
  "risks-blockers": { path: "/risks-blockers", label: "Back to Risks & Blockers" },
  files: { path: "/files", label: "Back to Files" },
};
