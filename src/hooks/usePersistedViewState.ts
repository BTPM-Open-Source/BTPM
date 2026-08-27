/**
 * usePersistedViewState — shared view-state persistence contract for BTPM (Phase 4E.1).
 *
 * Layered model:
 *   1. URL query params  (mode: "url")   — shareable, refresh-stable, navigation-critical
 *   2. localStorage      (mode: "local") — personal last-used convenience
 *   3. defaults          (mode: "none" or fallback when above absent)
 *
 * Precedence: URL → local → default.
 *
 * Storage key format: `btpm:view-state:v1:<viewId>:<scopeKey>`
 *
 * This hook intentionally does NOT implement saved views/presets — that is a
 * later phase. It also does not introduce backend persistence.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ───────────── Codecs ───────────── */

export interface Codec<T> {
  parse: (raw: string) => T | undefined;
  /** Return undefined to omit from URL/storage (use when value equals default). */
  stringify: (value: T) => string | undefined;
}

const stringEnumCodec = <T extends string>(allowed: readonly T[]): Codec<T> => ({
  parse: (raw) => (allowed.includes(raw as T) ? (raw as T) : undefined),
  stringify: (v) => (allowed.includes(v) ? v : undefined),
});

const booleanCodec: Codec<boolean> = {
  parse: (raw) => (raw === "1" ? true : raw === "0" ? false : undefined),
  stringify: (v) => (v ? "1" : "0"),
};

const numberCodec: Codec<number> = {
  parse: (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  },
  stringify: (v) => (Number.isFinite(v) ? String(v) : undefined),
};

const stringCodec: Codec<string> = {
  parse: (raw) => raw,
  stringify: (v) => (v.length > 0 ? v : undefined),
};

const stringArrayCodec = (separator: string = ","): Codec<string[]> => ({
  parse: (raw) => (raw.length === 0 ? [] : raw.split(separator).filter(Boolean)),
  stringify: (v) => (v.length === 0 ? undefined : [...v].sort().join(separator)),
});

/** Stable YYYY-MM (month anchor) — locale-independent. */
const monthCodec: Codec<Date> = {
  parse: (raw) => {
    const m = /^(\d{4})-(\d{2})$/.exec(raw);
    if (!m) return undefined;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return Number.isNaN(d.getTime()) ? undefined : d;
  },
  stringify: (v) => {
    if (!(v instanceof Date) || Number.isNaN(v.getTime())) return undefined;
    const yy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    return `${yy}-${mm}`;
  },
};

/** Stable YYYY-MM-DD (date anchor) — locale-independent. */
const dateCodec: Codec<Date> = {
  parse: (raw) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) return undefined;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? undefined : d;
  },
  stringify: (v) => {
    if (!(v instanceof Date) || Number.isNaN(v.getTime())) return undefined;
    const yy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  },
};

export const codecs = {
  stringEnum: stringEnumCodec,
  boolean: booleanCodec,
  number: numberCodec,
  string: stringCodec,
  stringArray: stringArrayCodec,
  month: monthCodec,
  date: dateCodec,
};

/* ───────────── Field config ───────────── */

export type PersistMode = "url" | "local" | "none";

export interface FieldConfig<T> {
  /** Persistence layer for this field. */
  mode: PersistMode;
  /** Default value, used when neither URL nor local provides a value. */
  default: T;
  /** Codec for serializing to/from string. Required for url/local modes. */
  codec?: Codec<T>;
  /** URL query param name. Required when mode is "url". */
  urlKey?: string;
  /** Equality check used to decide whether to omit value (when equal to default). */
  equals?: (a: T, b: T) => boolean;
  /**
   * For url-mode fields only: also mirror the value to localStorage so that
   * when the page is opened later WITHOUT explicit URL params, the user's
   * last-used value is restored. URL params still take priority on read.
   * Setting the field back to its default removes both the URL param and the
   * local mirror, restoring default behavior on next visit.
   */
  localFallback?: boolean;
}

export type ViewStateSchema = Record<string, FieldConfig<any>>;

export type StateOf<S extends ViewStateSchema> = {
  [K in keyof S]: S[K] extends FieldConfig<infer T> ? T : never;
};

/* ───────────── Storage helpers ───────────── */

const STORAGE_PREFIX = "btpm:view-state:v1";
const buildStorageKey = (viewId: string, scopeKey: string) =>
  `${STORAGE_PREFIX}:${viewId}:${scopeKey}`;

const safeReadLocal = (key: string): Record<string, string> | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const safeWriteLocal = (key: string, value: Record<string, string>) => {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(value).length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    /* ignore quota / disabled storage */
  }
};

/* ───────────── Hook ───────────── */

