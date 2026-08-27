import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isMeaningfulRoute, moduleForPath, setLastModuleRoute } from "@/lib/moduleRoutes";

/**
 * UX-1.8 — Tracks the user's current pathname and persists it as the last
 * meaningful route for the matching global module. Frontend-only.
 */
export function useModuleRouteTracker() {
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname + location.search;
    if (!isMeaningfulRoute(location.pathname)) return;
    const mod = moduleForPath(location.pathname);
    if (!mod) return;
    setLastModuleRoute(mod, path);
  }, [location.pathname, location.search]);
}
