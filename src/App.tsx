import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import AuthCallback from "./pages/AuthCallback.tsx";
import MsAuthCallback from "./pages/MsAuthCallback.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import AcceptInvite from "./pages/AcceptInvite.tsx";
import ProgramDetail from "./pages/ProgramDetail.tsx";
import ProjectLayout from "./pages/ProjectLayout.tsx";
import ProjectGovernance from "./pages/ProjectGovernance.tsx";
import ProjectDecisionCase from "./pages/ProjectDecisionCase.tsx";
import ProjectOverviewTab from "./pages/ProjectOverviewTab.tsx";
import ProjectPlanning from "./pages/ProjectPlanning.tsx";
import TaskDetail from "./pages/TaskDetail.tsx";
import PhaseDetail from "./pages/PhaseDetail.tsx";
import ProjectGantt from "./pages/ProjectGantt.tsx";
import ProjectCalendar from "./pages/ProjectCalendar.tsx";
import ProjectRisksBlockers from "./pages/ProjectRisksBlockers.tsx";
import ProjectTeam from "./pages/ProjectTeam.tsx";
import ProjectBacklog from "./pages/ProjectBacklog.tsx";
import ProjectSprints from "./pages/ProjectSprints.tsx";
import ProjectBoard from "./pages/ProjectBoard.tsx";
import ProjectKpis from "./pages/ProjectKpis.tsx";
import ProjectBenefits from "./pages/ProjectBenefits.tsx";
import ProjectAdoption from "./pages/ProjectAdoption.tsx";
import ProjectSharedFiles from "./pages/ProjectSharedFiles.tsx";
import AdminLayout from "./pages/AdminLayout.tsx";
import AdminUsers from "./pages/AdminUsers.tsx";
import AdminUserDetail from "./pages/AdminUserDetail.tsx";
import AdminInvitations from "./pages/AdminInvitations.tsx";
import AdminSharepoint from "./pages/AdminSharepoint.tsx";
import AdminKpiAppIntegration from "./pages/AdminKpiAppIntegration.tsx";
import AdminProjectMoves from "./pages/AdminProjectMoves.tsx";
import AdminImports from "./pages/AdminImports.tsx";
import AdminPowerBI from "./pages/AdminPowerBI.tsx";
import AdminPortfolio from "./pages/AdminPortfolio.tsx";
import AccountDeactivated from "./pages/AccountDeactivated.tsx";
import ConsentApiD from "./pages/ConsentApiD.tsx";
import OAuthConsent from "./pages/OAuthConsent.tsx";
import AccountPage from "./pages/AccountPage.tsx";
import TestEmail from "./pages/TestEmail.tsx";
import Roadmap from "./pages/Roadmap.tsx";
import RoadmapStatusPack from "./pages/RoadmapStatusPack.tsx";
import Knowledge from "./pages/Knowledge.tsx";
import KnowledgeSeed from "./pages/KnowledgeSeed.tsx";
// Phase 4D.8E — Standalone seed shortcut pages removed. Future existing-data
// loading must go through a governed Import Data capability.
import AdminBtpmGuideEvaluation from "./pages/AdminBtpmGuideEvaluation.tsx";
import AdminAiGuideV2Smoke from "./pages/AdminAiGuideV2Smoke.tsx";
import AdminAiGuide from "./pages/AdminAiGuide.tsx";
import AdminAiSettings from "./pages/AdminAiSettings.tsx";
import MyWork from "./pages/MyWork.tsx";
import TeamWork from "./pages/TeamWork.tsx";
import RisksBlockers from "./pages/RisksBlockers.tsx";
import FilesPage from "./pages/Files.tsx";
// Phase 4D.14A.7G — OneNote readiness diagnostic retired.
import PublishedStoryPresentationView from "./pages/PublishedStoryPresentationView.tsx";
import BenefitsRealization from "./pages/BenefitsRealization.tsx";

