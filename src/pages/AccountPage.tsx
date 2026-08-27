import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentUserAccess } from "@/hooks/useCurrentUserAccess";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, User, Shield, KeyRound, Mail, Building2, Briefcase, Pencil, Check, X, Tag } from "lucide-react";
import { APP_VERSION, BUILD_VERSION, RELEASED_AT_UTC } from "@/release/releaseMetadata.generated";
import { ConnectedAppsCard } from "@/components/account/ConnectedAppsCard";


function formatRole(role: string | null): string {
  if (!role) return "—";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AccountPage() {
  const { user, signOut } = useAuth();
  const { data: access, isLoading } = useCurrentUserAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Display name editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [nameLoading, setNameLoading] = useState(false);

  const handleStartEditName = () => {
    setNameValue(access?.display_name || "");
    setEditingName(true);
  };

  const handleSaveName = async () => {
    const trimmed = nameValue.trim();
    if (!trimmed) {
      toast({ title: "Error", description: "Display name cannot be empty", variant: "destructive" });
      return;
    }
    setNameLoading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: trimmed })
        .eq("id", user!.id);
      if (error) throw error;
      toast({ title: "Name updated" });
      setEditingName(false);
      queryClient.invalidateQueries({ queryKey: ["current-user-access"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setNameLoading(false);
    }
  };

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  // Email change
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailPending, setEmailPending] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setPwLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setPwLoading(false);
    }
  };

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || newEmail === user?.email) {
      toast({ title: "Error", description: "Please enter a different email address", variant: "destructive" });
      return;
    }
    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.updateUser(
        { email: newEmail },
        { emailRedirectTo: `${window.location.origin}/account` }
      );
      if (error) throw error;
      setEmailPending(true);
      setNewEmail("");
      toast({
        title: "Confirmation required",
        description: "A confirmation email has been sent to both your current and new email addresses. Please confirm to complete the change.",
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setEmailLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Account</h1>
            <p className="text-sm text-muted-foreground">Manage your credentials and view your access</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
      </div>

      {/* Section A: Account Identity */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-lg">Account Identity</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
            <span className="text-muted-foreground">Display name</span>
            <span className="flex items-center gap-2">
              {editingName ? (
                <>
                  <Input
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    className="h-7 w-48 text-sm"
                    disabled={nameLoading}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveName();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    autoFocus
                  />
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleSaveName} disabled={nameLoading}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingName(false)} disabled={nameLoading}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-foreground">{access?.display_name || "—"}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleStartEditName}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </span>
            <span className="text-muted-foreground">Email</span>
            <span className="text-foreground">{access?.email || user?.email || "—"}</span>
            <span className="text-muted-foreground">Status</span>
            <span>
              <Badge variant={access?.is_active !== false ? "default" : "destructive"}>
                {access?.is_active !== false ? "Active" : "Deactivated"}
              </Badge>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Section B: Security */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-lg">Security</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Change Password */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Change Password</h3>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
              <Input
                type="password"
                placeholder="New password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Confirm new password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={pwLoading}>
                {pwLoading ? "Updating…" : "Change Password"}
              </Button>
            </form>
          </div>

          <Separator />

          {/* Change Email */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Change Email</h3>
            </div>
            {emailPending && (
              <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                A confirmation email has been sent. Please check both your current and new email inboxes to complete the change.
              </div>
            )}
            <form onSubmit={handleChangeEmail} className="space-y-3 max-w-sm">
              <Input
                type="email"
                placeholder="New email address"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={emailLoading}>
                {emailLoading ? "Requesting…" : "Request Email Change"}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      <ConnectedAppsCard userId={user?.id ?? null} />

      {/* Section C: Access Summary */}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-lg">Access Summary</CardTitle>
          </div>
          <CardDescription>Your current organization and workspace access</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Organization */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Organization</h3>
            </div>
            {access?.organization_name ? (
              <div className="grid grid-cols-[120px_1fr] gap-2 text-sm pl-6">
                <span className="text-muted-foreground">Name</span>
                <span className="text-foreground">{access.organization_name}</span>
                <span className="text-muted-foreground">Org role</span>
                <span className="text-foreground">
                  <Badge variant="outline">{formatRole(access.org_role)}</Badge>
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground pl-6">Not part of an organization</p>
            )}
          </div>

          <Separator />

          {/* Workspaces */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Workspaces</h3>
            </div>
            {!access?.workspaces?.length ? (
              <p className="text-sm text-muted-foreground pl-6">
                No workspace access yet. An admin will assign you to workspaces as needed.
              </p>
            ) : (
              <div className="space-y-2 pl-6">
                {access.workspaces.map((ws) => (
                  <div key={ws.workspace_id} className="flex items-center justify-between rounded-md border border-border p-3">
                    <span className="text-sm font-medium text-foreground">{ws.workspace_name}</span>
                    <Badge variant="secondary">{formatRole(ws.role)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section D: Build Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-lg">Build Info</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
            <span className="text-muted-foreground">App version</span>
            <span className="font-mono text-foreground">{APP_VERSION}</span>
            <span className="text-muted-foreground">Build</span>
            <span className="font-mono text-foreground break-all">{BUILD_VERSION}</span>
            <span className="text-muted-foreground">Released</span>
            <span className="text-foreground">{new Date(RELEASED_AT_UTC).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
