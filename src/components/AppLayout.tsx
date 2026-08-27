import { ReactNode, useState } from "react";
import btpmLogo from "@/assets/btpm-logo.png";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut, UserCircle, Shield, ShieldCheck, Map, BookOpen, Inbox, Users, AlertTriangle, FileText, FolderKanban, Briefcase, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useActiveOrgAdminAccess } from "@/hooks/useActiveOrgAdminAccess";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ScopeSelector } from "@/components/navigation/ScopeSelector";
import BtpmGuideButton from "@/components/ai/BtpmGuideButton";
import { useModuleRouteTracker } from "@/hooks/useModuleRouteTracker";
import { getLastModuleRoute } from "@/lib/moduleRoutes";
import ActiveContextChip from "@/components/layout/ActiveContextChip";
import { useActiveContext } from "@/context/ActiveContextProvider";
import NonProductionBanner from "@/components/layout/NonProductionBanner";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const { isOrgAdmin: activeOrgIsAdmin } = useActiveOrgAdminAccess();
  useModuleRouteTracker();
  const [guideOpen, setGuideOpen] = useState(false);
  const lastProjects = getLastModuleRoute("projects");
  const projectsTo =
    lastProjects &&
    (lastProjects.startsWith("/projects") ||
      /^\/workspace\/[^/]+\/project\/[^/]+/.test(lastProjects))
      ? lastProjects
      : "/projects";

  const { data: profile } = useQuery({
    queryKey: ["my-profile-decrypted"],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase.rpc("get_decrypted_profile");
      if (!data) return null;
      const d = data as any;
      return {
        display_name: d.display_name as string | null,
        email: d.email as string | null,
      };
    },
    enabled: !!user,
  });

  // Canonical Work Hub path is `/work/my-work`; `/my-work` remains a
  // backward-compatible alias that resolves to the same module/page.
  const workChildren = [
    {
      to: "/work/my-work",
      label: "My Work",
      icon: Inbox,
      isActive: (p: string) => p === "/my-work" || p.startsWith("/my-work/") || p.startsWith("/work/my-work"),
    },
    {
      to: "/work/team-work",
      label: "Team Work",
      icon: Users,
      isActive: (p: string) => p.startsWith("/work/team-work"),
    },
  ];

  const navItems = [
    { to: projectsTo, label: "Projects", icon: FolderKanban, exact: false, match: "/projects" },
    { to: "/roadmap", label: "Roadmap", icon: Map, exact: false, match: "/roadmap" },
    { to: "/benefits-realization", label: "Benefits Realization", icon: TrendingUp, exact: false, match: "/benefits-realization" },
    { to: "/risks-blockers", label: "Risks & Blockers", icon: AlertTriangle, exact: false, match: "/risks-blockers" },
    { to: "/files", label: "Files", icon: FileText, exact: false, match: "/files" },
    { to: "/knowledge", label: "Knowledge", icon: BookOpen, exact: false, match: "/knowledge" },
  ];

  const isWorkActive =
    workChildren.some((c) => c.isActive(pathname)) ||
    pathname === "/work" ||
    pathname.startsWith("/work/");

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ ["--btpm-guide-sidecar-width" as string]: "24rem" }}
    >
      {/* Sidebar */}
      <aside className="flex h-full w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div
          className="relative flex h-16 items-center border-b border-sidebar-border px-6"
          style={{ backgroundColor: "#e6e7e8" }}
        >
          <img
            src={btpmLogo}
            alt="BTPM"
            className="h-9 w-auto object-contain"
          />
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto space-y-1 p-3">
          <div className="mb-2">
            <ScopeSelector />
          </div>

          {/* Work group */}
          <div className="space-y-1">
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide",
                isWorkActive ? "text-sidebar-foreground" : "text-sidebar-foreground/60",
              )}
            >
              <Briefcase className="h-4 w-4 shrink-0" />
              Work
            </div>
            <div className="ml-3 space-y-1 border-l border-sidebar-border pl-2">
              {workChildren.map((child) => {
                const ChildIcon = child.icon;
                const isActive = child.isActive(pathname);
                return (
                  <Link
                    key={child.label}
                    to={child.to}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-primary-foreground font-medium"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                    )}
                  >
                    <ChildIcon className="h-4 w-4 shrink-0" />
                    {child.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact
              ? pathname === item.match
              : pathname.startsWith(item.match) ||
                (item.match === "/projects" &&
                  /^\/workspace\/[^/]+\/project\/[^/]+/.test(pathname));
            return (
              <Link
                key={item.label}
                to={item.to}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}

          <SaasAdminNavLinks pathname={pathname} />


          {activeOrgIsAdmin && (
            <Link
              to="/admin"
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                pathname.startsWith("/admin") &&
                  !pathname.startsWith("/admin/platform") &&
                  !pathname.startsWith("/admin/tenant") &&
                  !pathname.startsWith("/admin/hub")
                  ? "bg-sidebar-accent text-sidebar-primary-foreground font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              )}
            >
              <Shield className="h-4 w-4 shrink-0" />
              Org Admin
            </Link>
          )}
        </nav>

        <div className="border-t border-sidebar-border p-3 space-y-2">
          <div className="mb-2">
            <ActiveContextChip />
          </div>
          <div className="flex items-center gap-2 px-2">
            <UserCircle className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">
                {profile?.display_name || profile?.email || user?.email}
              </p>
            </div>
          </div>
          <Link
            to="/account"
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
              pathname === "/account"
                ? "bg-sidebar-accent text-sidebar-primary-foreground"
                : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
            )}
          >
            <UserCircle className="h-4 w-4" />
            Account
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="w-full justify-start text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main
        className={cn(
          "flex-1 min-w-0 min-h-0 overflow-auto relative transition-[padding] duration-200",
          guideOpen && "xl:pr-[var(--btpm-guide-sidecar-width)]",
        )}
      >
        <NonProductionBanner />
        <BtpmGuideButton open={guideOpen} onOpenChange={setGuideOpen} />
        {children}
      </main>
    </div>
  );
}

function SaasAdminNavLinks({ pathname }: { pathname: string }) {
  const access = useAdminAccess();
  const { activeTenant, isLoading: ctxLoading } = useActiveContext();
  if (access.isLoading || ctxLoading) return null;
  const activeTenantIsAdmin =
    !!activeTenant && access.isTenantAdminForTenant(activeTenant.id);
  if (!access.canOpenPlatformAdmin && !activeTenantIsAdmin) return null;

  const linkClass = (isActive: boolean) =>
    cn(
      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
      isActive
        ? "bg-sidebar-accent text-sidebar-primary-foreground font-medium"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
    );

  return (
    <>
      {access.canOpenPlatformAdmin && (
        <Link to="/admin/platform" className={linkClass(pathname.startsWith("/admin/platform") || pathname.startsWith("/admin/hub"))}>
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Platform Admin
        </Link>
      )}
      {activeTenantIsAdmin && (
        <Link to="/admin/tenant" className={linkClass(pathname.startsWith("/admin/tenant"))}>
          <ShieldCheck className="h-4 w-4 shrink-0" />
          Tenant Admin
        </Link>
      )}
    </>
  );
}