import ProjectsLayout from "./pages/ProjectsLayout.tsx";
import {
  ProjectsTabProjects,
  ProjectsTabPrograms,
  ProjectsTabTemplates,
  ProjectsTabMembers,
  ProjectsTabSharepoint,
  ProjectsTabPeoplePresets,
} from "./pages/ProjectsTabs.tsx";
import LegacyWorkspaceTabRedirect from "./pages/LegacyWorkspaceTabRedirect.tsx";
import { ActiveWorkspaceProvider } from "@/context/ActiveWorkspaceContext";
import { ActiveContextProvider } from "@/context/ActiveContextProvider";
import SelectContext from "./pages/SelectContext.tsx";
import AdminHub from "./pages/admin/AdminHub.tsx";
import AdminPlatform from "./pages/admin/AdminPlatform.tsx";
import AdminPlatformTenants from "./pages/admin/AdminPlatformTenants.tsx";
import AdminPlatformSystem from "./pages/admin/AdminPlatformSystem.tsx";
import AdminPlatformApiClients from "./pages/admin/AdminPlatformApiClients.tsx";
import AdminPlatformApiClientDetail from "./pages/admin/AdminPlatformApiClientDetail.tsx";
import AdminTenant from "./pages/admin/AdminTenant.tsx";
import AdminTenantOrganizations from "./pages/admin/AdminTenantOrganizations.tsx";
import AdminTenantEncryption from "./pages/admin/AdminTenantEncryption.tsx";
import AdminTenantMembers from "./pages/admin/AdminTenantMembers.tsx";
import AdminTenantIntegrations from "./pages/admin/AdminTenantIntegrations.tsx";
import AdminTenantFilesExportsJobs from "./pages/admin/AdminTenantFilesExportsJobs.tsx";
import AdminConnectedApps from "./pages/admin/AdminConnectedApps.tsx";
import AdminTenantConnectedApps from "./pages/admin/AdminTenantConnectedApps.tsx";

import { AnyAdminGuard, PlatformAdminGuard, TenantAdminGuard, OrganizationConnectedAppsAdminGuard } from "./pages/admin/guards.tsx";
import {
  WorkspaceRouteGuard,
  ProgramRouteGuard,
  ProjectRouteGuard,
  PhaseRouteGuard,
  TaskRouteGuard,
} from "@/components/routing/RouteGuards";
import { sanitizeReturnTo } from "@/lib/authReturnTo";


function AuthGuardedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isDeactivated } = useAuth();
  const location = window.location;
  if (loading) return null;
  if (!user) {
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  if (isDeactivated) return <Navigate to="/account-deactivated" replace />;
  return (
    <ActiveContextProvider>
      <ActiveWorkspaceProvider>
        <AppLayout>{children}</AppLayout>
      </ActiveWorkspaceProvider>
    </ActiveContextProvider>
  );
}

function AuthRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) {
    // Redirect to sanitized returnTo if present (deep-link support).
    // sanitizeReturnTo rejects absolute URLs, protocol-relative //host,
    // and /\host backslash tricks, falling back to "/".
    const params = new URLSearchParams(window.location.search);
    const returnTo = sanitizeReturnTo(params.get("returnTo"));
    return <Navigate to={returnTo} replace />;
  }
  return <AuthPage />;
}

