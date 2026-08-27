/**
 * API-H.3B — Supabase OAuth 2.1 authorization consent page.
 *
 * Reachable at /oauth/consent behind AuthGuardedRoute only (API-Q.5): any
 * authenticated, non-deactivated BTPM user may complete the delegated OAuth
 * flow.
 * Reads only `authorization_id` from the query string, fetches the
 * authorization details via `supabase.auth.oauth`, and renders a compact
 * consent card. Approve/Deny proceed only via the Supabase-returned
 * `redirect_url` after strict URL validation.
 *
 * Authority is NOT evaluated here: AuthGuardedRoute (authentication and
 * deactivation) decides whether this page mounts at all. BTPM Connected App
 * authorization is server-enforced and fail-closed via canonical
 * `authorizeClient` — successful OAuth consent grants no BTPM API access and
 * never acknowledges a Connected App policy version.
 *
 * This screen is distinct from and independent of the API-D business consent
 * page. It grants no API capability, RLS access, or business acknowledgement.
 *
 * UX-GAP.2B2 — for a normal OAuthAuthorizationDetails response the current
 * user must already hold the current BTPM business-policy acknowledgement for
 * the exact OAuth client (`data.client.id` → accepted resolver
 * `public.get_api_d_oauth_consent_gate`) before OAuth Approve becomes
 * available. BTPM business consent and OAuth authorization remain two distinct
 * decisions: acknowledging the policy never approves OAuth, and approving
 * OAuth never acknowledges the policy.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { buildApiDConsentReturnPath } from "@/lib/apiDConsent";
import {
  getApiDOAuthConsentGate,
  sanitizeOAuthClientId,
} from "@/lib/apiDOAuthConsentGate";
import { reconcileBtpmOAuthGrantsBeforeAuthorization } from "@/lib/apiDOAuthGrantReconciliation";


type ConsentState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "processing" }
  | { kind: "policy_required"; consentPath: string }
  | {
      kind: "ready";
      clientName: string;
      redirectUri: string;
      scopes: string[];
    };

const MAX_AUTHORIZATION_ID_LENGTH = 512;
const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F]/;
const MAX_DISPLAY_TEXT_LENGTH = 256;

/** Bounded internal flow marker — carries no secret, state, or decision. */
const POLICY_RETURN_PARAM = "btpm_policy_return";
const POLICY_RETURN_VALUE = "1";

export function sanitizeAuthorizationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_AUTHORIZATION_ID_LENGTH) return null;
  if (CONTROL_CHAR_REGEX.test(trimmed)) return null;
  return trimmed;
}


/** Strips control characters and clamps length for any provider-sourced text. */
export function sanitizeDisplayText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  return cleaned.slice(0, MAX_DISPLAY_TEXT_LENGTH);
}

export function isSafeSupabaseRedirectUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (parsed.hash !== "") return false;
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:") {
    const host = parsed.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  }
  return false;
}

/** Documented Supabase shape: singular, space-separated `scope`. */
export function parseScopeString(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/\s+/)) {
    const scope = sanitizeDisplayText(token);
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    out.push(scope);
  }
  return out;
}

const SCOPE_LABELS: Record<string, string> = {
  openid: "Verify your BTPM sign-in identity",
  profile: "Read your basic BTPM profile",
  email: "Read your BTPM account email address",
  offline_access: "Stay connected without re-authorizing each time",
};

export function describeScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}

function UnavailableCard() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg" data-testid="oauth-consent-unavailable">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">
            Authorization request unavailable
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This authorization request cannot be completed right now.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function LoadingCard() {
  return (
    <div
      className="min-h-screen flex items-center justify-center text-sm text-muted-foreground"
      data-testid="oauth-consent-loading"
    >
      Loading…
    </div>
  );
}

