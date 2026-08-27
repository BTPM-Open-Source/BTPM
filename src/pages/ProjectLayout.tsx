import { useState } from "react";
import { useParams, Link, Outlet, useLocation } from "react-router-dom";
import { useProject } from "@/hooks/useProjectOverview";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { SiblingPager, neighbours } from "@/components/navigation/SiblingPager";
import { useWorkspaceProjects } from "@/hooks/useProjectOverview";
import { PhaseFormDialog } from "@/components/planning/PhaseFormDialog";
import { useProjectPhases } from "@/hooks/useProjectPlanning";
import { PageContainer } from "@/components/layout/PageContainer";
import { useProjectAccessMap } from "@/hooks/useProjectAccessMap";
import { ProjectMoreActionsMenu } from "@/components/project/ProjectMoreActionsMenu";
import { useCanHardDeleteBusinessObject } from "@/hooks/useCanHardDeleteBusinessObject";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Tabs whose primary work surface is canvas-like (Gantt/Calendar). */
const CANVAS_TABS = new Set(["gantt", "calendar"]);

type NavDest = { label: string; path: string };
type NavGroup = { id: string; label: string; destinations: NavDest[] };

const BASE_GROUPS: NavGroup[] = [
  { id: "overview", label: "Overview", destinations: [{ label: "Overview", path: "" }] },
  {
    id: "workplan",
    label: "Work plan",
    destinations: [
      { label: "Phases & tasks", path: "planning" },
      { label: "Timeline", path: "gantt" },
      { label: "Calendar", path: "calendar" },
    ],
  },
  {
    id: "control",
    label: "Control",
    destinations: [
      { label: "Risks & blockers", path: "risks" },
      { label: "Governance", path: "governance" },
      { label: "KPIs", path: "kpis" },
      { label: "Benefits Realization", path: "benefits" },
      { label: "Adoption plan", path: "adoption" },
    ],
  },
  { id: "people", label: "People", destinations: [{ label: "Team & RACI", path: "team" }] },
  { id: "files", label: "Files", destinations: [{ label: "Shared files", path: "files" }] },
];

const AGILE_GROUP: NavGroup = {
  id: "agile",
  label: "Agile",
  destinations: [
    { label: "Backlog", path: "agile/backlog" },
    { label: "Sprints", path: "agile/sprints" },
    { label: "Board", path: "agile/board" },
  ],
};

function groupContainsTab(group: NavGroup, currentTab: string): boolean {
  return group.destinations.some((d) =>
    d.path === "" ? currentTab === "" : currentTab === d.path || currentTab.startsWith(d.path + "/"),
  );
}