function DeactivatedRoute() {
  const { user, loading, isDeactivated } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isDeactivated) return <Navigate to="/" replace />;
  return <AccountDeactivated />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<AuthRoute />} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/ms-callback" element={<MsAuthCallback />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/account-deactivated" element={<DeactivatedRoute />} />
            {/* API-D.4 / UX-GAP.2A — membership-aware consent page.
                Production capability, no build-time flag. Auth-required:
                unauthenticated users are sent to /auth with a sanitized
                returnTo and come back to this consent URL. */}
            <Route path="/consent/api-d" element={<AuthGuardedRoute><ConsentApiD /></AuthGuardedRoute>} />
            {/* API-H.0A / API-Q.5 — Supabase OAuth 2.1 Server authorization
                consent. Distinct from API-D business consent and from BTPM
                Connected App authorization. Any authenticated, non-deactivated
                user may complete the delegated OAuth flow, so this route is
                intentionally NOT behind TenantAdminGuard. Server-side MCP/API
                access still fails closed through canonical `authorizeClient`. */}
            <Route path="/oauth/consent" element={<AuthGuardedRoute><OAuthConsent /></AuthGuardedRoute>} />
            <Route path="/" element={<AuthGuardedRoute><Index /></AuthGuardedRoute>} />
            <Route path="/select-context" element={<AuthGuardedRoute><SelectContext /></AuthGuardedRoute>} />
            <Route path="/account" element={<AuthGuardedRoute><AccountPage /></AuthGuardedRoute>} />
            <Route path="/test-email" element={<AuthGuardedRoute><TestEmail /></AuthGuardedRoute>} />
            <Route path="/roadmap" element={<AuthGuardedRoute><Roadmap /></AuthGuardedRoute>} />
            <Route path="/roadmap/status-pack" element={<AuthGuardedRoute><RoadmapStatusPack /></AuthGuardedRoute>} />
            {/* Phase 6B.8e — Roadmap Stories Library alias route. */}
            <Route path="/roadmap/stories" element={<Navigate to="/roadmap?tab=status-pack" replace />} />
            <Route path="/story-presentations/:versionId" element={<AuthGuardedRoute><PublishedStoryPresentationView /></AuthGuardedRoute>} />
            <Route path="/my-work" element={<AuthGuardedRoute><MyWork /></AuthGuardedRoute>} />
            <Route path="/work/my-work" element={<AuthGuardedRoute><MyWork /></AuthGuardedRoute>} />
            <Route path="/work/team-work" element={<AuthGuardedRoute><TeamWork /></AuthGuardedRoute>} />
            <Route path="/projects" element={<AuthGuardedRoute><ProjectsLayout /></AuthGuardedRoute>}>
              <Route index element={<ProjectsTabProjects />} />
              <Route path="programs" element={<ProjectsTabPrograms />} />
              <Route path="templates" element={<ProjectsTabTemplates />} />
              <Route path="members" element={<ProjectsTabMembers />} />
              <Route path="people-presets" element={<ProjectsTabPeoplePresets />} />
              <Route path="sharepoint" element={<ProjectsTabSharepoint />} />
            </Route>
            <Route path="/risks-blockers" element={<AuthGuardedRoute><RisksBlockers /></AuthGuardedRoute>} />
            <Route path="/benefits-realization" element={<AuthGuardedRoute><BenefitsRealization /></AuthGuardedRoute>} />
            <Route path="/files" element={<AuthGuardedRoute><FilesPage /></AuthGuardedRoute>} />
            <Route path="/knowledge" element={<AuthGuardedRoute><Knowledge /></AuthGuardedRoute>} />
            <Route path="/knowledge/seed" element={<AuthGuardedRoute><KnowledgeSeed /></AuthGuardedRoute>} />
            <Route path="/knowledge/:slug" element={<AuthGuardedRoute><Knowledge /></AuthGuardedRoute>} />
            {/* Phase 4D.6 — SaaS Admin shell (Platform / Tenant). Read-only. */}
            <Route path="/admin/hub" element={<AuthGuardedRoute><AnyAdminGuard><AdminHub /></AnyAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/platform" element={<AuthGuardedRoute><PlatformAdminGuard><AdminPlatform /></PlatformAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/platform/tenants" element={<AuthGuardedRoute><PlatformAdminGuard><AdminPlatformTenants /></PlatformAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/platform/system" element={<AuthGuardedRoute><PlatformAdminGuard><AdminPlatformSystem /></PlatformAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/platform/api-clients" element={<AuthGuardedRoute><PlatformAdminGuard><AdminPlatformApiClients /></PlatformAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/platform/api-clients/:clientId" element={<AuthGuardedRoute><PlatformAdminGuard><AdminPlatformApiClientDetail /></PlatformAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/tenant" element={<AuthGuardedRoute><TenantAdminGuard><AdminTenant /></TenantAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/tenant/organizations" element={<AuthGuardedRoute><TenantAdminGuard><AdminTenantOrganizations /></TenantAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/tenant/members" element={<AuthGuardedRoute><TenantAdminGuard><AdminTenantMembers /></TenantAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/tenant/integrations" element={<AuthGuardedRoute><TenantAdminGuard><AdminTenantIntegrations /></TenantAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/tenant/encryption" element={<AuthGuardedRoute><TenantAdminGuard><AdminTenantEncryption /></TenantAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin/tenant/files-exports-jobs" element={<AuthGuardedRoute><TenantAdminGuard><AdminTenantFilesExportsJobs /></TenantAdminGuard></AuthGuardedRoute>} />
            {/* Step API-ADM.7 — Tenant-native Connected Apps page (explicit Organization selector). */}
            <Route path="/admin/tenant/connected-apps" element={<AuthGuardedRoute><TenantAdminGuard><AdminTenantConnectedApps /></TenantAdminGuard></AuthGuardedRoute>} />

            {/* Step API-G.5.8A-1 — dedicated Connected Apps surface, declared before the nested /admin layout. */}
            <Route path="/admin/connected-apps" element={<AuthGuardedRoute><OrganizationConnectedAppsAdminGuard><AdminConnectedApps /></OrganizationConnectedAppsAdminGuard></AuthGuardedRoute>} />
            <Route path="/admin" element={<AuthGuardedRoute><AdminLayout /></AuthGuardedRoute>}>
              <Route index element={<Navigate to="/admin/users" replace />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="users/:userId" element={<AdminUserDetail />} />
              <Route path="invitations" element={<AdminInvitations />} />
              <Route path="portfolio" element={<AdminPortfolio />} />
              <Route path="sharepoint" element={<AdminSharepoint />} />
              <Route path="kpi-app" element={<AdminKpiAppIntegration />} />
              <Route path="power-bi" element={<AdminPowerBI />} />
              <Route path="ai-guide" element={<AdminAiGuide />} />
              <Route path="ai-settings" element={<AdminAiSettings />} />
              <Route path="project-moves" element={<AdminProjectMoves />} />
              <Route path="imports" element={<AdminImports />} />


            </Route>
            {/* Phase 4D.8E — /admin/demo-seed, /admin/plaio-seed, /admin/lisdex-caps-seed
                and /admin/inclisiran-seed removed. Requests fall through to NotFound. */}
            <Route path="/admin/btpm-guide-evaluation" element={<AuthGuardedRoute><AdminBtpmGuideEvaluation /></AuthGuardedRoute>} />
            <Route path="/admin/ai-guide-v2-smoke" element={<AuthGuardedRoute><AdminAiGuideV2Smoke /></AuthGuardedRoute>} />
            {/* Phase 4D.14A.7G — /admin/onenote-readiness retired with the OneNote readiness diagnostic. */}
            <Route path="/workspace/:workspaceId" element={<AuthGuardedRoute><WorkspaceRouteGuard><LegacyWorkspaceTabRedirect /></WorkspaceRouteGuard></AuthGuardedRoute>} />
            <Route path="/workspace/:workspaceId/programs" element={<AuthGuardedRoute><WorkspaceRouteGuard><LegacyWorkspaceTabRedirect tab="programs" /></WorkspaceRouteGuard></AuthGuardedRoute>} />
            <Route path="/workspace/:workspaceId/templates" element={<AuthGuardedRoute><WorkspaceRouteGuard><LegacyWorkspaceTabRedirect tab="templates" /></WorkspaceRouteGuard></AuthGuardedRoute>} />
            <Route path="/workspace/:workspaceId/members" element={<AuthGuardedRoute><WorkspaceRouteGuard><LegacyWorkspaceTabRedirect tab="members" /></WorkspaceRouteGuard></AuthGuardedRoute>} />
            <Route path="/workspace/:workspaceId/sharepoint" element={<AuthGuardedRoute><WorkspaceRouteGuard><LegacyWorkspaceTabRedirect tab="sharepoint" /></WorkspaceRouteGuard></AuthGuardedRoute>} />

            <Route path="/workspace/:workspaceId/program/:programId" element={<AuthGuardedRoute><ProgramRouteGuard><ProgramDetail /></ProgramRouteGuard></AuthGuardedRoute>} />
            <Route path="/workspace/:workspaceId/project/:projectId" element={<AuthGuardedRoute><ProjectRouteGuard><ProjectLayout /></ProjectRouteGuard></AuthGuardedRoute>}>
              <Route index element={<ProjectOverviewTab />} />
              <Route path="team" element={<ProjectTeam />} />
              <Route path="risks" element={<ProjectRisksBlockers />} />
              <Route path="planning" element={<ProjectPlanning />} />
              <Route path="gantt" element={<ProjectGantt />} />
              <Route path="calendar" element={<ProjectCalendar />} />
              <Route path="governance" element={<ProjectGovernance />} />
              <Route path="governance/decision-cases/:recordId" element={<ProjectDecisionCase />} />
              <Route path="kpis" element={<ProjectKpis />} />
              <Route path="benefits" element={<ProjectBenefits />} />
              <Route path="adoption" element={<ProjectAdoption />} />
              <Route path="files" element={<ProjectSharedFiles />} />
              <Route path="agile/backlog" element={<ProjectBacklog />} />
              <Route path="agile/sprints" element={<ProjectSprints />} />
              <Route path="agile/board" element={<ProjectBoard />} />
              <Route path="task/:taskId" element={<TaskRouteGuard><TaskDetail /></TaskRouteGuard>} />
              <Route path="phase/:phaseId" element={<PhaseRouteGuard><PhaseDetail /></PhaseRouteGuard>} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
