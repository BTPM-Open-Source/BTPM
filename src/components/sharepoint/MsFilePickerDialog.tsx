/**
 * SP UX correction — Microsoft native SharePoint File Picker (v8) integration.
 *
 * Auth strategy:
 *   - On dialog open: try silent-only delegated auth (no popup).
 *   - If silent fails with interaction_required / no_session: show an
 *     in-dialog "Sign in with Microsoft" button. Its click handler invokes
 *     the popup directly so the browser sees a real user gesture.
 *   - Picker iframe is only mounted once a valid delegated token is held.
 *
 * Picker auth (delegated user) is intentionally separate from the backend
 * SharePoint validator (app-only). Do not merge them.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ExternalLink, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getMsPickerConfig,
  linkProjectFolder,
  type MsPickerConfig,
} from "@/lib/sharepointFolderPickerService";
import {
  acquireSharepointToken,
  endPickerAuthTrace,
  getMsRedirectUri,
  PickerAuthError,
  recordPickerStage,
  startPickerAuthTrace,
} from "@/lib/msalClient";
import { PickerAuthDiagnosticsPanel } from "@/components/sharepoint/PickerAuthDiagnosticsPanel";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceBindingId: string;
}

interface PickedItem {
  id?: string;
  name?: string;
  webUrl?: string;
  folder?: unknown;
  parentReference?: { driveId?: string; siteId?: string };
}

const PICKER_OPTIONS = {
  sdk: "8.0",
  entry: {} as Record<string, unknown>,
  authentication: {},
  messaging: {
    origin: typeof window !== "undefined" ? window.location.origin : "",
    channelId: "btpm-folder-picker",
  },
  typesAndSources: {
    mode: "files",
    pivots: { oneDrive: false, recent: false },
  },
  selection: { mode: "single" },
  search: { enabled: true },
  commands: { commit: { label: "Use this folder" } },
};

type AuthState =
  | { phase: "idle" }
  | { phase: "silent" }
  | { phase: "needs_interactive"; reason: string }
  | { phase: "interactive" }
  | { phase: "ready"; accessToken: string }
  | { phase: "error"; code: PickerAuthError["code"] | "unknown"; message: string };

function friendlyMessageFor(code: PickerAuthError["code"] | "unknown"): string {
  switch (code) {
    case "redirect_uri_mismatch":
      return `Microsoft sign-in is not fully configured for this site. An admin must register this exact SPA redirect URI in Azure AD: ${getMsRedirectUri()}`;
    case "popup_blocked":
      return "Your browser blocked the Microsoft sign-in window. Please allow pop-ups for this site and try again.";
    case "popup_not_user_gesture":
      return "The sign-in window could not open automatically. Click \"Sign in with Microsoft\" to continue.";
    case "consent_required":
      return "Your IT admin must grant consent for BTPM to read SharePoint on your behalf.";
    case "tenant_mismatch":
      return "Your Microsoft account is not part of this organization's tenant.";
    case "user_cancelled":
      return "Sign-in was cancelled.";
    case "multi_account_ambiguous":
      return "Multiple Microsoft accounts are signed in — please choose the work account.";
    case "silent_timeout":
      return "Silent Microsoft sign-in did not respond in time. Please sign in.";
    case "interaction_required":
    case "no_session":
      return "Your Microsoft work session could not be reused. Please sign in.";
    case "config_missing":
      return "Microsoft sign-in is not configured for this app. Please contact your administrator.";
    case "picker_failed_after_auth":
      return "Sign-in succeeded but the SharePoint picker did not load. Try again or contact your administrator.";
    default:
      return "Microsoft sign-in failed.";
  }
}

export function MsFilePickerDialog({
  open,
  onOpenChange,
  projectId,
  workspaceBindingId,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const portRef = useRef<MessagePort | null>(null);
  // Reusable delegated token for the lifetime of this open dialog. The picker
  // sends an `authenticate` command after boot — we serve it from this ref
  // first instead of re-running silent auth on every request.
  const tokenRef = useRef<string | null>(null);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>({ phase: "idle" });
  const [loginHint, setLoginHint] = useState<string | undefined>(undefined);

  const cfgQuery = useQuery<MsPickerConfig>({
    queryKey: ["sp-picker-config", workspaceBindingId],
    queryFn: () => getMsPickerConfig(workspaceBindingId),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });

  const linkMut = useMutation({
    mutationFn: (selection: { itemId?: string; webUrl?: string }) =>
      linkProjectFolder(workspaceBindingId, projectId, selection),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding", projectId] });
      qc.invalidateQueries({ queryKey: ["sharepoint-project-binding-effective", projectId] });
      toast({ title: "Folder connected", description: "Validating with SharePoint…" });
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast({
        title: "Could not connect folder",
        description: e?.note || e?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Reset on close
  useEffect(() => {
    if (!open) {
      setAuthState({ phase: "idle" });
      setIframeUrl(null);
      tokenRef.current = null;
    }
  }, [open]);

  // Pre-fetch login hint (Supabase user email) once
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setLoginHint(data?.user?.email ?? undefined);
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Phase 1 — Silent-only attempt as soon as we have config.
  useEffect(() => {
    if (!open || !cfgQuery.data) return;
    if (authState.phase !== "idle") return;
    let cancelled = false;
    (async () => {
      setAuthState({ phase: "silent" });
      startPickerAuthTrace();
      try {
        const cfg = cfgQuery.data!;
        const { accessToken } = await acquireSharepointToken(
          { clientId: cfg.client_id, tenantId: cfg.tenant_id },
          cfg.sharepoint_host,
          { loginHint, interactiveAllowed: false },
        );
        if (cancelled) return;
        tokenRef.current = accessToken;
        endPickerAuthTrace();
        setAuthState({ phase: "ready", accessToken });
      } catch (e) {
        if (cancelled) return;
        const code = (e as PickerAuthError)?.code ?? "unknown";
        if (
          code === "interaction_required" ||
          code === "no_session" ||
          code === "silent_timeout"
        ) {
          setAuthState({
            phase: "needs_interactive",
            reason: friendlyMessageFor(code),
          });
          // Trace stays open until interactive attempt finishes.
        } else {
          endPickerAuthTrace(code, friendlyMessageFor(code));
          setAuthState({ phase: "error", code, message: friendlyMessageFor(code) });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, cfgQuery.data, authState.phase, loginHint]);

  // Phase 2 — Interactive popup. MUST be called from a real click handler.
  const onInteractiveSignIn = async () => {
    if (!cfgQuery.data) return;
    setAuthState({ phase: "interactive" });
    try {
      const cfg = cfgQuery.data;
      const { accessToken } = await acquireSharepointToken(
        { clientId: cfg.client_id, tenantId: cfg.tenant_id },
        cfg.sharepoint_host,
        { loginHint, interactiveAllowed: true },
      );
      tokenRef.current = accessToken;
      endPickerAuthTrace();
      setAuthState({ phase: "ready", accessToken });
    } catch (e) {
      const code = (e as PickerAuthError)?.code ?? "unknown";
      const message = friendlyMessageFor(code);
      endPickerAuthTrace(code, message);
      setAuthState({ phase: "error", code, message });
    }
  };

  // Phase 3 — Boot picker iframe once we hold a token.
  useEffect(() => {
    if (authState.phase !== "ready" || !cfgQuery.data) return;
    const cfg = cfgQuery.data;
    try {
      const opts = {
        ...PICKER_OPTIONS,
        entry: { sharePoint: { byPath: { web: cfg.site_web_url, list: cfg.library_web_url } } },
      };
      const queryString = new URLSearchParams({ filePicker: JSON.stringify(opts) }).toString();
      const url = `${cfg.site_web_url.replace(/\/+$/, "")}/_layouts/15/FilePicker.aspx?${queryString}`;
      setIframeUrl(url);
      setTimeout(() => submitPickerForm(iframeRef.current, cfg, authState.accessToken, opts), 50);
      recordPickerStage({ name: "picker_launch", ok: true, method: "form_post" });
    } catch (e: any) {
      recordPickerStage({
        name: "picker_launch",
        ok: false,
        category: "picker_failed_after_auth",
        message: e?.message ?? "Picker iframe boot failed.",
      });
      endPickerAuthTrace("picker_failed_after_auth", friendlyMessageFor("picker_failed_after_auth"));
      setAuthState({
        phase: "error",
        code: "picker_failed_after_auth",
        message: friendlyMessageFor("picker_failed_after_auth"),
      });
    }
  }, [authState, cfgQuery.data]);

  // Listen for picker messages
  useEffect(() => {
    if (!open) return;
    const cfg = cfgQuery.data;
    if (!cfg) return;
    const pickerOrigin = (() => {
      try { return new URL(cfg.site_web_url).origin; } catch { return ""; }
    })();
    const onMessage = async (ev: MessageEvent) => {
      if (!pickerOrigin || ev.origin !== pickerOrigin) return;
      const msg: any = ev.data;
      if (msg?.type === "initialize" && Array.isArray(ev.ports) && ev.ports.length) {
        portRef.current = ev.ports[0];
        portRef.current.addEventListener("message", onChannelMessage);
        portRef.current.start();
        portRef.current.postMessage({ type: "activate" });
        recordPickerStage({
          name: "picker_launch",
          ok: true,
          method: "picker_initialize",
          details: { has_token_cached: !!tokenRef.current },
        });
      }
    };
    const onChannelMessage = async (ev: MessageEvent) => {
      const msg: any = ev.data;
      if (!msg) return;
      if (msg.type === "command") {
        const cmd = msg.data;
        ev.ports?.[0]?.postMessage({ type: "result", id: msg.id, data: { result: "success" } });
        if (cmd?.command === "authenticate") {
          // Reuse the delegated token already held by this dialog. Only
          // re-acquire silently if we somehow do not have one.
          try {
            let token = tokenRef.current;
            let source: "cached_dialog_token" | "fresh_silent" = "cached_dialog_token";
            if (!token) {
              source = "fresh_silent";
              const r = await acquireSharepointToken(
                { clientId: cfg.client_id, tenantId: cfg.tenant_id },
                cfg.sharepoint_host,
                { loginHint, interactiveAllowed: false, silentTimeoutMs: 4000 },
              );
              token = r.accessToken;
              tokenRef.current = token;
            }
            recordPickerStage({
              name: "picker_launch",
              ok: true,
              method: "authenticate_reply",
              details: { token_source: source },
            });
            ev.ports?.[0]?.postMessage({
              type: "result",
              id: msg.id,
              data: { result: "token", token },
            });
          } catch (e) {
            recordPickerStage({
              name: "picker_launch",
              ok: false,
              method: "authenticate_reply",
              category: "auth_failed",
              message: (e as any)?.message ?? "Picker authenticate handler failed.",
            });
            ev.ports?.[0]?.postMessage({
              type: "result",
              id: msg.id,
              data: { result: "error", error: { code: "auth_failed" } },
            });
          }
        } else if (cmd?.command === "pick") {
          const items: PickedItem[] = cmd?.items ?? [];
          const picked = items[0];
          if (!picked) return;
          if (!picked.folder) {
            toast({
              title: "Please choose a folder",
              description: "Files cannot be linked — pick a folder.",
              variant: "destructive",
            });
            return;
          }
          if (picked.webUrl) {
            linkMut.mutate({ webUrl: picked.webUrl });
          } else if (picked.id) {
            linkMut.mutate({ itemId: picked.id });
          }
        } else if (cmd?.command === "close") {
          onOpenChange(false);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      try { portRef.current?.close(); } catch { /* ignore */ }
      portRef.current = null;
    };
  }, [open, cfgQuery.data, linkMut, onOpenChange, toast, loginHint]);

  const cfgError = cfgQuery.error as any;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>Choose folder in SharePoint</DialogTitle>
          <DialogDescription>
            Browse the workspace library and pick the folder for this project.
            You may be asked to sign in to Microsoft once.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 relative bg-muted/20 overflow-auto">
          {cfgQuery.isLoading || authState.phase === "silent" ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-64 w-full" />
              <p className="text-xs text-muted-foreground">
                {cfgQuery.isLoading ? "Loading picker…" : "Trying to reuse your Microsoft work session…"}
              </p>
            </div>
          ) : cfgError ? (
            <div className="p-6">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Picker unavailable</AlertTitle>
                <AlertDescription className="text-xs">
                  {cfgError?.note || cfgError?.message || "Could not initialise picker."}
                </AlertDescription>
              </Alert>
            </div>
          ) : authState.phase === "needs_interactive" ? (
            <div className="p-6 space-y-4">
              <Alert>
                <LogIn className="h-4 w-4" />
                <AlertTitle>Sign in to Microsoft</AlertTitle>
                <AlertDescription className="text-xs">
                  {authState.reason}
                </AlertDescription>
              </Alert>
              <Button onClick={onInteractiveSignIn} size="sm">
                <LogIn className="h-4 w-4 mr-1" /> Sign in with Microsoft
              </Button>
              <PickerAuthDiagnosticsPanel />
            </div>
          ) : authState.phase === "interactive" ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <p className="text-xs text-muted-foreground">Waiting for Microsoft sign-in window…</p>
              <PickerAuthDiagnosticsPanel />
            </div>
          ) : authState.phase === "error" ? (
            <div className="p-6 space-y-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Microsoft sign-in failed</AlertTitle>
                <AlertDescription className="text-xs space-y-2">
                  <div>{authState.message}</div>
                  <div className="text-muted-foreground">
                    Error category: <code>{authState.code}</code>
                  </div>
                </AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Button onClick={onInteractiveSignIn} size="sm" variant="default">
                  <LogIn className="h-4 w-4 mr-1" /> Try sign-in again
                </Button>
                {cfgQuery.data && (
                  <Button asChild variant="outline" size="sm">
                    <a href={cfgQuery.data.library_web_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1" /> Open library in SharePoint
                    </a>
                  </Button>
                )}
              </div>
              <PickerAuthDiagnosticsPanel />
            </div>
          ) : authState.phase === "ready" ? (
            <iframe
              ref={iframeRef}
              title="Microsoft SharePoint folder picker"
              className="absolute inset-0 w-full h-full border-0"
              src={iframeUrl ?? "about:blank"}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Submit the picker options + delegated access token to FilePicker.aspx via a
 * hidden form POST. The picker requires this for v8 boot.
 */
function submitPickerForm(
  iframe: HTMLIFrameElement | null,
  cfg: MsPickerConfig,
  accessToken: string,
  options: typeof PICKER_OPTIONS,
) {
  if (!iframe) return;
  const action = `${cfg.site_web_url.replace(/\/+$/, "")}/_layouts/15/FilePicker.aspx`;
  const form = document.createElement("form");
  form.action = action;
  form.method = "POST";
  form.target = iframe.name || (iframe.name = `sp-picker-${Math.random().toString(36).slice(2)}`);
  form.style.display = "none";

  const optInput = document.createElement("input");
  optInput.name = "filePicker";
  optInput.value = JSON.stringify(options);
  form.appendChild(optInput);

  const tokenInput = document.createElement("input");
  tokenInput.name = "access_token";
  tokenInput.value = accessToken;
  form.appendChild(tokenInput);

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}
