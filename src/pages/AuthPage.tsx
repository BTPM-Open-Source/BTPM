import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import btpmLogo from "@/assets/btpm-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { sanitizeReturnTo } from "@/lib/authReturnTo";

type AuthMode = "signin" | "forgot";

export default function AuthPage() {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const { toast } = useToast();

  const handleMicrosoft = async () => {
    setOauthLoading(true);
    try {
      const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
      const redirectTo = `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          scopes: "email",
          redirectTo,
        },
      });
      if (error) throw error;
      // Browser will redirect; no further state to set.
    } catch (err: any) {
      toast({ title: "Microsoft sign-in failed", description: err.message, variant: "destructive" });
      setOauthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "forgot") {
        const { error } = await supabase.functions.invoke("send-password-reset", {
          body: {
            email,
            redirectTo: `${window.location.origin}/reset-password`,
          },
        });
        if (error) throw error;
        toast({ title: "Reset link sent", description: "If an account exists for that email, a reset link has been sent." });
        setMode("signin");
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center">
          <img src={btpmLogo} alt="BTPM" className="h-10 w-auto object-contain mb-2" />
          <CardTitle className="text-xl text-foreground">
            {mode === "signin" ? "Sign In" : "Reset Password"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">Business Transformation & Project Management</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              placeholder="Email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {mode === "signin" && (
              <Input
                type="password"
                placeholder="Password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            <Button type="submit" className="w-full" disabled={loading || oauthLoading}>
              {loading ? "…" : mode === "signin" ? "Sign In" : "Send Reset Link"}
            </Button>
          </form>
          {mode === "signin" && (
            <>
              <div className="my-4 flex items-center gap-2">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">OR</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleMicrosoft}
                disabled={loading || oauthLoading}
              >
                {oauthLoading ? "Redirecting…" : "Sign in with Microsoft"}
              </Button>
            </>
          )}
          <div className="mt-4 flex flex-col gap-2">
            {mode === "signin" ? (
              <Button
                variant="link"
                className="text-sm"
                onClick={() => setMode("forgot")}
              >
                Forgot password?
              </Button>
            ) : (
              <Button
                variant="link"
                className="text-sm"
                onClick={() => setMode("signin")}
              >
                Back to Sign In
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
