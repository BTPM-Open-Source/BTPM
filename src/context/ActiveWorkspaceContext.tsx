import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspaces } from "@/hooks/useProjectOverview";
import { useActiveContext } from "@/context/ActiveContextProvider";

/**
 * Active Workspace Context (UX-1.2B)
 *
 * Frontend-only persistent operating scope. Two scope types:
 *   - { type: "all" }                 → All workspaces
 *   - { type: "workspace", id }       → Specific workspace
 *
 * Sources of truth (priority): URL > persisted scope > sensible default.
 * Persistence: localStorage only. No backend changes.
 */

const STORAGE_KEY = "btpm:active-scope:v2";
const LEGACY_KEY = "btpm:active-workspace:v1";

type Workspace = { id: string; name: string };

export type ActiveScope =
  | { type: "all" }
  | { type: "workspace"; workspaceId: string };

interface ActiveWorkspaceContextValue {
  activeScope: ActiveScope;
  activeWorkspaceId: string | null; // null when scope is "all"
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
  isLoading: boolean;
  isAllWorkspaces: boolean;
  setActiveWorkspaceId: (id: string) => void;
  /** Sets active workspace without any URL-side-effect (used by route shims). */
  adoptActiveWorkspaceId: (id: string) => void;
  setScopeAll: () => void;
  clearActiveWorkspace: () => void;
}

const ActiveWorkspaceContext = createContext<ActiveWorkspaceContextValue | null>(
  null,
);

const readStored = (): ActiveScope | null => {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.type === "all") return { type: "all" };
      if (parsed?.type === "workspace" && typeof parsed.workspaceId === "string") {
        return { type: "workspace", workspaceId: parsed.workspaceId };
      }
    }
    // Legacy migration: previously stored only a workspace id string.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) return { type: "workspace", workspaceId: legacy };
    return null;
  } catch {
    return null;
  }
};

const writeStored = (scope: ActiveScope | null) => {
  try {
    if (typeof window === "undefined") return;
    if (scope) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scope));
    else window.localStorage.removeItem(STORAGE_KEY);
    // Best-effort cleanup of legacy key once we have v2.
    if (scope) window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
};

export function ActiveWorkspaceProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useWorkspaces();
  const { activeOrganization } = useActiveContext();
  const location = useLocation();
  const navigate = useNavigate();

  const activeOrgId = activeOrganization?.id ?? null;
  const workspaces = (data as Workspace[] | undefined) ?? [];
  const accessibleIds = useMemo(
    () => new Set(workspaces.map((w) => w.id)),
    [workspaces],
  );

  // URL-derived scope hint
  const urlScope = useMemo<ActiveScope | null>(() => {
    const m = location.pathname.match(/^\/workspace\/([^/]+)/);
    if (m) return { type: "workspace", workspaceId: m[1] };
    if (location.pathname === "/") return { type: "all" };
    return null;
  }, [location.pathname]);

  const [storedScope, setStoredScope] = useState<ActiveScope | null>(() =>
    readStored(),
  );

  const resolvedScope = useMemo<ActiveScope>(() => {
    // URL wins when valid
    if (urlScope) {
      if (urlScope.type === "all") return urlScope;
      if (accessibleIds.has(urlScope.workspaceId)) return urlScope;
    }
    // Persisted
    if (storedScope) {
      if (storedScope.type === "all") return storedScope;
      if (accessibleIds.has(storedScope.workspaceId)) return storedScope;
    }
    // Defaults: multi-workspace → all; single → that workspace; none → all
    if (!isLoading) {
      if (workspaces.length === 1) {
        return { type: "workspace", workspaceId: workspaces[0].id };
      }
    }
    return { type: "all" };
  }, [urlScope, storedScope, accessibleIds, isLoading, workspaces]);

  // Persist resolved scope when it changes
  useEffect(() => {
    const current = readStored();
    const same =
      current &&
      current.type === resolvedScope.type &&
      (current.type === "all" ||
        (resolvedScope.type === "workspace" &&
          current.type === "workspace" &&
          current.workspaceId === resolvedScope.workspaceId));
    if (!same) writeStored(resolvedScope);
  }, [resolvedScope]);

  // Phase 4D.7 — When the active Organization changes, drop any stored
  // workspace scope that no longer belongs to it and redirect away from a
  // stale /workspace/:id/... URL so the Workspace selector reflects only the
  // new Organization's workspaces.
  const prevOrgRef = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading) return;
    if (prevOrgRef.current === activeOrgId) return;
    const previous = prevOrgRef.current;
    prevOrgRef.current = activeOrgId;
    if (previous === null) return; // initial resolution — nothing to reset
    // Reset persisted scope to "all" for the new org
    const next: ActiveScope = { type: "all" };
    writeStored(next);
    setStoredScope(next);
    // If we're inside a workspace URL that's no longer accessible, bail out
    const m = location.pathname.match(/^\/workspace\/([^/]+)/);
    if (m && !accessibleIds.has(m[1])) {
      navigate("/");
    }
  }, [activeOrgId, isLoading, accessibleIds, location.pathname, navigate]);

  const setActiveWorkspaceId = useCallback(
    (id: string) => {
      const next: ActiveScope = { type: "workspace", workspaceId: id };
      writeStored(next);
      setStoredScope(next);
      // Re-route when user is currently inside a workspace-scoped URL.
      // If the URL contains a project-specific segment, drop it — the project
      // belongs to the previous workspace and won't exist in the new one.
      const m = location.pathname.match(/^\/workspace\/[^/]+(\/.*)?$/);
      if (m) {
        const tail = m[1] ?? "";
        // Strip /project/... and anything after it
        const safeTail = tail.replace(/\/project\/.*$/, "");
        navigate(`/workspace/${id}${safeTail}`);
      }
    },
    [location.pathname, navigate],
  );

  const adoptActiveWorkspaceId = useCallback((id: string) => {
    const next: ActiveScope = { type: "workspace", workspaceId: id };
    writeStored(next);
    setStoredScope(next);
  }, []);

  const setScopeAll = useCallback(() => {
    const next: ActiveScope = { type: "all" };
    writeStored(next);
    setStoredScope(next);
    const m = location.pathname.match(/^\/workspace\/[^/]+(\/.*)?$/);
    if (m) navigate("/");
  }, [location.pathname, navigate]);

  const clearActiveWorkspace = useCallback(() => {
    writeStored(null);
    setStoredScope(null);
  }, []);

  const activeWorkspaceId =
    resolvedScope.type === "workspace" ? resolvedScope.workspaceId : null;
  const activeWorkspace = useMemo(
    () =>
      activeWorkspaceId
        ? workspaces.find((w) => w.id === activeWorkspaceId) ?? null
        : null,
    [workspaces, activeWorkspaceId],
  );

  const value: ActiveWorkspaceContextValue = {
    activeScope: resolvedScope,
    activeWorkspaceId,
    activeWorkspace,
    workspaces,
    isLoading,
    isAllWorkspaces: resolvedScope.type === "all",
    setActiveWorkspaceId,
    adoptActiveWorkspaceId,
    setScopeAll,
    clearActiveWorkspace,
  };

  return (
    <ActiveWorkspaceContext.Provider value={value}>
      {children}
    </ActiveWorkspaceContext.Provider>
  );
}

export function useActiveWorkspace() {
  const ctx = useContext(ActiveWorkspaceContext);
  if (!ctx) {
    throw new Error(
      "useActiveWorkspace must be used inside ActiveWorkspaceProvider",
    );
  }
  return ctx;
}
