/**
 * useSavedViews — Phase 4E.6 saved-view foundation.
 *
 * Saved views are private, local-only, per-surface, scoped presets that capture
 * a snapshot of durable view configuration. They are NOT a parallel state engine —
 * applying a saved view writes the captured fields back through the existing
 * 4E.1 persistence layer (`usePersistedViewState`).
 *
 * Storage:
 *   key   : `btpm:saved-views:v1:<viewId>:<scopeKey>`
 *   value : JSON array of `SavedView<T>` records
 *
 * This hook intentionally does NOT:
 *   - sync to server / share across devices
 *   - support workspace/org-shared views
 *   - support "set as default", pinning, or auto-save
 *   - introduce URL params (saved views remain a local concern)
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "btpm:saved-views:v1";

export interface SavedView<T> {
  id: string;
  name: string;
  state: T;
  createdAt: string;
  updatedAt: string;
}

export interface UseSavedViewsOptions<T> {
  viewId: string;
  scopeKey: string;
  /** Validate a candidate state object before storing/applying. Reject invalid records safely. */
  validate?: (raw: unknown) => raw is T;
}

export interface UseSavedViewsReturn<T> {
  views: SavedView<T>[];
  saveView: (name: string, state: T) => SavedView<T> | null;
  applyView: (id: string) => SavedView<T> | null;
  renameView: (id: string, name: string) => void;
  deleteView: (id: string) => void;
}

const buildKey = (viewId: string, scopeKey: string) =>
  `${STORAGE_PREFIX}:${viewId}:${scopeKey}`;

const safeRead = <T,>(key: string, validate?: (raw: unknown) => raw is T): SavedView<T>[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((rec): rec is SavedView<T> => {
      if (!rec || typeof rec !== "object") return false;
      if (typeof rec.id !== "string" || typeof rec.name !== "string") return false;
      if (typeof rec.createdAt !== "string" || typeof rec.updatedAt !== "string") return false;
      if (!("state" in rec)) return false;
      if (validate && !validate(rec.state)) return false;
      return true;
    });
  } catch {
    return [];
  }
};

const safeWrite = <T,>(key: string, views: SavedView<T>[]) => {
  if (typeof window === "undefined") return;
  try {
    if (views.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(views));
  } catch {
    /* ignore quota / disabled storage */
  }
};

const genId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function useSavedViews<T>(options: UseSavedViewsOptions<T>): UseSavedViewsReturn<T> {
  const { viewId, scopeKey, validate } = options;
  const storageKey = buildKey(viewId, scopeKey);

  const [views, setViews] = useState<SavedView<T>[]>(() => safeRead<T>(storageKey, validate));

  // Re-read whenever the scope changes (different project, etc.)
  useEffect(() => {
    setViews(safeRead<T>(storageKey, validate));
    // validate is intentionally not in deps; identity-stable per surface usage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const persist = useCallback(
    (next: SavedView<T>[]) => {
      setViews(next);
      safeWrite(storageKey, next);
    },
    [storageKey],
  );

  const saveView = useCallback(
    (name: string, state: T): SavedView<T> | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const now = new Date().toISOString();
      const record: SavedView<T> = {
        id: genId(),
        name: trimmed,
        state,
        createdAt: now,
        updatedAt: now,
      };
      persist([...views, record]);
      return record;
    },
    [views, persist],
  );

  const applyView = useCallback(
    (id: string): SavedView<T> | null => views.find((v) => v.id === id) ?? null,
    [views],
  );

  const renameView = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      persist(views.map((v) => (v.id === id ? { ...v, name: trimmed, updatedAt: now } : v)));
    },
    [views, persist],
  );

  const deleteView = useCallback(
    (id: string) => {
      persist(views.filter((v) => v.id !== id));
    },
    [views, persist],
  );

  return { views, saveView, applyView, renameView, deleteView };
}
