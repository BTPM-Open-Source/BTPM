import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

/**
 * Password recovery page — recovery only.
 * Invite acceptance is handled by /accept-invite (AcceptInvite.tsx).
 */

const AUTH_SEARCH_PARAMS = ["code", "token_hash", "type", "error", "error_code", "error_description"];
const AUTH_HASH_PARAMS = [
  "access_token", "refresh_token", "expires_in", "expires_at", "token_type",
  "type", "error", "error_code", "error_description",
  "provider_token", "provider_refresh_token", "token_hash",
];

function stripAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  AUTH_SEARCH_PARAMS.forEach((p) => url.searchParams.delete(p));
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  AUTH_HASH_PARAMS.forEach((p) => hashParams.delete(p));
  url.hash = hashParams.toString() ? `#${hashParams.toString()}` : "";
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function getCode() {
  return new URLSearchParams(window.location.search).get("code");
}

function getTokenHash() {
  const sp = new URLSearchParams(window.location.search);
  const hp = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return sp.get("token_hash") ?? hp.get("token_hash");
}

export default function ResetPasswordPage() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [validSession, setValidSession] = useState(false);
  const { toast } = useToast();
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    const bootstrap = async () => {
      const code = getCode();
      const tokenHash = getTokenHash();

      try {
        let session = null;

        if (code) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          session = data.session;
        } else if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });
          if (error) throw error;
          const { data } = await supabase.auth.getSession();
          session = data.session;
        } else {
          // No link credentials — check for existing recovery session
          const { data } = await supabase.auth.getSession();
          session = data.session;
        }

        if (session?.user) {
          stripAuthParamsFromUrl();
          setValidSession(true);
        }
      } catch (err) {
        console.error("ResetPassword bootstrap error:", err);
      } finally {
        setInitializing(false);
      }
    };

    void bootstrap();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      toast({
        title: "Password updated",
        description: "Your password has been reset successfully. Redirecting to your account…",
      });

      setTimeout(() => { window.location.href = "/account"; }, 1200);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl text-foreground">Set New Password</CardTitle>
          <p className="text-sm text-muted-foreground">BTPM — Project Management</p>
        </CardHeader>
        <CardContent>
          {initializing ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground">Validating link…</p>
            </div>
          ) : !validSession ? (
            <div className="text-center py-4">
              <p className="text-muted-foreground">Invalid or expired link.</p>
              <Button variant="link" className="mt-2" onClick={() => (window.location.href = "/auth")}>
                Back to Sign In
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input type="password" placeholder="New password" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <Input type="password" placeholder="Confirm new password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "…" : "Reset Password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
