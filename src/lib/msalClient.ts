/**
 * SP UX correction — MSAL (browser) singleton for the Microsoft File Picker.
 *
 * Delegated user auth for the official SharePoint File Picker (v8). Auth
 * strategy is silent-first:
 *   1) acquireTokenSilent against an existing MSAL account
 *   2) ssoSilent (reuses the user's existing Microsoft work session via
 *      third-party cookies / login_hint) — no UI
 *   3) acquireTokenPopup interactive fallback
 *
 * The redirect URI MUST be a Single-page application (SPA) redirect URI
 * registered on the Azure AD app — we always pass it explicitly so MSAL does
 * not omit it from the request (which causes AADSTS900971 "No reply address
 * provided").
 *
 * This module also publishes a per-attempt diagnostics trace via
 * `getLastPickerAuthTrace()` for the admin-only diagnostics panel. The trace
 * never contains tokens or other secrets — only stage names, methods, codes
 * and short error messages.
 */

import {
  PublicClientApplication,
  type Configuration,
  type AccountInfo,
  type AuthenticationResult,
  InteractionRequiredAuthError,
  BrowserAuthError,
  ServerError,
} from "@azure/msal-browser";

let instance: PublicClientApplication | null = null;
let initialized = false;
let configKey = "";

export interface MsalBootstrap {
  clientId: string;
  tenantId: string;
}

/* -------------------------------------------------------------------------- */
/*  Diagnostics trace (admin-only, no secrets)                                */
/* -------------------------------------------------------------------------- */

export type PickerAuthStageName =
  | "config"
  | "account_detection"
  | "silent_token"
  | "sso_silent"
  | "interactive_popup"
  | "picker_launch";

export interface PickerAuthStage {
  name: PickerAuthStageName;
  ok: boolean | null;
  method?: string;
  category?: string;
  message?: string;
  details?: Record<string, unknown>;
  ts: number;
}

export interface PickerAuthTrace {
  startedAt: number;
  endedAt?: number;
  redirectUri: string;
  stages: PickerAuthStage[];
  finalCategory?: string;
  finalMessage?: string;
}

let currentTrace: PickerAuthTrace | null = null;
let lastTrace: PickerAuthTrace | null = null;
const traceListeners = new Set<(t: PickerAuthTrace) => void>();

function emitTrace() {
  if (!currentTrace) return;
  const snap: PickerAuthTrace = {
    ...currentTrace,
    stages: currentTrace.stages.map((s) => ({ ...s })),
  };
  lastTrace = snap;
  for (const fn of traceListeners) {
    try { fn(snap); } catch { /* ignore */ }
  }
}

export function startPickerAuthTrace(): PickerAuthTrace {
  currentTrace = {
    startedAt: Date.now(),
    redirectUri: typeof window !== "undefined" ? getMsRedirectUri() : "",
    stages: [],
  };
  emitTrace();
  return currentTrace;
}

export function recordPickerStage(stage: Omit<PickerAuthStage, "ts">) {
  if (!currentTrace) startPickerAuthTrace();
  currentTrace!.stages.push({ ...stage, ts: Date.now() });
  emitTrace();
}

export function endPickerAuthTrace(finalCategory?: string, finalMessage?: string) {
  if (!currentTrace) return;
  currentTrace.endedAt = Date.now();
  if (finalCategory) currentTrace.finalCategory = finalCategory;
  if (finalMessage) currentTrace.finalMessage = finalMessage;
  emitTrace();
}

export function getLastPickerAuthTrace(): PickerAuthTrace | null {
  return lastTrace;
}

export function subscribePickerAuthTrace(fn: (t: PickerAuthTrace) => void): () => void {
  traceListeners.add(fn);
  return () => { traceListeners.delete(fn); };
}

/* -------------------------------------------------------------------------- */