export default function ProjectLayout() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const location = useLocation();
  const [addPhaseOpen, setAddPhaseOpen] = useState(false);

  const { data: project, isLoading, error } = useProject(projectId);
  const { canEdit } = useProjectPlanningAuthority(projectId);
  const access = useProjectAccessMap();
  const { data: canHardDelete = false } = useCanHardDeleteBusinessObject(project?.workspace_id);
  const { data: workspaceProjects = [] } = useWorkspaceProjects(workspaceId);
  const { data: projectPhases = [] } = useProjectPhases(projectId);

  const accessDenied =
    !!project &&
    !access.isLoading &&
    !access.canSeeProject({ id: project.id, workspace_id: project.workspace_id });

  const { data: workspace } = useQuery({
    queryKey: ["workspace-decrypted", workspaceId],
    queryFn: async () => {
      if (!workspaceId) throw new Error("No workspace ID");
      const { data, error } = await supabase.rpc("get_decrypted_workspace", { _workspace_id: workspaceId });
      if (error) throw error;
      return data as any;
    },
    enabled: !!workspaceId,
  });

  if (isLoading) {
    return (
      <PageContainer width="wide" className="py-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </PageContainer>
    );
  }

  if (error || !project || accessDenied) {
    return (
      <PageContainer width="wide" className="py-6">
        <p className="text-destructive">
          {accessDenied
            ? "You do not have access to this project."
            : error?.message || "Project not found. You may not have access."}
        </p>
        <Button variant="link" asChild className="mt-2 p-0">
          <Link to={workspaceId ? `/workspace/${workspaceId}` : "/projects"}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Link>
        </Button>
      </PageContainer>
    );
  }

  const isAgileEnabled = !!project.agile_enabled;
  const groups: NavGroup[] = isAgileEnabled ? [...BASE_GROUPS, AGILE_GROUP] : BASE_GROUPS;

  const basePath = `/workspace/${workspaceId}/project/${projectId}`;
  const currentTab =
    location.pathname === basePath || location.pathname === basePath + "/"
      ? ""
      : location.pathname.replace(basePath + "/", "");
  const searchParams = new URLSearchParams(location.search);
  const returnToParam = searchParams.get("returnTo");
  const fromParam = searchParams.get("from") || (location.state as any)?.from;
  const fromGantt = fromParam === "gantt";
  const fromRoadmap = fromParam === "roadmap";
  const fromCalendar = fromParam === "calendar";
  const fromMyWork = fromParam === "my-work";
  const fromProjects = fromParam === "projects";
  const fromRisks = fromParam === "risks-blockers";
  const fromFiles = fromParam === "files";
  const fromWorkspace = fromParam === "workspace";

  const moduleDefault = fromRoadmap
    ? { to: "/roadmap", label: "Back to Roadmap" }
    : fromMyWork
    ? { to: "/my-work", label: "Back to My Work" }
    : fromRisks
    ? { to: "/risks-blockers", label: "Back to Risks & Blockers" }
    : fromFiles
    ? { to: "/files", label: "Back to Files" }
    : fromWorkspace
    ? { to: `/workspace/${workspaceId}`, label: "Back to workspace" }
    : { to: "/projects", label: "Back to Projects" };

  const projectLevelBackTo = returnToParam ? decodeURIComponent(returnToParam) : moduleDefault.to;
  const projectLevelBackLabel = moduleDefault.label;

  const isDetailRoute = currentTab.startsWith("task/") || currentTab.startsWith("phase/");
  const layoutBackTo =
    isDetailRoute && (returnToParam || fromGantt || fromRoadmap || fromCalendar || fromMyWork || fromProjects || fromRisks || fromFiles)
      ? returnToParam
        ? decodeURIComponent(returnToParam)
        : ((location.state as any)?.returnTo as string | undefined) ||
          (fromRoadmap
            ? "/roadmap"
            : fromCalendar
            ? `${basePath}/calendar`
            : fromMyWork
            ? "/my-work"
            : fromRisks
            ? "/risks-blockers"
            : fromFiles
            ? "/files"
            : fromProjects
            ? "/projects"
            : `${basePath}/gantt`)
      : projectLevelBackTo;
  const layoutBackLabel =
    isDetailRoute && (returnToParam || fromGantt || fromRoadmap || fromCalendar || fromMyWork || fromProjects || fromRisks || fromFiles)
      ? fromRoadmap
        ? "Back to Roadmap"
        : fromCalendar
        ? "Back to Calendar"
        : fromMyWork
        ? "Back to My Work"
        : fromRisks
        ? "Back to Risks & Blockers"
        : fromFiles
        ? "Back to Files"
        : fromProjects
        ? "Back to Projects"
        : "Back to Gantt"
      : projectLevelBackLabel;

  const projectSiblings = (workspaceProjects as any[]).filter((p) => !p.is_archived);
  const { prev: prevProject, next: nextProject } = neighbours(projectSiblings, projectId);
  const tabSuffix = currentTab ? `/${currentTab}` : "";
  const buildProjectSiblingTo = (id: string) => `/workspace/${workspaceId}/project/${id}${tabSuffix}`;
  const showProjectPager = !isDetailRoute;

  const isCanvasTab = CANVAS_TABS.has(currentTab);
  const showAddPhaseInHeader = currentTab === "planning" && canEdit && !isDetailRoute;

  return (
    <>
      <PageContainer width="wide" className="pt-6 space-y-4">
        {/* Back nav */}
        <Button variant="ghost" size="sm" asChild>
          <Link to={layoutBackTo}>
            <ArrowLeft className="h-4 w-4 mr-1" /> {layoutBackLabel}
          </Link>
        </Button>

        {/* Project identity + compact action cluster */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {showProjectPager && (
              <SiblingPager
                prevTo={prevProject ? buildProjectSiblingTo(prevProject.id) : null}
                nextTo={nextProject ? buildProjectSiblingTo(nextProject.id) : null}
                prevLabel="Previous project"
                nextLabel="Next project"
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground truncate">{project.name}</h1>
                {isAgileEnabled && (
                  <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                    Agile
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {workspace?.name || "Workspace"}
                {(project as any).portfolio_item_id && (
                  <>
                    {" · "}
                    Portfolio:{" "}
                    {(project as any).portfolio_code
                      ? `${(project as any).portfolio_code} — ${(project as any).portfolio_name ?? ""}`
                      : ((project as any).portfolio_name ?? "")}
                    {(project as any).portfolio_is_archived ? " (archived)" : ""}
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showAddPhaseInHeader && (
              <Button variant="outline" size="sm" onClick={() => setAddPhaseOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add phase
              </Button>
            )}
            <ProjectMoreActionsMenu
              project={project}
              workspaceName={workspace?.name}
              canEdit={canEdit}
              agileEnabled={isAgileEnabled}
              isArchived={(project as any).is_archived ?? false}
              canHardDelete={canHardDelete}
            />
          </div>
        </div>

        {/* Grouped project navigation */}
        <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Project sections">
          {groups.map((group) => {
            const isActive = groupContainsTab(group, currentTab);
            if (group.destinations.length === 1) {
              const dest = group.destinations[0];
              const to = dest.path ? `${basePath}/${dest.path}` : basePath;
              return (
                <Link
                  key={group.id}
                  to={to}
                  className={cn(
                    "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                  )}
                >
                  {group.label}
                </Link>
              );
            }
            return (
              <DropdownMenu key={group.id}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap inline-flex items-center gap-1 outline-none",
                      isActive
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                    )}
                  >
                    {group.label}
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  {group.destinations.map((dest) => {
                    const to = dest.path ? `${basePath}/${dest.path}` : basePath;
                    const destActive =
                      dest.path === ""
                        ? currentTab === ""
                        : currentTab === dest.path || currentTab.startsWith(dest.path + "/");
                    return (
                      <DropdownMenuItem key={dest.path} asChild>
                        <Link
                          to={to}
                          className={cn("w-full", destActive && "font-semibold text-foreground")}
                        >
                          {dest.label}
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
        </nav>
      </PageContainer>

      {/* Tab content — width adapts: canvas for Gantt/Calendar, standard otherwise */}
      <PageContainer width={isCanvasTab ? "canvas" : "standard"} className="pt-4 pb-6">
        <Outlet context={{ project, workspace }} />
      </PageContainer>

      {addPhaseOpen && projectId && project.workspace_id && project.organization_id && (
        <PhaseFormDialog
          open={addPhaseOpen}
          onClose={() => setAddPhaseOpen(false)}
          projectId={projectId}
          workspaceId={project.workspace_id}
          organizationId={project.organization_id}
          allPhases={projectPhases as any}
          existingPhaseCount={(projectPhases as any[]).filter((p) => !p.is_archived).length}
        />
      )}
    </>
  );
}
