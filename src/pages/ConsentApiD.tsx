/**
 * API-D.4 / UX-GAP.2A — Membership-aware consent page.
 *
 * Production capability: no build-time feature flag, no browser toggle.
 *
 * Rendering rules (see API_D_MEMBERSHIP_AWARE_CONSENT_CONTRACT.md §§4, 6):
 *  - URL params invalid, context missing/malformed, or `eligible !== true`
 *    => single generic unavailable state (indistinct from "not applicable"),
 *    never revealing which prerequisite failed.
 *  - Only safe fields render. UUIDs, tokens, secrets, raw errors, hidden
 *    scopes are never displayed.
 *  - Acknowledgement is business consent only; it grants no OAuth,
 *    capability, or API access.
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  sanitizeApiDClientKey,
  sanitizeApiDReturnTo,
  sanitizePolicyUri,
} from "@/lib/apiDConsent";
import {
  useApiDAcknowledgeMutation,
  useApiDConsentContext,
  useApiDRevokeMutation,
} from "@/hooks/useApiDConsent";


function UnavailableCard({ onReturn }: { onReturn: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg" data-testid="api-d-consent-unavailable">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">Consent not available</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This consent screen is not available for your account right now.
          </p>
          <Button variant="outline" onClick={onReturn}>
            Return
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ConsentApiD() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();




  const clientKey = sanitizeApiDClientKey(searchParams.get("client_key"));
  const returnTo = sanitizeApiDReturnTo(searchParams.get("return_to"));
  const goReturn = () => navigate(returnTo, { replace: true });

  const contextQuery = useApiDConsentContext(clientKey);
  const acknowledgeMutation = useApiDAcknowledgeMutation(clientKey);
  const revokeMutation = useApiDRevokeMutation(clientKey);
  const [pendingAction, setPendingAction] = useState<null | "approve" | "revoke">(null);

  const ctx = contextQuery.data;
  const isPending = pendingAction !== null ||
    acknowledgeMutation.isPending ||
    revokeMutation.isPending;

  const policyUri = useMemo(
    () => sanitizePolicyUri(ctx?.policy?.policy_uri ?? null),
    [ctx?.policy?.policy_uri],
  );

  if (!clientKey) return <UnavailableCard onReturn={goReturn} />;

  if (contextQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (contextQuery.isError || !ctx || ctx.eligible !== true) {
    return <UnavailableCard onReturn={goReturn} />;
  }

  const clientName = ctx.client?.display_name ?? "";
  const policyVersion = ctx.policy?.version ?? "";
  const policyDigest = ctx.policy?.policy_digest ?? "";
  const policyEffective = ctx.policy?.effective_at ?? "";
  const orgCount = ctx.organizations?.count ?? 0;
  const orgNames = ctx.organizations?.display_names ?? [];
  const wsCount = ctx.workspaces?.count ?? 0;
  const wsNames = ctx.workspaces?.display_names ?? [];
  const acknowledged = ctx.acknowledged === true;
  const capabilities = ctx.capabilities ?? [];
  const scopeLabel = (level: string) =>
    level === "organization"
      ? "Organization level"
      : level === "workspace"
        ? "Workspace level"
        : "Project level";

  const handleApprove = async () => {
    if (isPending) return;
    setPendingAction("approve");
    try {
      await acknowledgeMutation.mutateAsync();
      toast({ title: "Acknowledgement recorded" });
    } catch {
      toast({
        title: "Consent not available",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleRevoke = async () => {
    if (isPending) return;
    setPendingAction("revoke");
    try {
      await revokeMutation.mutateAsync();
      toast({ title: "Acknowledgement revoked" });
    } catch {
      toast({
        title: "Consent not available",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setPendingAction(null);
    }
  };

  // Deny does no RPC call and creates no audit row.
  const handleDeny = () => {
    if (isPending) return;
    goReturn();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-xl" data-testid="api-d-consent-page">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">Consent acknowledgement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-1">
            <p className="text-xs uppercase text-muted-foreground">Application</p>
            <p className="text-base text-foreground" data-testid="api-d-client-name">
              {clientName || "Application"}
            </p>
          </section>

          <section className="space-y-1">
            <p className="text-xs uppercase text-muted-foreground">Policy version</p>
            {policyUri ? (
              <a
                href={policyUri}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline"
                data-testid="api-d-policy-link"
              >
                {policyVersion || "View policy"}
              </a>
            ) : (
              <p className="text-sm text-foreground" data-testid="api-d-policy-text">
                {policyVersion || "Current policy"}
              </p>
            )}
            {policyEffective && (
              <p className="text-xs text-muted-foreground">Effective: {policyEffective}</p>
            )}
            {policyDigest && (
              <p className="text-xs text-muted-foreground break-all">Digest: {policyDigest}</p>
            )}
          </section>

          <section className="space-y-1">
            <p className="text-xs uppercase text-muted-foreground">Authorized scope</p>
            <p className="text-sm text-foreground">
              Organizations: {orgCount}
              {orgNames.length > 0 && ` — ${orgNames.join(", ")}`}
            </p>
            <p className="text-sm text-foreground">
              Workspaces: {wsCount}
              {wsNames.length > 0 && ` — ${wsNames.join(", ")}`}
            </p>
          </section>

          <section className="space-y-2" data-testid="api-d-capabilities">
            <p className="text-xs uppercase text-muted-foreground">Application capabilities</p>
            {capabilities.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="api-d-capabilities-empty">
                No API capabilities are currently enabled for your accessible scope.
              </p>
            ) : (
              <>
                <ul className="space-y-3">
                  {capabilities.map((cap, idx) => (
                    <li key={`${cap.api_version}-${cap.scope_level}-${idx}`} className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{cap.display_name}</p>
                      <p className="text-sm text-muted-foreground">{cap.description}</p>
                      <p className="text-xs text-muted-foreground">
                        API {cap.api_version} · {scopeLabel(cap.scope_level)}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  These capabilities are limited to the Organizations and Workspaces shown above
                  and remain subject to your ordinary BTPM access.
                </p>
              </>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            Acknowledgement is business consent only. It grants no API, OAuth, or capability
            access.
          </p>

          <div className="flex flex-wrap gap-2">
            {!acknowledged && (
              <>
                <Button
                  onClick={handleApprove}
                  disabled={isPending}
                  data-testid="api-d-approve-btn"
                >
                  {pendingAction === "approve" ? "Recording…" : "Approve"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDeny}
                  disabled={isPending}
                  data-testid="api-d-deny-btn"
                >
                  Deny
                </Button>
              </>
            )}
            {acknowledged && (
              <>
                <p
                  className="w-full text-sm text-foreground"
                  data-testid="api-d-acknowledged-status"
                >
                  You have acknowledged this policy version.
                </p>
                <Button
                  variant="destructive"
                  onClick={handleRevoke}
                  disabled={isPending}
                  data-testid="api-d-revoke-btn"
                >
                  {pendingAction === "revoke" ? "Revoking…" : "Revoke acknowledgement"}
                </Button>
                <Button
                  variant="outline"
                  onClick={goReturn}
                  disabled={isPending}
                  data-testid="api-d-continue-btn"
                >
                  Continue
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