/**
 * Stable, registerable SPA redirect URI for the picker auth flow.
 *
 * Microsoft recommends a blank static page as the redirect target for
 * silent/popup flows so MSAL's hash-handler can read the response without
 * the SPA router stripping it or running app code. We therefore point at
 * `/msal-blank.html` (a static file in /public) instead of the React route
 * `/auth/ms-callback`.
 *
 * The Azure AD app must register this exact URI as a Single-page application
 * (SPA) redirect URI for every origin the app runs under.
 */
export function getMsRedirectUri(): string {
  return `${window.location.origin}/msal-blank.html`;
}

/** Lazily build (and cache) the MSAL PublicClientApplication. */
async function getMsal({ clientId, tenantId }: MsalBootstrap): Promise<PublicClientApplication> {
  const key = `${tenantId}:${clientId}`;
  if (instance && configKey === key) {
    if (!initialized) {
      await instance.initialize();
      initialized = true;
    }
    return instance;
  }
  const redirectUri = getMsRedirectUri();
  const cfg: Configuration = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri,
      postLogoutRedirectUri: window.location.origin,
    },
    cache: {
      cacheLocation: "sessionStorage",
    },
  };
  instance = new PublicClientApplication(cfg);
  await instance.initialize();
  initialized = true;
  configKey = key;
  return instance;
}

export class PickerAuthError extends Error {
  code:
    | "redirect_uri_mismatch"
    | "popup_blocked"
    | "popup_not_user_gesture"
    | "no_session"
    | "interaction_required"
    | "tenant_mismatch"
    | "consent_required"
    | "user_cancelled"
    | "multi_account_ambiguous"
    | "picker_failed_after_auth"
    | "config_missing"
    | "silent_timeout"
    | "unknown";
  cause?: unknown;
  constructor(code: PickerAuthError["code"], message: string, cause?: unknown) {
    super(message);
    this.name = "PickerAuthError";
    this.code = code;
    this.cause = cause;
  }
}

function mapMsalError(e: unknown): PickerAuthError {
  const msg = (e as any)?.errorMessage || (e as any)?.message || String(e);
  const code = (e as any)?.errorCode || "";
  if (/AADSTS900971|reply address|redirect_uri/i.test(msg)) {
    return new PickerAuthError(
      "redirect_uri_mismatch",
      "The Microsoft sign-in redirect URI is not registered. An admin must add the SPA redirect URI to the Azure AD app.",
      e,
    );
  }
  if (e instanceof BrowserAuthError) {
    if (code === "popup_window_error" || /popup.*window|window.*could not.*open/i.test(msg)) {
      return new PickerAuthError("popup_blocked", "Sign-in popup was blocked. Please allow pop-ups for this site and try again.", e);
    }
    if (code === "user_cancelled") {
      return new PickerAuthError("user_cancelled", "Sign-in was cancelled.", e);
    }
  }
  if (e instanceof InteractionRequiredAuthError) {
    if (/AADSTS65001|consent/i.test(msg)) {
      return new PickerAuthError("consent_required", "Admin consent is required for this app to access SharePoint on your behalf.", e);
    }
    return new PickerAuthError("interaction_required", "Microsoft requires interactive sign-in.", e);
  }
  if (e instanceof ServerError) {
    if (/AADSTS50020|AADSTS90072|tenant/i.test(msg)) {
      return new PickerAuthError("tenant_mismatch", "Your account is not part of this organization's tenant.", e);
    }
  }
  if (/login_required|interaction_required|no_account|no_tokens/i.test(code) || /no_account/i.test(msg)) {
    return new PickerAuthError("no_session", "No active Microsoft session found. Sign-in is required.", e);
  }
  return new PickerAuthError("unknown", msg || "Unexpected Microsoft sign-in error.", e);
}

