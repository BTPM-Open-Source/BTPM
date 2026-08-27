import { useEffect, useState } from "react";
import { useActiveOrgAdminAccess } from "@/hooks/useActiveOrgAdminAccess";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert, ArrowLeft, Mail, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * /test-email — Phase 4D.11A hardened.
 *
 * - Requires Org Admin for the active Organization.
 * - Exercises the tenant SMTP notification pipeline (NOT Microsoft Graph and
 *   NOT Supabase Auth SMTP). Uses the tenant secret resolver via the
 *   send-test-email edge function.
 * - Backend authorizes the caller (Tenant Admin or Org Admin) and forces the
 *   recipient to the signed-in admin's own email address.
 * - Blocks outbound send in non-production (QAS/Test) via
 *   `assert_environment_action_allowed(activeOrganization.id, 'outbound_email')`.
 */
export default function TestEmail() {
  const { isOrgAdmin, isLoading: adminLoading } = useActiveOrgAdminAccess();
  const { activeOrganization, isLoading: ctxLoading } = useActiveContext();
  const { user } = useAuth();
  const callerEmail = user?.email ?? "";
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const isNonProd =
    !!activeOrganization && activeOrganization.environmentRole !== "production";

  useEffect(() => {
    setResult(null);
  }, [activeOrganization?.id]);

  if (adminLoading || ctxLoading) {
    return (
      <div className="max-w-lg mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!isOrgAdmin) {
    return (
      <div className="max-w-lg mx-auto p-6 flex flex-col items-center py-16 space-y-4">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <h1 className="text-xl font-semibold">Access Denied</h1>
        <p className="text-sm text-muted-foreground">
          Org Admin for the active Organization required.
        </p>
        <Button variant="outline" asChild>
          <Link to="/"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
        </Button>
      </div>
    );
  }

  const handleSend = async () => {
    if (!activeOrganization || !callerEmail) return;
    setSending(true);
    setResult(null);
    try {
      // Backend-authoritative non-production block. Also enforced client-side
      // below via the disabled button, but this call is the source of truth.
      const { error: gateErr } = await supabase.rpc("assert_environment_action_allowed", {
        _organization_id: activeOrganization.id,
        _action: "outbound_email",
        _reason: "test-email UI send",
      });
      if (gateErr) {
        throw new Error(
          "Outbound email is disabled in non-production environments.",
        );
      }
      const { data: resp, error } = await supabase.functions.invoke("send-test-email", {
        body: {
          organization_id: activeOrganization.id,
        },
      });
      if (error) throw error;
      if (resp?.error) throw new Error(resp.error);
      setResult({ ok: true, message: `Test email sent to ${callerEmail}` });
    } catch (err: any) {
      setResult({ ok: false, message: err.message || "Failed to send" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Mail className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Test Email</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Send a test email to verify the <strong>BTPM tenant SMTP</strong>{" "}
        notification configuration is working. This exercises the tenant SMTP
        secrets and the outbound email gate — not Microsoft Graph and not
        Supabase Auth SMTP. Scoped to the active Organization
        {activeOrganization ? ` · ${activeOrganization.name}` : ""}.
      </p>
      <p className="text-xs text-muted-foreground">
        For safety, the test email is always delivered to the signed-in admin's
        own address{callerEmail ? ` (${callerEmail})` : ""}.
      </p>

      {isNonProd && (
        <div className="flex items-start gap-2 p-3 rounded-md border bg-amber-50 border-amber-200 text-amber-900 text-sm">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          <span>Outbound email is disabled in non-production environments.</span>
        </div>
      )}

      <div className="space-y-3">
        <Button
          onClick={handleSend}
          disabled={sending || isNonProd || !activeOrganization || !callerEmail}
        >
          {sending ? "Sending…" : `Send Test Email${callerEmail ? ` to ${callerEmail}` : ""}`}
        </Button>
      </div>

      {result && (
        <div className={`flex items-start gap-2 p-3 rounded-md border ${result.ok ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
          {result.ok ? <CheckCircle className="h-5 w-5 mt-0.5 shrink-0" /> : <XCircle className="h-5 w-5 mt-0.5 shrink-0" />}
          <span className="text-sm">{result.message}</span>
        </div>
      )}

      <Button variant="outline" size="sm" asChild>
        <Link to="/admin/users"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Admin</Link>
      </Button>
    </div>
  );
}

