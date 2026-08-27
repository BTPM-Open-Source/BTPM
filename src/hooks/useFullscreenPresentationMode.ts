/**
 * Phase 6B.8f — Fullscreen presentation mode helper.
 *
 * Wraps the browser Fullscreen API with a graceful in-page fallback so
 * the Published Story viewer can enter a distraction-free presentation
 * canvas even when the browser denies fullscreen (embedded contexts,
 * user gesture missing, iframe permissions, etc.).
 *
 * No persistence: presentation mode is transient and never written to
 * localStorage / sessionStorage.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type FullscreenMode = "off" | "browser" | "fallback";

export interface UseFullscreenPresentationMode {
  mode: FullscreenMode;
  isActive: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  fallbackNotice: string | null;
}

function getFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as Document & {
    webkitFullscreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  return (
    d.fullscreenElement ??
    d.webkitFullscreenElement ??
    d.msFullscreenElement ??
    null
  );
}

async function requestFs(el: HTMLElement): Promise<void> {
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
  };
  if (typeof el.requestFullscreen === "function") {
    await el.requestFullscreen();
    return;
  }
  if (typeof anyEl.webkitRequestFullscreen === "function") {
    await anyEl.webkitRequestFullscreen();
    return;
  }
  if (typeof anyEl.msRequestFullscreen === "function") {
    await anyEl.msRequestFullscreen();
    return;
  }
  throw new Error("Fullscreen API not supported");
}

async function exitFs(): Promise<void> {
  if (typeof document === "undefined") return;
  const d = document as Document & {
    webkitExitFullscreen?: () => Promise<void> | void;
    msExitFullscreen?: () => Promise<void> | void;
  };
  if (getFullscreenElement()) {
    if (typeof document.exitFullscreen === "function") {
      await document.exitFullscreen();
    } else if (typeof d.webkitExitFullscreen === "function") {
      await d.webkitExitFullscreen();
    } else if (typeof d.msExitFullscreen === "function") {
      await d.msExitFullscreen();
    }
  }
}

export function useFullscreenPresentationMode(): UseFullscreenPresentationMode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<FullscreenMode>("off");
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  const enter = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      await requestFs(el);
      setMode("browser");
      setFallbackNotice(null);
    } catch {
      // Browser refused or unsupported — fall back to full-viewport mode.
      setMode("fallback");
      setFallbackNotice(
        "Full browser screen is unavailable. Showing presentation view in this window.",
      );
    }
  }, []);

  const exit = useCallback(async () => {
    try {
      await exitFs();
    } catch {
      /* ignore */
    }
    setMode("off");
    setFallbackNotice(null);
  }, []);

  // Sync with browser-driven fullscreen exits (Esc, browser UI).
  useEffect(() => {
    const onChange = () => {
      if (!getFullscreenElement()) {
        setMode((m) => (m === "browser" ? "off" : m));
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        onChange as EventListener,
      );
    };
  }, []);

  // Ensure we exit fullscreen if the consumer unmounts.
  useEffect(() => {
    return () => {
      if (getFullscreenElement()) {
        void exitFs();
      }
    };
  }, []);

  return {
    mode,
    isActive: mode !== "off",
    containerRef,
    enter,
    exit,
    fallbackNotice,
  };
}