function pickAccount(accounts: AccountInfo[], loginHint?: string): {
  account: AccountInfo | null;
  strategy: "explicit_match" | "single_account" | "first_of_many" | "none";
  ambiguous: boolean;
} {
  if (!accounts.length) return { account: null, strategy: "none", ambiguous: false };
  if (loginHint) {
    const m = accounts.find(
      (a) => (a.username || "").toLowerCase() === loginHint.toLowerCase(),
    );
    if (m) return { account: m, strategy: "explicit_match", ambiguous: accounts.length > 1 };
  }
  if (accounts.length === 1) {
    return { account: accounts[0], strategy: "single_account", ambiguous: false };
  }
  return { account: accounts[0], strategy: "first_of_many", ambiguous: true };
}

/** Wrap a promise with a hard timeout. Resolves with sentinel on timeout. */
const TIMEOUT_SENTINEL = Symbol("silent_timeout");
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT_SENTINEL> {
  let to: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    to = setTimeout(() => resolve(TIMEOUT_SENTINEL), ms);
  });
  try {
    return await Promise.race([p, timer]);
  } finally {
    if (to) clearTimeout(to);
  }
}

/**
 * Acquire a token for the SharePoint resource (silent → ssoSilent → popup).
 *
 * @param opts.interactiveAllowed When false, skip popup fallback (so the
 *        caller can defer interactive launch to a real user-gesture handler).
 *        Throws PickerAuthError("interaction_required") on silent failure or
 *        PickerAuthError("silent_timeout") if silent did not resolve in time.
 * @param opts.silentTimeoutMs Hard cap (ms) on each silent attempt. Default 6000.
 */
