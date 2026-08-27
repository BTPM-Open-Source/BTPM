import { Link, Outlet, useLocation } from "react-router-dom";
import { useActiveWorkspace } from "@/context/ActiveWorkspaceContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * UX-FIX — Canonical Projects module.
 *
 * One consistent shell for the Projects operational area. Scoped by the active
 * workspace context (NOT the URL). Tabs reuse the existing workspace tab
 * components by passing the active workspace id as a prop.
 *
 * Workspace lifecycle / Deactivate / management chrome lives in the Workspaces
 * management hub (/) and is intentionally NOT shown here.
 */
const tabs = [
  { label: "Projects", path: "" },
  { label: "Programs", path: "programs" },
  { label: "Templates", path: "templates" },
  { label: "Members", path: "members" },
  { label: "People presets", path: "people-presets" },
  { label: "SharePoint", path: "sharepoint" },
];

export default function ProjectsLayout() {
  const { activeWorkspaceId, isAllWorkspaces, isLoading, activeWorkspace } =
    useActiveWorkspace();
  const location = useLocation();

  if (isLoading) return null;

  if (isAllWorkspaces || !activeWorkspaceId) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Projects</h1>
          <p className="text-xs text-muted-foreground mt-1">All workspaces</p>
        </div>
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Select a workspace to use Projects.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/">Manage workspaces</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const basePath = "/projects";
  const currentTab =
    location.pathname === basePath || location.pathname === basePath + "/"
      ? ""
      : location.pathname.replace(basePath + "/", "");

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Projects</h1>
        {activeWorkspace?.name && (
          <p className="text-xs text-muted-foreground mt-1">
            {activeWorkspace.name}
          </p>
        )}
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <Link
            key={tab.path}
            to={tab.path ? `${basePath}/${tab.path}` : basePath}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              currentTab === tab.path
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <Outlet context={{ workspaceId: activeWorkspaceId }} />
    </div>
  );
}
