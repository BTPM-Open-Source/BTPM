import { Button } from "@/components/ui/button";
import { ShieldX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function AccountDeactivated() {
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <ShieldX className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Account Deactivated</h1>
        <p className="text-muted-foreground">
          Your account has been deactivated by an organization administrator.
          You no longer have access to this application. If you believe this is
          an error, please contact your organization admin.
        </p>
        <Button onClick={handleSignOut} variant="outline" className="mt-4">
          Sign out
        </Button>
      </div>
    </div>
  );
}
