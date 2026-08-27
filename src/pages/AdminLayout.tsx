import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useActiveOrgAdminAccess } from "@/hooks/useActiveOrgAdminAccess";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { ManageAdminsDialog } from "@/components/admin/ManageAdminsDialog";


const adminSections = [
  { label: "Users", path: "users" },
  { label: "Invitations", path: "invitations" },
  { label: "Portfolio", path: "portfolio" },
  { label: "SharePoint", path: "sharepoint" },
  { label: "KPI App Integration", path: "kpi-app" },
  { label: "Power BI", path: "power-bi" },
  { label: "AI Guide", path: "ai-guide" },
  { label: "AI Settings", path: "ai-settings" },
  { label: "Project Moves", path: "project-moves" },
  { label: "Imports", path: "imports" },
];

export default function AdminLayout() {
  const { isOrgAdmin, isLoading, organizationId, organizationName } = useActiveOrgAdminAccess();
  const location = useLocation();
  const [manageOpen, setManageOpen] = useState(false);


  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold text-foreground">No active Organization</h1>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Pick an Organization from the context selector to open Org Admin.
          </p>
          <Button variant="outline" asChild>
            <Link to="/"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!isOrgAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold text-foreground">Access Denied</h1>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Org Admin is available only to Org Admins for the active Organization
            {organizationName ? ` (${organizationName})` : ""}.
          </p>
          <Button variant="outline" asChild>
            <Link to="/"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  const currentSection = location.pathname.replace("/admin/", "").replace("/admin", "") || "users";

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Org Admin</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Organization-level administration for workspaces and organization settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
            <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Manage Org Admins
          </Button>
          {/* Phase 4D.8E — Demo workspace seed shortcut removed. */}
          <KnowledgeLink slug="roles-and-permissions" label="Roles & permissions" />
        </div>
      </div>
      {organizationId && (
        <ManageAdminsDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          scope="org_org_admin"
          scopeId={organizationId}
          contextLabel={organizationName ?? null}
        />
      )}


      <div className="flex gap-1 border-b border-border flex-wrap">
        {adminSections.map((section) => (
          <Link
            key={section.path}
            to={`/admin/${section.path}`}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              currentSection === section.path
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            {section.label}
          </Link>
        ))}
        {/* Step API-G.5.8A-1 — links out to the dedicated shared Connected Apps surface. */}
        <Link
          to="/admin/connected-apps"
          className="px-4 py-2 text-sm font-medium border-b-2 -mb-px border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          Connected Apps
        </Link>
      </div>

      <Outlet context={{ organizationId }} />
    </div>
  );
}