export default function OAuthConsent() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const authorizationId = sanitizeAuthorizationId(searchParams.get("authorization_id"));
  const policyReturn = searchParams.get(POLICY_RETURN_PARAM) === POLICY_RETURN_VALUE;

  const { user } = useAuth();
  const { activeTenant } = useActiveContext();

  const accountEmail = sanitizeDisplayText(user?.email) || "Current signed-in account";
  const tenantName = sanitizeDisplayText(activeTenant?.name) || "Active tenant";

  const [state, setState] = useState<ConsentState>(
    authorizationId ? { kind: "loading" } : { kind: "unavailable" },
  );
  const fetchedRef = useRef(false);
  const submittingRef = useRef(false);

  /** Internal BTPM return target for the business-consent round-trip. */
  const policyReturnPath = useMemo(() => {
    if (!authorizationId) return null;
    const params = new URLSearchParams();
    params.set("authorization_id", authorizationId);
    params.set(POLICY_RETURN_PARAM, POLICY_RETURN_VALUE);
    return `/oauth/consent?${params.toString()}`;
  }, [authorizationId]);

  useEffect(() => {
    if (!authorizationId) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;

    const navigateSafely = (url: unknown) => {
      if (!isSafeSupabaseRedirectUrl(url)) {
        if (!cancelled) setState({ kind: "unavailable" });
        return;
      }
      window.location.assign(url);
    };

    const run = async () => {
      try {
        // UX-GAP.2B3B — reconcile stale BTPM OAuth grants BEFORE Supabase can
        // evaluate (and short-circuit) the pending authorization request.
        // Counts are operational only: never rendered, logged, persisted or
        // branched on. Only a thrown failure blocks the flow (fail-closed).
        try {
          await reconcileBtpmOAuthGrantsBeforeAuthorization();
        } catch {
          if (!cancelled) setState({ kind: "unavailable" });
          return;
        }
        if (cancelled) return;

        const oauth = (supabase.auth as unknown as {
          oauth?: { getAuthorizationDetails?: (id: string) => Promise<unknown> };
        }).oauth;
        if (!oauth || typeof oauth.getAuthorizationDetails !== "function") {
          if (!cancelled) setState({ kind: "unavailable" });
          return;
        }


        const result = (await oauth.getAuthorizationDetails(authorizationId)) as
          | {
              data?: {
                authorization_id?: unknown;
                redirect_url?: unknown;
                client?: { id?: unknown; name?: unknown } | null;
                redirect_uri?: unknown;
                scope?: unknown;
              } | null;
              error?: unknown;
            }
          | null
          | undefined;

        if (cancelled) return;

        if (!result || result.error) {
          setState({ kind: "unavailable" });
          return;
        }

        const data = result.data ?? null;
        if (!data || typeof data !== "object") {
          setState({ kind: "unavailable" });
          return;
        }

        // Already-consented short-circuit: no authorization_id, only redirect_url.
        // DELIBERATE DEFERRED BOUNDARY (UX-GAP.2B2): this branch stays exactly as
        // accepted. The BTPM business-consent gate is NOT evaluated here because
        // no exact OAuth client identity is present — a redirect URL, grant or
        // authorization code must never be used to infer the client. UX-GAP.2B3
        // will address policy re-consent for this branch with an exact identity
        // mechanism.
        const hasAuthorizationId =
          typeof data.authorization_id === "string" && data.authorization_id.length > 0;
        if (!hasAuthorizationId && typeof data.redirect_url === "string") {
          navigateSafely(data.redirect_url);
          return;
        }

        const clientName = sanitizeDisplayText(data.client?.name);
        const redirectUri = sanitizeDisplayText(data.redirect_uri);
        const scopes = parseScopeString(data.scope);

        if (!clientName || !redirectUri) {
          setState({ kind: "unavailable" });
          return;
        }

        // Exact OAuth client identity only — never name, redirect URI or Tenant.
        const oauthClientId = sanitizeOAuthClientId(data.client?.id);
        if (!oauthClientId) {
          setState({ kind: "unavailable" });
          return;
        }

        let gate: Awaited<ReturnType<typeof getApiDOAuthConsentGate>>;
        try {
          gate = await getApiDOAuthConsentGate(oauthClientId);
        } catch {
          if (!cancelled) setState({ kind: "unavailable" });
          return;
        }
        if (cancelled) return;

        if (!gate.eligible) {
          setState({ kind: "unavailable" });
          return;
        }

        if (gate.acknowledged) {
          setState({ kind: "ready", clientName, redirectUri, scopes });
          return;
        }

        const consentPath = buildApiDConsentReturnPath({
          clientKey: gate.clientKey,
          returnTo: policyReturnPath,
        });
        if (!consentPath) {
          setState({ kind: "unavailable" });
          return;
        }

        if (!policyReturn) {
          navigate(consentPath, { replace: true });
          return;
        }

        // Returned without acknowledgement (e.g. business-policy Deny): never
        // auto-redirect again — that would loop.
        setState({ kind: "policy_required", consentPath });
      } catch {
        if (!cancelled) setState({ kind: "unavailable" });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [authorizationId, policyReturn, policyReturnPath, navigate]);

  const decide = async (decision: "approve" | "deny") => {
    if (!authorizationId) return;
    if (submittingRef.current) return;
    if (decision === "approve" && state.kind !== "ready") return;
    if (decision === "deny" && state.kind !== "ready" && state.kind !== "policy_required") {
      return;
    }
    submittingRef.current = true;
    setState({ kind: "processing" });


    try {
      const oauth = (supabase.auth as unknown as {
        oauth?: {
          approveAuthorization?: (id: string) => Promise<unknown>;
          denyAuthorization?: (id: string) => Promise<unknown>;
        };
      }).oauth;
      const fn =
        decision === "approve" ? oauth?.approveAuthorization : oauth?.denyAuthorization;
      if (!oauth || typeof fn !== "function") {
        setState({ kind: "unavailable" });
        return;
      }

      const result = (await fn.call(oauth, authorizationId)) as
        | { data?: { redirect_url?: unknown } | null; error?: unknown }
        | null
        | undefined;

      if (!result || result.error) {
        setState({ kind: "unavailable" });
        return;
      }
      const redirectUrl = result.data?.redirect_url;
      if (!isSafeSupabaseRedirectUrl(redirectUrl)) {
        setState({ kind: "unavailable" });
        return;
      }
      window.location.assign(redirectUrl);
    } catch {
      setState({ kind: "unavailable" });
    }
  };

  if (state.kind === "loading") return <LoadingCard />;
  if (state.kind === "unavailable") return <UnavailableCard />;

  if (state.kind === "policy_required") {
    const consentPath = state.consentPath;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg" data-testid="oauth-consent-policy-required">
          <CardHeader>
            <CardTitle className="text-lg text-foreground">
              BTPM policy consent required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This application cannot be authorized until you acknowledge the current
              BTPM application policy.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => navigate(consentPath)}
                data-testid="oauth-review-policy-btn"
              >
                Review policy
              </Button>
              <Button
                variant="outline"
                onClick={() => void decide("deny")}
                data-testid="oauth-policy-deny-btn"
              >
                Deny application authorization
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }


  const isProcessing = state.kind === "processing";
  const view = state.kind === "ready" ? state : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-xl" data-testid="oauth-consent-page">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">
            Authorize application access
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Application
            </p>
            <p className="text-base text-foreground" data-testid="oauth-client-name">
              {view?.clientName ?? ""}
            </p>
          </section>

          <div className="grid gap-5 sm:grid-cols-2">
            <section className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Tenant
              </p>
              <p className="text-sm text-foreground" data-testid="oauth-tenant-name">
                {tenantName}
              </p>
            </section>

            <section className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Signed-in account
              </p>
              <p className="text-sm text-foreground break-all" data-testid="oauth-account-email">
                {accountEmail}
              </p>
            </section>
          </div>

          <section className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Redirect URI
            </p>
            <p className="text-sm text-foreground break-all" data-testid="oauth-redirect-uri">
              {view?.redirectUri ?? ""}
            </p>
          </section>

          {view && view.scopes.length > 0 && (
            <section className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Requested permissions
              </p>
              <ul
                className="text-sm text-foreground list-disc pl-5 space-y-1"
                data-testid="oauth-scopes"
              >
                {view.scopes.map((scope) => (
                  <li key={scope}>{describeScope(scope)}</li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-xs text-muted-foreground">
            Approving authorizes this application for this signed-in BTPM account and the
            active Tenant. BTPM API capability and data-access controls remain separately
            enforced.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void decide("approve")}
              disabled={isProcessing}
              data-testid="oauth-approve-btn"
            >
              {isProcessing ? "Processing…" : "Approve"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void decide("deny")}
              disabled={isProcessing}
              data-testid="oauth-deny-btn"
            >
              Deny
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
