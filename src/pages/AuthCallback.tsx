import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import btpmLogo from "@/assets/btpm-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sanitizeReturnTo } from "@/lib/authReturnTo";

type CallbackState =
  | { kind: "working" }
  | { kind: "no_access" }
  | { kind: "error"; message: string };

export default function AuthCallback() {
  const [state, setState] = useState<CallbackState>({ kind: "working" });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const errDesc = url.searchParams.get("error_description") || url.searchParams.get("error");
        const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));

        if (errDesc) throw new Error(errDesc);

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (exchangeError) throw exchangeError;
        } else {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error("No authorization code returned from provider.");
        }

        // Ensure profile row exists (idempotent) before redemption.
        try {
          await supabase.rpc("ensure_user_profile");
        } catch (e) {
          console.warn("ensure_user_profile failed:", e);
        }

        // Attempt to auto-redeem any pending invitation matching the signed-in email.
        // This is the canonical SSO activation bridge — it does not bypass invitation rules.
        const { data: redeemData, error: redeemError } = await supabase.functions.invoke(
          "redeem-invitations",
          { body: {} },
        );

        if (cancelled) return;

        if (redeemError) {
          // Distinguish "no invitation" (404) from genuine errors.
          // supabase.functions.invoke surfaces non-2xx as FunctionsHttpError; inspect context if present.
          const ctx: any = (redeemError as any).context;
          let status: number | undefined;
          let bodyText: string | undefined;
          try {
            status = ctx?.status;
            if (ctx?.json) {
              const j = await ctx.json();
              bodyText = j?.error;
            }
          } catch {
            // ignore
          }

          if (status === 404) {
            // Authenticated but no app access assigned — sign out and surface clear message.
            await supabase.auth.signOut();
            setState({ kind: "no_access" });
            return;
          }

          throw new Error(bodyText || redeemError.message || "Activation failed.");
        }

        // Success: redeemed (count >=0) or already_reconciled. Continue to app.
        const status = (redeemData as any)?.status;
        const profile = await supabase
          .from("profiles")
          .select("organization_id")
          .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
          .maybeSingle();

        if (!profile.data?.organization_id && status !== "already_reconciled") {
          // Defensive guard: redemption returned success but no org attached.
          await supabase.auth.signOut();
          setState({ kind: "no_access" });
          return;
        }

        window.location.replace(returnTo);
      } catch (e: any) {
        if (!cancelled) setState({ kind: "error", message: e?.message ?? "Sign-in failed." });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const isWorking = state.kind === "working";
  const title =
    state.kind === "working"
      ? "Signing you in…"
      : state.kind === "no_access"
        ? "No access assigned"
        : "Sign-in failed";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center">
          <img src={btpmLogo} alt="BTPM" className="h-10 w-auto object-contain mb-2" />
          <CardTitle className="text-xl text-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {isWorking && (
            <p className="text-sm text-muted-foreground text-center">
              Completing Microsoft sign-in, please wait…
            </p>
          )}
          {state.kind === "no_access" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Your Microsoft account is authenticated, but no BTPM access has been assigned to this
                email yet. Please contact your administrator to request an invitation.
              </p>
              <Button asChild className="w-full">
                <Link to="/auth">Back to Sign In</Link>
              </Button>
            </div>
          )}
          {state.kind === "error" && (
            <div className="space-y-4">
              <p className="text-sm text-destructive break-words">{state.message}</p>
              <Button asChild className="w-full">
                <Link to="/auth">Back to Sign In</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
