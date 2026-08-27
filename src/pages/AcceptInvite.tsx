import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

/**
 * Dedicated invite acceptance page — mirrors the working COG pattern.
 *
 * Invite onboarding is session-first only: wait for the invite session,
 * let the user set a password, then finish auth onboarding.
 * No app-side org/workspace reconciliation runs here.
 */
export default function AcceptInvitePage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const settleInviteSession = (session: Session | null) => {
      setValid(Boolean(session?.user));
      setChecking(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        settleInviteSession(session);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      settleInviteSession(session);
    });

    return () => subscription.unsubscribe();
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

      // Activate canonical app state: create org-level profile + mark invitation accepted.
      const { data: { user } } = await supabase.auth.getUser();
      const invitationId = user?.user_metadata?.invitation_id;
      try {
        const { error: redeemError } = await supabase.functions.invoke("redeem-invitations", {
          body: invitationId ? { invitation_id: invitationId } : {},
        });
        if (redeemError) {
          console.warn("Redeem invitations call failed (will reconcile on next admin load):", redeemError);
        }
      } catch (redeemErr) {
        console.warn("Redeem invitations network error (will reconcile on next admin load):", redeemErr);
      }

      toast({
        title: "Account setup complete",
        description: "Your password is set. You can now continue.",
      });

      setTimeout(() => navigate("/"), 1200);
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

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Verifying invitation…</p>
      </div>
    );
  }

  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl text-foreground">Invalid or Expired Invitation</CardTitle>
            <p className="text-sm text-muted-foreground">This invitation link is no longer valid.</p>
          </CardHeader>
          <CardContent className="text-center">
            <Button variant="link" onClick={() => navigate("/auth")}>
              Back to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl text-foreground">Set Your Password</CardTitle>
          <p className="text-sm text-muted-foreground">BTPM — Project Management</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input type="password" placeholder="New password" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <Input type="password" placeholder="Confirm password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Setting up…" : "Set Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