export async function acquireSharepointToken(
  bootstrap: MsalBootstrap,
  spHost: string,
  opts?: { loginHint?: string; interactiveAllowed?: boolean; silentTimeoutMs?: number },
): Promise<{ accessToken: string; account: AccountInfo }> {
  const interactiveAllowed = opts?.interactiveAllowed !== false;
  const silentTimeoutMs = opts?.silentTimeoutMs ?? 6000;

  // Config stage
  if (!bootstrap.clientId || !bootstrap.tenantId) {
    recordPickerStage({
      name: "config",
      ok: false,
      category: "config_missing",
      message: "Missing VITE_MS_CLIENT_ID or VITE_MS_TENANT_ID at runtime.",
      details: {
        has_client_id: !!bootstrap.clientId,
        has_tenant_id: !!bootstrap.tenantId,
        redirect_uri: typeof window !== "undefined" ? getMsRedirectUri() : "",
        redirect_uri_explicit: true,
      },
    });
    throw new PickerAuthError("config_missing", "Microsoft sign-in is not configured (missing client/tenant id).");
  }
  recordPickerStage({
    name: "config",
    ok: true,
    details: {
      has_client_id: true,
      has_tenant_id: true,
      redirect_uri: getMsRedirectUri(),
      redirect_uri_explicit: true,
      login_hint_provided: !!opts?.loginHint,
    },
  });

  const msal = await getMsal(bootstrap);
  const scopes = [`https://${spHost}/AllSites.Write`];
  const redirectUri = getMsRedirectUri();

  // Account detection stage
  const accounts = msal.getAllAccounts();
  const picked = pickAccount(accounts, opts?.loginHint);
  if (picked.account) msal.setActiveAccount(picked.account);
  recordPickerStage({
    name: "account_detection",
    ok: true,
    method: picked.strategy,
    details: {
      cached_count: accounts.length,
      strategy: picked.strategy,
      multi_account_ambiguous: picked.ambiguous,
      hint_match: picked.strategy === "explicit_match",
    },
  });

  // 1) Silent against a known MSAL account (bounded by silentTimeoutMs)
  if (picked.account) {
    const start = Date.now();
    try {
      const res = await withTimeout(
        msal.acquireTokenSilent({ scopes, account: picked.account, redirectUri }),
        silentTimeoutMs,
      );
      if (res === TIMEOUT_SENTINEL) {
        recordPickerStage({
          name: "silent_token",
          ok: false,
          method: "acquireTokenSilent",
          category: "silent_timeout",
          message: `acquireTokenSilent did not resolve within ${silentTimeoutMs}ms.`,
          details: { duration_ms: Date.now() - start, timeout_ms: silentTimeoutMs },
        });
      } else {
        recordPickerStage({
          name: "silent_token",
          ok: true,
          method: "acquireTokenSilent",
          details: { duration_ms: Date.now() - start },
        });
        return { accessToken: res.accessToken, account: res.account! };
      }
    } catch (e) {
      const mapped = mapMsalError(e);
      recordPickerStage({
        name: "silent_token",
        ok: false,
        method: "acquireTokenSilent",
        category: mapped.code,
        message: mapped.message,
        details: { duration_ms: Date.now() - start },
      });
    }
  } else {
    recordPickerStage({
      name: "silent_token",
      ok: false,
      method: "acquireTokenSilent",
      category: "no_account",
      message: "No cached MSAL account to attempt silent acquisition.",
    });
  }

  // 2) ssoSilent — reuses the existing Microsoft work session if cookies allow.
  const ssoStart = Date.now();
  let ssoTimedOut = false;
  try {
    const res = await withTimeout(
      msal.ssoSilent({
        scopes,
        redirectUri,
        loginHint: opts?.loginHint,
        authority: `https://login.microsoftonline.com/${bootstrap.tenantId}`,
      }),
      silentTimeoutMs,
    );
    if (res === TIMEOUT_SENTINEL) {
      ssoTimedOut = true;
      recordPickerStage({
        name: "sso_silent",
        ok: false,
        method: "ssoSilent",
        category: "silent_timeout",
        message: `ssoSilent did not resolve within ${silentTimeoutMs}ms.`,
        details: { duration_ms: Date.now() - ssoStart, timeout_ms: silentTimeoutMs },
      });
    } else {
      const r = res as AuthenticationResult;
      if (r.account) msal.setActiveAccount(r.account);
      recordPickerStage({
        name: "sso_silent",
        ok: true,
        method: "ssoSilent",
        details: { duration_ms: Date.now() - ssoStart },
      });
      return { accessToken: r.accessToken, account: r.account! };
    }
  } catch (e) {
    const mapped = mapMsalError(e);
    recordPickerStage({
      name: "sso_silent",
      ok: false,
      method: "ssoSilent",
      category: mapped.code,
      message: mapped.message,
      details: { duration_ms: Date.now() - ssoStart },
    });
  }
  if (!interactiveAllowed) {
    throw new PickerAuthError(
      ssoTimedOut ? "silent_timeout" : "interaction_required",
      ssoTimedOut
        ? "Silent Microsoft sign-in timed out — interactive sign-in required."
        : "Silent Microsoft sign-in was not possible — interactive sign-in required.",
    );
  }

  // 3) Interactive popup fallback. NOTE: caller must invoke this directly from
  // a user gesture (click handler) — otherwise browsers block the popup.
  try {
    const r = await msal.acquireTokenPopup({
      scopes,
      redirectUri,
      loginHint: opts?.loginHint,
      prompt: "select_account",
    });
    msal.setActiveAccount(r.account!);
    recordPickerStage({ name: "interactive_popup", ok: true, method: "acquireTokenPopup" });
    return { accessToken: r.accessToken, account: r.account! };
  } catch (e2) {
    const mapped = mapMsalError(e2);
    recordPickerStage({
      name: "interactive_popup",
      ok: false,
      method: "acquireTokenPopup",
      category: mapped.code,
      message: mapped.message,
    });
    throw mapped;
  }
}

/** Sign out the active MSAL account (best-effort). */
export async function msalSignOut(bootstrap: MsalBootstrap): Promise<void> {
  const msal = await getMsal(bootstrap);
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (account) {
    await msal.logoutPopup({ account }).catch(() => { /* ignore */ });
  }
}