export interface UsePersistedViewStateOptions<S extends ViewStateSchema> {
  viewId: string;
  scopeKey: string;
  schema: S;
}

export interface UsePersistedViewStateReturn<S extends ViewStateSchema> {
  state: StateOf<S>;
  setField: <K extends keyof S>(field: K, value: StateOf<S>[K]) => void;
  setState: (next: Partial<StateOf<S>>) => void;
  resetState: () => void;
  hasOverrides: boolean;
}

const defaultEquals = <T,>(a: T, b: T) =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === (b as any)[i]));

const computeInitialState = <S extends ViewStateSchema>(
  schema: S,
  storageKey: string,
): StateOf<S> => {
  const out: any = {};
  const urlParams =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const localBag = safeReadLocal(storageKey);

  for (const field in schema) {
    const cfg = schema[field];
    let resolved: any = undefined;

    if (cfg.mode === "url" && cfg.urlKey && cfg.codec && urlParams) {
      const raw = urlParams.get(cfg.urlKey);
      if (raw !== null) {
        const parsed = cfg.codec.parse(raw);
        if (parsed !== undefined) resolved = parsed;
      }
    }

    const localEligible =
      cfg.mode === "local" || (cfg.mode === "url" && cfg.localFallback === true);
    if (resolved === undefined && localEligible && cfg.codec && localBag) {
      const raw = localBag[field];
      if (typeof raw === "string") {
        const parsed = cfg.codec.parse(raw);
        if (parsed !== undefined) resolved = parsed;
      }
    }

    out[field] = resolved !== undefined ? resolved : cfg.default;
  }
  return out as StateOf<S>;
};

export function usePersistedViewState<S extends ViewStateSchema>(
  options: UsePersistedViewStateOptions<S>,
): UsePersistedViewStateReturn<S> {
  const { viewId, scopeKey, schema } = options;
  const storageKey = useMemo(() => buildStorageKey(viewId, scopeKey), [viewId, scopeKey]);

  // Schema is expected to be stable per mount; capture once for effect deps.
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const [state, setStateInternal] = useState<StateOf<S>>(() =>
    computeInitialState(schema, storageKey),
  );

  // Persist to URL (replaceState) and localStorage whenever state changes.
  useEffect(() => {
    const sch = schemaRef.current;
    const localBag: Record<string, string> = {};

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      let urlChanged = false;

      for (const field in sch) {
        const cfg = sch[field];
        const value = (state as any)[field];
        const eq = cfg.equals ?? defaultEquals;
        const isDefault = eq(value, cfg.default);

        if (cfg.mode === "url" && cfg.urlKey && cfg.codec) {
          const encoded = isDefault ? undefined : cfg.codec.stringify(value);
          const current = url.searchParams.get(cfg.urlKey);
          if (encoded === undefined) {
            if (current !== null) {
              url.searchParams.delete(cfg.urlKey);
              urlChanged = true;
            }
          } else if (current !== encoded) {
            url.searchParams.set(cfg.urlKey, encoded);
            urlChanged = true;
          }
          // Mirror url-mode field locally when localFallback is enabled so
          // returning to the page without explicit URL params restores the
          // user's last selection. Default values are intentionally NOT
          // mirrored — clearing filters removes the local mirror.
          if (cfg.localFallback && !isDefault) {
            const enc = cfg.codec.stringify(value);
            if (enc !== undefined) localBag[field] = enc;
          }
        } else if (cfg.mode === "local" && cfg.codec) {
          if (!isDefault) {
            const encoded = cfg.codec.stringify(value);
            if (encoded !== undefined) localBag[field] = encoded;
          }
        }
      }

      if (urlChanged) {
        window.history.replaceState(null, "", url.toString());
      }
    }

    safeWriteLocal(storageKey, localBag);
  }, [state, storageKey]);

  const setField = useCallback(<K extends keyof S>(field: K, value: StateOf<S>[K]) => {
    setStateInternal((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setState = useCallback((next: Partial<StateOf<S>>) => {
    setStateInternal((prev) => ({ ...prev, ...next }));
  }, []);

  const resetState = useCallback(() => {
    const defaults: any = {};
    for (const field in schemaRef.current) {
      defaults[field] = schemaRef.current[field].default;
    }
    setStateInternal(defaults as StateOf<S>);
  }, []);

  const hasOverrides = useMemo(() => {
    for (const field in schemaRef.current) {
      const cfg = schemaRef.current[field];
      const eq = cfg.equals ?? defaultEquals;
      if (!eq((state as any)[field], cfg.default)) return true;
    }
    return false;
  }, [state]);

  return { state, setField, setState, resetState, hasOverrides };
}
