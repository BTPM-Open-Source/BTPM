import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspaces } from "@/hooks/useProjectOverview";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Check, X } from "lucide-react";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { useActiveOrgAdminAccess } from "@/hooks/useActiveOrgAdminAccess";
import { DemoBadge } from "@/components/workspace/DemoBadge";


const Index = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const { data: workspaces, isLoading, error, refetch } = useWorkspaces();
  const { toast } = useToast();
  const { activeOrganization } = useActiveContext();
  const { isOrgAdmin } = useActiveOrgAdminAccess();
  const navigate = useNavigate();

  // Check if user has a profile with an org
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["my-profile-decrypted"],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.rpc("get_decrypted_profile");
      if (!data) return null;
      const d = data as any;
      return {
        id: d.id as string,
        organization_id: d.organization_id as string | null,
        display_name: d.display_name as string | null,
        email: d.email as string | null,
      };
    },
    enabled: !!user,
  });

  const [showOrgForm, setShowOrgForm] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [orgLoading, setOrgLoading] = useState(false);

  const [showWsForm, setShowWsForm] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsLoading, setWsLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);

  const handleStartRename = (e: React.MouseEvent, ws: { id: string; name: string }) => {
    e.preventDefault();
    e.stopPropagation();
    setRenamingId(ws.id);
    setRenameValue(ws.name);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRenamingId(null);
    setRenameValue("");
  };

  const handleSaveRename = async (e: React.MouseEvent | React.FormEvent, wsId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setRenameLoading(true);
    try {
      const { error } = await supabase
        .from("workspaces")
        .update({ name: trimmed })
        .eq("id", wsId);
      if (error) throw error;
      toast({ title: "Workspace renamed" });
      setRenamingId(null);
      setRenameValue("");
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setRenameLoading(false);
    }
  };

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("create") === "workspace") {
      setShowWsForm(true);
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (authLoading || profileLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  // Not authenticated → redirect to /auth
  if (!user) {
    navigate("/auth");
    return null;
  }

  const hasOrg = !!profile?.organization_id;

  const handleBootstrapOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrgLoading(true);
    try {
      // Ensure profile exists first
      await supabase.from("profiles").upsert({
        id: user.id,
        email: user.email,
        display_name: profile?.display_name || user.email?.split("@")[0] || "User",
      });

      const { error } = await supabase.rpc("bootstrap_organization", {
        _name: orgName,
        _slug: orgSlug.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      });
      if (error) throw error;
      toast({ title: "Organization created" });
      setShowOrgForm(false);
      // Refetch everything
      window.location.reload();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setOrgLoading(false);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrganization) {
      toast({
        title: "No active organization",
        description: "Select an organization before creating a workspace.",
        variant: "destructive",
      });
      return;
    }
    setWsLoading(true);
    try {
      const { error } = await (supabase.rpc as any)("create_workspace_in_organization", {
        _organization_id: activeOrganization.id,
        _name: wsName,
      });
      if (error) throw error;
      toast({
        title: "Workspace created",
        description: `In ${activeOrganization.name}`,
      });
      setShowWsForm(false);
      setWsName("");
      refetch();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setWsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Workspaces</h1>
      </div>

      {/* State A: No organization */}
      {!hasOrg && (
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              You are not part of an organization yet. Create one to get started.
            </p>
            {!showOrgForm ? (
              <Button onClick={() => setShowOrgForm(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create Organization
              </Button>
            ) : (
              <form onSubmit={handleBootstrapOrg} className="max-w-sm mx-auto space-y-3 text-left">
                <Input
                  placeholder="Organization name"
                  required
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                    setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                  }}
                />
                <Input
                  placeholder="Slug (URL-friendly)"
                  required
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="submit" disabled={orgLoading}>
                    {orgLoading ? "Creating…" : "Create"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowOrgForm(false)}>Cancel</Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* State B & C: Has org, show workspaces */}
      {hasOrg && (
        <>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : error ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Unable to load workspaces.
              </CardContent>
            </Card>
          ) : !workspaces?.length ? (
            <Card>
              <CardContent className="py-8 text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                  {isOrgAdmin
                    ? "No workspaces yet. Create the first workspace to start managing projects."
                    : "No workspaces available. Contact your organization admin to get workspace access."}
                </p>
                {isOrgAdmin && (
                  !showWsForm ? (
                    <Button onClick={() => setShowWsForm(true)}>
                      <Plus className="h-4 w-4 mr-1" /> Create Workspace
                    </Button>
                  ) : (
                    <form onSubmit={handleCreateWorkspace} className="max-w-sm mx-auto space-y-3 text-left">
                      <Input
                        placeholder="Workspace name"
                        required
                        value={wsName}
                        onChange={(e) => setWsName(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button type="submit" disabled={wsLoading}>
                          {wsLoading ? "Creating…" : "Create"}
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setShowWsForm(false)}>Cancel</Button>
                      </div>
                    </form>
                  )
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Select a workspace
                  {activeOrganization ? ` · ${activeOrganization.name}` : ""}
                </p>
                {!showWsForm && isOrgAdmin && (
                  <Button variant="outline" size="sm" onClick={() => setShowWsForm(true)}>
                    <Plus className="h-4 w-4 mr-1" /> New workspace
                  </Button>
                )}
              </div>
              {showWsForm && (
                <form onSubmit={handleCreateWorkspace} className="flex gap-2 items-end">
                  <Input
                    placeholder="Workspace name"
                    required
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button type="submit" size="sm" disabled={wsLoading}>
                    {wsLoading ? "…" : "Create"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setShowWsForm(false); setWsName(""); }}>Cancel</Button>
                </form>
              )}
              <div className="space-y-2">
                {workspaces.map((ws: any) => {
                  const isRenaming = renamingId === ws.id;
                  if (isRenaming) {
                    return (
                      <Card key={ws.id}>
                        <CardContent className="py-3 flex items-center gap-2">
                          <Input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRename(e, ws.id);
                              if (e.key === "Escape") handleCancelRename(e as any);
                            }}
                            className="flex-1"
                            disabled={renameLoading}
                          />
                          <Button
                            size="sm"
                            onClick={(e) => handleSaveRename(e, ws.id)}
                            disabled={renameLoading || !renameValue.trim()}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancelRename}
                            disabled={renameLoading}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  }
                  return (
                    <Card key={ws.id} className="hover:bg-accent/50 transition-colors">
                      <CardContent className="py-4 flex items-center justify-between gap-3">
                        <Link to={`/workspace/${ws.id}`} className="flex-1 flex items-center gap-3 min-w-0">
                          <p className="font-medium text-foreground truncate">{ws.name}</p>
                          {ws.is_demo && <DemoBadge />}
                        </Link>
                        {isOrgAdmin && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => handleStartRename(e, ws)}
                            aria-label={`Rename ${ws.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

            </>
          )}
        </>
      )}
    </div>
  );
};

export default Index;
