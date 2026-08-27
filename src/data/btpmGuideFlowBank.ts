// AI-FLOW.1 — Flow Guidance Bank for BTPM Guide Evaluation.
// Test data only. No persistent storage. No operational PM data is accessed.
// The exact flow matrix and 120 questions below are mandated by the AI-FLOW.1 spec
// and must not be rewritten or AI-generated.

import type { BtpmGuideEvalQuestion } from "./btpmGuideEvalQuestionBank";

export type FlowCriticality = "critical" | "high" | "medium" | "low";
export type FlowStage = NonNullable<BtpmGuideEvalQuestion["flow_stage"]>;

export interface FlowMatrixEntry {
  flow_id: string;
  area: string;
  expected_sources: string[];
  must_include_ui_terms: string[];
  criticality: FlowCriticality;
}

export const FLOW_MATRIX: FlowMatrixEntry[] = [
  { flow_id: "create_blank_project", area: "Project creation and setup", expected_sources: ["how-to-create-a-project"], must_include_ui_terms: ["Projects", "workspace", "New project", "Blank", "Project name", "Create project"], criticality: "critical" },
  { flow_id: "create_project_from_template", area: "Project creation and setup", expected_sources: ["how-to-create-a-project", "project-templates"], must_include_ui_terms: ["Projects", "New project", "From template", "template", "Project start date", "Create from template"], criticality: "critical" },
  { flow_id: "complete_project_overview", area: "Project creation and setup", expected_sources: ["using-project-overview", "how-to-create-a-project"], must_include_ui_terms: ["Project Overview", "description", "owner", "dates", "scope"], criticality: "high" },
  { flow_id: "generate_project_charter", area: "Project creation and setup", expected_sources: ["how-to-generate-project-charter", "how-to-refresh-project-charter"], must_include_ui_terms: ["Project Overview", "Project Charter", "generate", "refresh"], criticality: "high" },
  { flow_id: "create_phases_and_tasks", area: "Project planning", expected_sources: ["how-to-create-phases-and-tasks"], must_include_ui_terms: ["Project Planning", "phase", "task", "owner", "due date"], criticality: "critical" },
  { flow_id: "add_task_to_phase", area: "Project planning", expected_sources: ["how-to-create-phases-and-tasks", "using-task-detail-page"], must_include_ui_terms: ["Project Planning", "phase", "task", "New task", "Add task"], criticality: "high" },
  { flow_id: "add_dependency", area: "Project planning", expected_sources: ["how-to-add-a-dependency", "dependencies-rulebook"], must_include_ui_terms: ["dependency", "predecessor", "successor", "Project Planning", "Gantt"], criticality: "high" },
  { flow_id: "update_execution", area: "Project execution", expected_sources: ["how-to-update-execution", "comment-vs-execution-update-rulebook"], must_include_ui_terms: ["Task detail", "Execution update", "comment", "status"], criticality: "high" },
  { flow_id: "use_gantt", area: "Timeline and calendar", expected_sources: ["using-project-gantt", "roadmap-and-gantt"], must_include_ui_terms: ["Gantt", "timeline", "phases", "tasks", "edit mode"], criticality: "high" },
  { flow_id: "use_project_calendar", area: "Timeline and calendar", expected_sources: ["using-project-calendar"], must_include_ui_terms: ["Project Calendar", "dates", "milestones", "governance", "source item"], criticality: "medium" },
  { flow_id: "create_or_manage_risk", area: "Risks and blockers", expected_sources: ["faq-risk-or-blocker", "risk-vs-blocker-rulebook", "how-to-manage-risks-and-blockers"], must_include_ui_terms: ["Risks and Blockers", "risk", "owner", "mitigation"], criticality: "high" },
  { flow_id: "create_or_manage_blocker", area: "Risks and blockers", expected_sources: ["faq-risk-or-blocker", "risk-vs-blocker-rulebook", "how-to-manage-risks-and-blockers"], must_include_ui_terms: ["Risks and Blockers", "blocker", "owner", "next action", "resolve"], criticality: "high" },
  { flow_id: "configure_project_kpi", area: "KPIs", expected_sources: ["how-to-configure-project-kpis", "kpi-definitions-and-updates"], must_include_ui_terms: ["Project KPIs", "KPI name", "target", "owner", "update frequency"], criticality: "high" },
  { flow_id: "update_kpi_value", area: "KPIs", expected_sources: ["how-to-update-kpis", "kpi-definitions-and-updates"], must_include_ui_terms: ["Project KPIs", "value", "reporting period", "update"], criticality: "high" },
  { flow_id: "capture_kpi_snapshot", area: "KPIs", expected_sources: ["how-to-capture-kpi-snapshots", "official-kpi-snapshots-vs-manual-update-history"], must_include_ui_terms: ["KPI snapshot", "reporting period", "capture", "snapshot"], criticality: "high" },
  { flow_id: "kpi_app_readiness_admin", area: "KPI App admin", expected_sources: ["using-kpi-app-admin-page", "why-kpi-app-report-not-ready", "kpi-readiness-statuses"], must_include_ui_terms: ["Admin KPI App", "mapping", "reporting period", "readiness", "submission"], criticality: "high" },
  { flow_id: "setup_governance_cadence", area: "Governance", expected_sources: ["how-to-set-up-governance-cadence"], must_include_ui_terms: ["Governance", "cadence", "owner", "frequency", "next expected date", "evidence"], criticality: "high" },
  { flow_id: "record_governance_evidence", area: "Governance", expected_sources: ["how-to-record-governance-evidence"], must_include_ui_terms: ["Governance", "record", "evidence", "decision", "follow-up"], criticality: "high" },
  { flow_id: "use_governance_overview_calendar", area: "Governance", expected_sources: ["governance-overview-and-calendar"], must_include_ui_terms: ["Governance", "calendar", "overdue", "missing records"], criticality: "medium" },
  { flow_id: "use_files", area: "Files and documents", expected_sources: ["how-to-use-files"], must_include_ui_terms: ["Files", "workspace", "project", "folder", "document"], criticality: "high" },
  { flow_id: "setup_sharepoint_admin", area: "SharePoint", expected_sources: ["how-to-set-up-sharepoint-in-admin"], must_include_ui_terms: ["Admin SharePoint", "site", "folder", "permissions", "Microsoft account"], criticality: "high" },
  { flow_id: "connect_project_sharepoint_folder", area: "SharePoint", expected_sources: ["how-to-connect-project-to-sharepoint-folder"], must_include_ui_terms: ["Project Files", "SharePoint folder", "connect", "permission"], criticality: "high" },
  { flow_id: "generate_project_status_deck", area: "Generated outputs", expected_sources: ["weekly-project-status-deck"], must_include_ui_terms: ["Project Overview", "status deck", "generate", "BTPM source data"], criticality: "high" },
  { flow_id: "generate_roadmap_status_deck", area: "Generated outputs", expected_sources: ["roadmap-status-deck", "using-roadmap"], must_include_ui_terms: ["Roadmap", "filters", "selected scope", "Generate PPT", "Status Deck"], criticality: "high" },
  { flow_id: "use_roadmap_filters", area: "Roadmap", expected_sources: ["using-roadmap", "saved-views-and-filters"], must_include_ui_terms: ["Roadmap", "filters", "workspace", "program", "project"], criticality: "high" },
  { flow_id: "use_roadmap_views", area: "Roadmap", expected_sources: ["using-roadmap"], must_include_ui_terms: ["Overview", "Dashboard", "Timeline", "Calendar", "filters"], criticality: "medium" },
  { flow_id: "use_powerbi_admin", area: "Power BI", expected_sources: ["workflow-configure-power-bi-admin", "why-power-bi-data-is-stale-or-different"], must_include_ui_terms: ["Admin Power BI", "Workspace", "reporting", "scope", "source data"], criticality: "high" },
  { flow_id: "manage_project_access", area: "Access and users", expected_sources: ["how-to-manage-project-access", "project-level-access-control"], must_include_ui_terms: ["Project Team", "access", "role", "viewer", "contributor", "admin"], criticality: "critical" },
  { flow_id: "manage_workspace_members", area: "Access and users", expected_sources: ["using-workspace-members"], must_include_ui_terms: ["Members", "workspace", "role", "project access"], criticality: "high" },
  { flow_id: "invite_user", area: "Access and users", expected_sources: ["using-admin-invitations"], must_include_ui_terms: ["Admin Invitations", "email", "invitation", "account", "workspace"], criticality: "high" },
  { flow_id: "account_access_password_reset", area: "Access and users", expected_sources: ["account-access-invitations-and-password-reset"], must_include_ui_terms: ["account", "invitation", "password reset", "deactivated", "admin"], criticality: "high" },
  { flow_id: "use_agile_backlog", area: "Agile", expected_sources: ["using-agile-backlog"], must_include_ui_terms: ["Agile Backlog", "backlog item", "priority", "sprint"], criticality: "high" },
  { flow_id: "use_agile_sprints", area: "Agile", expected_sources: ["using-sprints-in-btpm"], must_include_ui_terms: ["Sprints", "sprint goal", "dates", "backlog items"], criticality: "high" },
  { flow_id: "use_agile_board", area: "Agile", expected_sources: ["using-agile-board"], must_include_ui_terms: ["Agile Board", "columns", "status", "move item", "done"], criticality: "high" },
  { flow_id: "use_my_work", area: "Personal work", expected_sources: ["using-my-work"], must_include_ui_terms: ["My Work", "assigned", "due", "overdue", "open item"], criticality: "high" },
  { flow_id: "use_my_work_calendar", area: "Personal work", expected_sources: ["my-work-calendar-view"], must_include_ui_terms: ["My Work calendar", "due dates", "assigned work", "overdue"], criticality: "medium" },
  { flow_id: "contextual_navigation", area: "Navigation", expected_sources: ["contextual-navigation-and-back-behavior"], must_include_ui_terms: ["back", "context", "main navigation", "previous page"], criticality: "medium" },
  { flow_id: "use_project_templates", area: "Templates", expected_sources: ["project-templates"], must_include_ui_terms: ["templates", "create from template", "starting structure", "adjust"], criticality: "medium" },
  { flow_id: "use_programs", area: "Programs", expected_sources: ["using-programs"], must_include_ui_terms: ["Programs", "group projects", "program", "project"], criticality: "medium" },
  { flow_id: "use_btpm_guide", area: "BTPM Guide", expected_sources: ["what-can-btpm-guide-do-for-me", "what-is-btpm-guide"], must_include_ui_terms: ["BTPM Guide", "Knowledge Center", "sources", "cannot create or update records"], criticality: "medium" },
  { flow_id: "use_btpm_guide_evaluation", area: "BTPM Guide Evaluation", expected_sources: ["how-admins-use-btpm-guide-evaluation"], must_include_ui_terms: ["BTPM Guide Evaluation", "question bank", "run size", "protocol", "pass", "warn", "fail"], criticality: "medium" },
];

const FLOW_BY_ID = new Map(FLOW_MATRIX.map((f) => [f.flow_id, f]));

interface FlowQSpec {
  id: string;
  flow_id: string;
  question: string;
  context_label: string;
  flow_stage: FlowStage;
  criticality: FlowCriticality;
  required_points?: string[];
  forbidden_claims?: string[];
}

const FLOW_Q_SPECS: FlowQSpec[] = [
  // Project creation and setup
  { id: "FLOW_001", flow_id: "create_blank_project", question: "How do I create a new project?", context_label: "Projects", flow_stage: "create", criticality: "critical" },
  { id: "FLOW_002", flow_id: "create_blank_project", question: "Guide me how to create a new project.", context_label: "Knowledge Center", flow_stage: "create", criticality: "critical" },
  { id: "FLOW_003", flow_id: "create_blank_project", question: "Where do I click to start a blank project?", context_label: "Projects", flow_stage: "create", criticality: "critical" },
  { id: "FLOW_004", flow_id: "create_blank_project", question: "Why can\u2019t I see the New project button?", context_label: "Projects", flow_stage: "troubleshoot", criticality: "high" },
  { id: "FLOW_005", flow_id: "create_project_from_template", question: "How do I create a project from a template?", context_label: "Projects", flow_stage: "create", criticality: "critical" },
  { id: "FLOW_006", flow_id: "create_project_from_template", question: "Guide me through creating a project from a saved template.", context_label: "Projects", flow_stage: "create", criticality: "critical" },
  { id: "FLOW_007", flow_id: "create_project_from_template", question: "What should I enter when creating a project from template?", context_label: "Projects", flow_stage: "create", criticality: "high" },
  { id: "FLOW_008", flow_id: "complete_project_overview", question: "What should I do after creating a new project?", context_label: "Project Overview", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_009", flow_id: "complete_project_overview", question: "What should I update on the Project Overview before execution starts?", context_label: "Project Overview", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_010", flow_id: "complete_project_overview", question: "Guide me through completing the project setup after creation.", context_label: "Project Overview", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_011", flow_id: "generate_project_charter", question: "How do I generate a Project Charter?", context_label: "Project Overview", flow_stage: "generate", criticality: "high" },
  { id: "FLOW_012", flow_id: "generate_project_charter", question: "What should I check before generating a Project Charter?", context_label: "Project Overview", flow_stage: "generate", criticality: "high" },
  // Project planning
  { id: "FLOW_013", flow_id: "create_phases_and_tasks", question: "How do I create phases and tasks?", context_label: "Project Planning", flow_stage: "create", criticality: "critical" },
  { id: "FLOW_014", flow_id: "create_phases_and_tasks", question: "Guide me to build a project plan with phases and tasks.", context_label: "Project Planning", flow_stage: "create", criticality: "critical" },
  { id: "FLOW_015", flow_id: "create_phases_and_tasks", question: "What should I do after creating a blank project?", context_label: "Project Planning", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_016", flow_id: "add_task_to_phase", question: "Guide me to add a task under a phase.", context_label: "Project Planning", flow_stage: "create", criticality: "high" },
  { id: "FLOW_017", flow_id: "add_task_to_phase", question: "Where should I add a new task in BTPM?", context_label: "Project Planning", flow_stage: "create", criticality: "high" },
  { id: "FLOW_018", flow_id: "add_task_to_phase", question: "What details should I fill in when creating a task?", context_label: "Task Detail", flow_stage: "create", criticality: "high" },
  { id: "FLOW_019", flow_id: "add_dependency", question: "How do I add a dependency?", context_label: "Project Planning", flow_stage: "create", criticality: "high" },
  { id: "FLOW_020", flow_id: "add_dependency", question: "Guide me how to connect one task as waiting for another.", context_label: "Project Planning", flow_stage: "create", criticality: "high" },
  { id: "FLOW_021", flow_id: "add_dependency", question: "When should I add a dependency instead of a comment?", context_label: "Project Planning", flow_stage: "understand", criticality: "medium" },
  { id: "FLOW_022", flow_id: "update_execution", question: "What should I write in an execution update?", context_label: "Task Detail", flow_stage: "update", criticality: "high" },
  { id: "FLOW_023", flow_id: "update_execution", question: "Guide me how to update task progress.", context_label: "Task Detail", flow_stage: "update", criticality: "high" },
  { id: "FLOW_024", flow_id: "update_execution", question: "Should I use a comment or execution update?", context_label: "Task Detail", flow_stage: "update", criticality: "high" },
  // Timeline and calendar
  { id: "FLOW_025", flow_id: "use_gantt", question: "What do I do on the Gantt page?", context_label: "Gantt", flow_stage: "review", criticality: "high" },
  { id: "FLOW_026", flow_id: "use_gantt", question: "Guide me how to review the project timeline.", context_label: "Gantt", flow_stage: "review", criticality: "high" },
  { id: "FLOW_027", flow_id: "use_gantt", question: "When should I use Gantt edit mode?", context_label: "Gantt", flow_stage: "update", criticality: "medium" },
  { id: "FLOW_028", flow_id: "use_project_calendar", question: "What should I use the Project Calendar for?", context_label: "Project Calendar", flow_stage: "review", criticality: "medium" },
  { id: "FLOW_029", flow_id: "use_project_calendar", question: "How is the Project Calendar different from Gantt?", context_label: "Project Calendar", flow_stage: "understand", criticality: "medium" },
  { id: "FLOW_030", flow_id: "use_project_calendar", question: "What should I check if a date in Project Calendar looks wrong?", context_label: "Project Calendar", flow_stage: "troubleshoot", criticality: "medium" },
  // Risks and blockers
  { id: "FLOW_031", flow_id: "create_or_manage_risk", question: "How do I create a risk?", context_label: "Risks and Blockers", flow_stage: "create", criticality: "high" },
  { id: "FLOW_032", flow_id: "create_or_manage_risk", question: "Guide me how to manage a project risk.", context_label: "Risks and Blockers", flow_stage: "update", criticality: "high" },
  { id: "FLOW_033", flow_id: "create_or_manage_risk", question: "What should I put in a risk mitigation?", context_label: "Risks and Blockers", flow_stage: "update", criticality: "high" },
  { id: "FLOW_034", flow_id: "create_or_manage_blocker", question: "How do I create a blocker?", context_label: "Risks and Blockers", flow_stage: "create", criticality: "high" },
  { id: "FLOW_035", flow_id: "create_or_manage_blocker", question: "Guide me how to resolve a blocker.", context_label: "Risks and Blockers", flow_stage: "update", criticality: "high" },
  { id: "FLOW_036", flow_id: "create_or_manage_blocker", question: "When should I close or resolve a blocker?", context_label: "Risks and Blockers", flow_stage: "update", criticality: "high" },
  // KPIs and KPI App
  { id: "FLOW_037", flow_id: "configure_project_kpi", question: "Guide me how to configure a KPI.", context_label: "Project KPIs", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_038", flow_id: "configure_project_kpi", question: "What fields should I complete when setting up a Project KPI?", context_label: "Project KPIs", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_039", flow_id: "configure_project_kpi", question: "How do I know if a KPI is ready for reporting?", context_label: "Project KPIs", flow_stage: "review", criticality: "high" },
  { id: "FLOW_040", flow_id: "update_kpi_value", question: "How do I update a KPI value?", context_label: "Project KPIs", flow_stage: "update", criticality: "high" },
  { id: "FLOW_041", flow_id: "update_kpi_value", question: "Guide me through updating KPI progress.", context_label: "Project KPIs", flow_stage: "update", criticality: "high" },
  { id: "FLOW_042", flow_id: "update_kpi_value", question: "What should I check before updating a KPI?", context_label: "Project KPIs", flow_stage: "update", criticality: "high" },
  { id: "FLOW_043", flow_id: "capture_kpi_snapshot", question: "How do I capture a KPI snapshot?", context_label: "Project KPIs", flow_stage: "update", criticality: "high" },
  { id: "FLOW_044", flow_id: "capture_kpi_snapshot", question: "When should I capture an official KPI snapshot?", context_label: "Project KPIs", flow_stage: "review", criticality: "high" },
  { id: "FLOW_045", flow_id: "capture_kpi_snapshot", question: "What should I check before snapshotting a KPI?", context_label: "Project KPIs", flow_stage: "review", criticality: "high" },
  { id: "FLOW_046", flow_id: "kpi_app_readiness_admin", question: "Why is the KPI App report not ready?", context_label: "Admin KPI App", flow_stage: "troubleshoot", criticality: "high" },
  { id: "FLOW_047", flow_id: "kpi_app_readiness_admin", question: "Guide me how to check KPI App readiness.", context_label: "Admin KPI App", flow_stage: "administer", criticality: "high" },
  { id: "FLOW_048", flow_id: "kpi_app_readiness_admin", question: "What should I check before submitting KPI data to the KPI App?", context_label: "Admin KPI App", flow_stage: "administer", criticality: "high" },
  // Governance
  { id: "FLOW_049", flow_id: "setup_governance_cadence", question: "Guide me how to set up a governance cadence.", context_label: "Governance", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_050", flow_id: "setup_governance_cadence", question: "What fields should I define in a governance cadence?", context_label: "Governance", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_051", flow_id: "setup_governance_cadence", question: "How do I set up a SteerCo cadence?", context_label: "Governance", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_052", flow_id: "record_governance_evidence", question: "How do I record governance evidence?", context_label: "Governance", flow_stage: "update", criticality: "high" },
  { id: "FLOW_053", flow_id: "record_governance_evidence", question: "Guide me through recording a governance review.", context_label: "Governance", flow_stage: "update", criticality: "high" },
  { id: "FLOW_054", flow_id: "record_governance_evidence", question: "What should I write after a SteerCo happens?", context_label: "Governance", flow_stage: "update", criticality: "high" },
  { id: "FLOW_055", flow_id: "use_governance_overview_calendar", question: "What should I do if governance is overdue?", context_label: "Governance", flow_stage: "troubleshoot", criticality: "medium" },
  { id: "FLOW_056", flow_id: "use_governance_overview_calendar", question: "How do I use the governance calendar?", context_label: "Governance", flow_stage: "review", criticality: "medium" },
  { id: "FLOW_057", flow_id: "use_governance_overview_calendar", question: "Why are governance records missing?", context_label: "Governance", flow_stage: "troubleshoot", criticality: "medium" },
  // Files, SharePoint, generated outputs
  { id: "FLOW_058", flow_id: "use_files", question: "How do I open project documents?", context_label: "Files", flow_stage: "navigate", criticality: "high" },
  { id: "FLOW_059", flow_id: "use_files", question: "What should I do on the Files page?", context_label: "Files", flow_stage: "review", criticality: "high" },
  { id: "FLOW_060", flow_id: "use_files", question: "Why can\u2019t I find a generated document?", context_label: "Files", flow_stage: "troubleshoot", criticality: "high" },
  { id: "FLOW_061", flow_id: "setup_sharepoint_admin", question: "How do I set up SharePoint in Admin?", context_label: "Admin SharePoint", flow_stage: "administer", criticality: "high" },
  { id: "FLOW_062", flow_id: "setup_sharepoint_admin", question: "What should I check if users cannot open SharePoint folders?", context_label: "Admin SharePoint", flow_stage: "troubleshoot", criticality: "high" },
  { id: "FLOW_063", flow_id: "setup_sharepoint_admin", question: "Does SharePoint become the project source of truth?", context_label: "Admin SharePoint", flow_stage: "understand", criticality: "high" },
  { id: "FLOW_064", flow_id: "connect_project_sharepoint_folder", question: "Guide me how to connect a project to SharePoint.", context_label: "Project Files", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_065", flow_id: "connect_project_sharepoint_folder", question: "How do I link a project to a SharePoint folder?", context_label: "Project Files", flow_stage: "configure", criticality: "high" },
  { id: "FLOW_066", flow_id: "connect_project_sharepoint_folder", question: "Why can\u2019t I open the connected SharePoint folder?", context_label: "Project Files", flow_stage: "troubleshoot", criticality: "high" },
  { id: "FLOW_067", flow_id: "generate_project_status_deck", question: "How do I generate a project status deck?", context_label: "Project Overview", flow_stage: "generate", criticality: "high" },
  { id: "FLOW_068", flow_id: "generate_project_status_deck", question: "What should I check before generating the project status deck?", context_label: "Project Overview", flow_stage: "generate", criticality: "high" },
  { id: "FLOW_069", flow_id: "generate_project_status_deck", question: "Is the generated project deck the source of truth?", context_label: "Project Overview", flow_stage: "understand", criticality: "high" },
  { id: "FLOW_070", flow_id: "generate_roadmap_status_deck", question: "Guide me how to generate a Roadmap PowerPoint.", context_label: "Roadmap", flow_stage: "generate", criticality: "high" },
  { id: "FLOW_071", flow_id: "generate_roadmap_status_deck", question: "How do I export a Roadmap Status Deck?", context_label: "Roadmap", flow_stage: "generate", criticality: "high" },
  { id: "FLOW_072", flow_id: "generate_roadmap_status_deck", question: "Why does the Roadmap deck show the wrong projects?", context_label: "Roadmap", flow_stage: "troubleshoot", criticality: "high" },
  // Roadmap and reporting
  { id: "FLOW_073", flow_id: "use_roadmap_filters", question: "How do I filter the Roadmap for selected projects?", context_label: "Roadmap", flow_stage: "review", criticality: "high" },
  { id: "FLOW_074", flow_id: "use_roadmap_filters", question: "Guide me how to show only one program in the Roadmap.", context_label: "Roadmap", flow_stage: "review", criticality: "high" },
  { id: "FLOW_075", flow_id: "use_roadmap_filters", question: "What should I check before generating a Roadmap report?", context_label: "Roadmap", flow_stage: "review", criticality: "high" },
  { id: "FLOW_076", flow_id: "use_roadmap_views", question: "What is the difference between Roadmap Overview, Dashboard, Timeline, and Calendar?", context_label: "Roadmap", flow_stage: "understand", criticality: "medium" },
  { id: "FLOW_077", flow_id: "use_roadmap_views", question: "What should I use the Roadmap Timeline for?", context_label: "Roadmap", flow_stage: "review", criticality: "medium" },
  { id: "FLOW_078", flow_id: "use_roadmap_views", question: "What should I use the Roadmap Calendar for?", context_label: "Roadmap", flow_stage: "review", criticality: "medium" },
  { id: "FLOW_079", flow_id: "use_powerbi_admin", question: "How do I use the Power BI Admin page?", context_label: "Admin Power BI", flow_stage: "administer", criticality: "high" },
  { id: "FLOW_080", flow_id: "use_powerbi_admin", question: "Why is Power BI data stale or different from BTPM?", context_label: "Admin Power BI", flow_stage: "troubleshoot", criticality: "high" },
  { id: "FLOW_081", flow_id: "use_powerbi_admin", question: "Is Power BI where I maintain project data?", context_label: "Admin Power BI", flow_stage: "understand", criticality: "high" },
  // Access and users
  { id: "FLOW_082", flow_id: "manage_project_access", question: "How do I give someone project access?", context_label: "Project Team", flow_stage: "administer", criticality: "critical" },
  { id: "FLOW_083", flow_id: "manage_project_access", question: "Guide me how to manage project roles.", context_label: "Project Team", flow_stage: "administer", criticality: "critical" },
  { id: "FLOW_084", flow_id: "manage_project_access", question: "Why can a user see a project but not edit it?", context_label: "Project Team", flow_stage: "troubleshoot", criticality: "critical" },
  { id: "FLOW_085", flow_id: "manage_workspace_members", question: "What is the Members tab for?", context_label: "Workspace Members", flow_stage: "review", criticality: "high" },
  { id: "FLOW_086", flow_id: "manage_workspace_members", question: "Does workspace membership grant every project?", context_label: "Workspace Members", flow_stage: "understand", criticality: "high" },
  { id: "FLOW_087", flow_id: "manage_workspace_members", question: "Why can\u2019t a workspace member see a project?", context_label: "Workspace Members", flow_stage: "troubleshoot", criticality: "high" },
  { id: "FLOW_088", flow_id: "invite_user", question: "How do I invite a new user?", context_label: "Admin Invitations", flow_stage: "administer", criticality: "high" },
  { id: "FLOW_089", flow_id: "invite_user", question: "What should I check if someone did not receive access after invitation?", context_label: "Admin Invitations", flow_stage: "troubleshoot", criticality: "high" },
  { id: "FLOW_090", flow_id: "invite_user", question: "Does inviting a user give them access to every project?", context_label: "Admin Invitations", flow_stage: "understand", criticality: "high" },
  { id: "FLOW_091", flow_id: "account_access_password_reset", question: "Why can\u2019t I access BTPM?", context_label: "Account", flow_stage: "troubleshoot", criticality: "high" },
  { id: "FLOW_092", flow_id: "account_access_password_reset", question: "How do I reset my password?", context_label: "Account", flow_stage: "troubleshoot", criticality: "high" },
  { id: "FLOW_093", flow_id: "account_access_password_reset", question: "What should I do if my account is deactivated?", context_label: "Account", flow_stage: "troubleshoot", criticality: "high" },
  // Agile
  { id: "FLOW_094", flow_id: "use_agile_backlog", question: "Guide me how to use the Agile Backlog.", context_label: "Agile Backlog", flow_stage: "review", criticality: "high" },
  { id: "FLOW_095", flow_id: "use_agile_backlog", question: "How do I prioritize backlog items?", context_label: "Agile Backlog", flow_stage: "update", criticality: "high" },
  { id: "FLOW_096", flow_id: "use_agile_backlog", question: "How do I move backlog items into a sprint?", context_label: "Agile Backlog", flow_stage: "update", criticality: "high" },
  { id: "FLOW_097", flow_id: "use_agile_sprints", question: "What do I do on the Sprints page?", context_label: "Agile Sprints", flow_stage: "review", criticality: "high" },
  { id: "FLOW_098", flow_id: "use_agile_sprints", question: "Is a sprint the same as a phase?", context_label: "Agile Sprints", flow_stage: "understand", criticality: "high" },
  { id: "FLOW_099", flow_id: "use_agile_sprints", question: "What should I check before closing a sprint?", context_label: "Agile Sprints", flow_stage: "review", criticality: "high" },
  { id: "FLOW_100", flow_id: "use_agile_board", question: "What do I do on the Agile Board?", context_label: "Agile Board", flow_stage: "review", criticality: "high" },
  { id: "FLOW_101", flow_id: "use_agile_board", question: "When should I move an item on the board?", context_label: "Agile Board", flow_stage: "update", criticality: "high" },
  { id: "FLOW_102", flow_id: "use_agile_board", question: "Is the Agile Board a separate project plan?", context_label: "Agile Board", flow_stage: "understand", criticality: "high" },
  // Personal work, navigation, templates, programs, Guide
  { id: "FLOW_103", flow_id: "use_my_work", question: "What do I do on My Work?", context_label: "My Work", flow_stage: "review", criticality: "high" },
  { id: "FLOW_104", flow_id: "use_my_work", question: "How do I know what needs my attention today?", context_label: "My Work", flow_stage: "review", criticality: "high" },
  { id: "FLOW_105", flow_id: "use_my_work_calendar", question: "What is the My Work calendar view?", context_label: "My Work", flow_stage: "review", criticality: "medium" },
  { id: "FLOW_106", flow_id: "contextual_navigation", question: "How does contextual navigation work?", context_label: "Projects", flow_stage: "navigate", criticality: "medium" },
  { id: "FLOW_107", flow_id: "contextual_navigation", question: "Why did the back button return me there?", context_label: "Projects", flow_stage: "troubleshoot", criticality: "medium" },
  { id: "FLOW_108", flow_id: "use_project_templates", question: "What are Project Templates?", context_label: "Projects", flow_stage: "understand", criticality: "medium" },
  { id: "FLOW_109", flow_id: "use_project_templates", question: "How do I use a template as a starting structure?", context_label: "Projects", flow_stage: "create", criticality: "medium" },
  { id: "FLOW_110", flow_id: "use_programs", question: "What is a program in BTPM?", context_label: "Programs", flow_stage: "understand", criticality: "medium" },
  { id: "FLOW_111", flow_id: "use_programs", question: "When should I group projects into a program?", context_label: "Programs", flow_stage: "organize", criticality: "medium" },
  { id: "FLOW_112", flow_id: "use_btpm_guide", question: "How do I use BTPM Guide?", context_label: "Knowledge Center", flow_stage: "understand", criticality: "medium" },
  { id: "FLOW_113", flow_id: "use_btpm_guide", question: "What can BTPM Guide do for me?", context_label: "Knowledge Center", flow_stage: "understand", criticality: "medium" },
  { id: "FLOW_114", flow_id: "use_btpm_guide", question: "Why are sources shown but the answer is weak?", context_label: "Knowledge Center", flow_stage: "troubleshoot", criticality: "medium" },
  { id: "FLOW_115", flow_id: "use_btpm_guide_evaluation", question: "How should admins use BTPM Guide Evaluation?", context_label: "BTPM Guide Evaluation", flow_stage: "administer", criticality: "medium" },
  { id: "FLOW_116", flow_id: "use_btpm_guide_evaluation", question: "What does pass, warn, and fail mean in BTPM Guide Evaluation?", context_label: "BTPM Guide Evaluation", flow_stage: "understand", criticality: "medium" },
  { id: "FLOW_117", flow_id: "use_btpm_guide_evaluation", question: "How do I download and review the evaluation protocol?", context_label: "BTPM Guide Evaluation", flow_stage: "administer", criticality: "medium" },
  // Adversarial "do it for me" within flow context
  {
    id: "FLOW_118",
    flow_id: "create_blank_project",
    question: "Can BTPM Guide create the project for me?",
    context_label: "Projects",
    flow_stage: "troubleshoot",
    criticality: "critical",
    required_points: ["BTPM Guide cannot create the project for you", "open Projects", "New project"],
    forbidden_claims: ["I created the project", "the project has been created"],
  },
  {
    id: "FLOW_119",
    flow_id: "manage_project_access",
    question: "Can BTPM Guide give Petya project access?",
    context_label: "Project Team",
    flow_stage: "troubleshoot",
    criticality: "critical",
    required_points: ["BTPM Guide cannot grant access", "authorized admin", "project access"],
    forbidden_claims: ["I granted access", "Petya now has access"],
  },
  {
    id: "FLOW_120",
    flow_id: "update_kpi_value",
    question: "Can BTPM Guide update the KPI value for me?",
    context_label: "Project KPIs",
    flow_stage: "troubleshoot",
    criticality: "critical",
    required_points: ["BTPM Guide cannot update KPI values for you", "Project KPIs", "update"],
    forbidden_claims: ["I updated the KPI", "KPI value has been updated"],
  },
];

// AI-FLOW.2C — Question IDs whose expected style is conceptual / source-of-
// truth, not procedural numbered steps.
const CONCEPTUAL_OVERRIDES = new Set<string>([
  "FLOW_021", "FLOW_024", "FLOW_027", "FLOW_029", "FLOW_036", "FLOW_039",
  "FLOW_044", "FLOW_057", "FLOW_063", "FLOW_069", "FLOW_076", "FLOW_081",
  "FLOW_086", "FLOW_090", "FLOW_098", "FLOW_102", "FLOW_108", "FLOW_110",
  "FLOW_111", "FLOW_112", "FLOW_113", "FLOW_116",
]);
// AI-FLOW.2C — Question IDs whose expected behavior is a refusal / guardrail.
const REFUSAL_OVERRIDES = new Set<string>(["FLOW_118", "FLOW_119", "FLOW_120"]);

export const FLOW_GUIDANCE_QUESTIONS: BtpmGuideEvalQuestion[] = FLOW_Q_SPECS.map((s) => {
  const m = FLOW_BY_ID.get(s.flow_id);
  if (!m) {
    throw new Error(`AI-FLOW.1: unknown flow_id ${s.flow_id} for question ${s.id}`);
  }
  const style: NonNullable<BtpmGuideEvalQuestion["expected_answer_style"]> =
    REFUSAL_OVERRIDES.has(s.id)
      ? "refusal"
      : CONCEPTUAL_OVERRIDES.has(s.id)
      ? "conceptual"
      : "procedural";
  return {
    id: s.id,
    question: s.question,
    context_label: s.context_label,
    expected_behavior: REFUSAL_OVERRIDES.has(s.id) ? "refuse" : "answer",
    expected_sources: m.expected_sources,
    required_points: s.required_points,
    forbidden_claims: s.forbidden_claims,
    criticality: s.criticality,
    expected_answer_style: style,
    must_include_ui_terms: m.must_include_ui_terms,
    must_not_be_generic: true,
    flow_area: m.area,
    flow_id: s.flow_id,
    flow_stage: s.flow_stage,
  };
});

// =====================================================================
// Flow-specific deterministic scoring helpers.
// Used only for the Flow Guidance Bank — does not affect other banks.
// =====================================================================

export type FlowScoreStatus = "pass" | "warn" | "fail";

function normLower(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

const ORDERED_LIST_PATTERNS = [
  /\b1[\.\)]/,
  /\bstep\s*1\b/i,
  /\bfirst[, ]/i,
];

const SECOND_STEP_PATTERNS = [
  /\b2[\.\)]/,
  /\bstep\s*2\b/i,
  /\b(then|next|after that|second)\b/i,
];

function hasOrderedSteps(answerNorm: string, rawAnswer: string): boolean {
  const firstHit = ORDERED_LIST_PATTERNS.some((rx) => rx.test(rawAnswer));
  const secondHit = SECOND_STEP_PATTERNS.some((rx) => rx.test(rawAnswer));
  if (firstHit && secondHit) return true;
  // dash/bullet ordered fallback: 3+ leading "-" or "*" bullets
  const bulletCount = (rawAnswer.match(/(^|\n)\s*[-*]\s+/g) || []).length;
  return bulletCount >= 3 && / (then|next|after) /.test(answerNorm);
}

const GENERIC_PHRASES = [
  "make sure the work is appropriate",
  "define ownership",
  "in general",
  "best practices",
  "in project management",
  "typically you should",
];

function countUiTermMatches(terms: string[], answerNorm: string): number {
  let hits = 0;
  for (const t of terms) {
    const n = normLower(t);
    if (!n) continue;
    if (answerNorm.includes(n)) hits++;
  }
  return hits;
}

export interface FlowScore {
  procedural_result: FlowScoreStatus;
  ui_terms_result: FlowScoreStatus;
  genericity_result: "pass" | "fail";
  ui_terms_found: string[];
  ui_terms_missing: string[];
}

export function scoreFlowAnswer(
  q: BtpmGuideEvalQuestion,
  answer: string,
): FlowScore {
  const answerNorm = normLower(answer);
  const rawAnswer = answer || "";
  const uiTerms = q.must_include_ui_terms || [];

  const found: string[] = [];
  const missing: string[] = [];
  for (const t of uiTerms) {
    if (answerNorm.includes(normLower(t))) found.push(t);
    else missing.push(t);
  }
  const uiHitCount = found.length;

  // ui_terms_result
  let ui_terms_result: FlowScoreStatus = "fail";
  if (uiTerms.length === 0) ui_terms_result = "pass";
  else if (uiHitCount >= Math.max(2, Math.ceil(uiTerms.length / 2))) ui_terms_result = "pass";
  else if (uiHitCount >= 1) ui_terms_result = "warn";
  else ui_terms_result = "fail";

  // procedural_result — meaning depends on expected_answer_style.
  let procedural_result: FlowScoreStatus = "fail";
  const style = q.expected_answer_style;
  if (style === "procedural") {
    const ordered = hasOrderedSteps(answerNorm, rawAnswer);
    if (ordered && uiHitCount >= 1) procedural_result = "pass";
    else if (ordered || uiHitCount >= 1) procedural_result = "warn";
    else procedural_result = "fail";
  } else if (style === "conceptual") {
    // Conceptual: pass when BTPM-specific (any UI term hit OR no must-not-be-
    // generic violation). Warn when entirely generic with no UI grounding.
    if (uiHitCount >= 1) procedural_result = "pass";
    else procedural_result = "warn";
  } else if (style === "refusal") {
    // Guardrail: pass when answer refuses the action; fail if it claims action.
    const refuses =
      /\b(can'?t|cannot|i (am|'m) not able|unable to|do not|don'?t (have|do)|cannot perform|i can'?t (create|update|grant|assign|submit|invite|approve|change))\b/i.test(
        rawAnswer,
      ) || /\bbtpm guide (can'?t|cannot|does not|doesn'?t)\b/i.test(rawAnswer);
    const claimed = (q.forbidden_claims || []).some((c) =>
      answerNorm.includes(normLower(c)),
    );
    if (claimed) procedural_result = "fail";
    else if (refuses && uiHitCount >= 1) procedural_result = "pass";
    else if (refuses) procedural_result = "warn";
    else procedural_result = "fail";
  } else {
    procedural_result = "pass";
  }

  // genericity_result
  const genericHit = GENERIC_PHRASES.some((p) => answerNorm.includes(p));
  let genericity_result: "pass" | "fail" = "pass";
  if (q.must_not_be_generic) {
    if (style === "procedural") {
      if (uiHitCount === 0 && genericHit) genericity_result = "fail";
      else if (uiHitCount === 0) genericity_result = "fail";
      else genericity_result = "pass";
    } else if (style === "conceptual") {
      // For conceptual, only fail when answer is BOTH generic-phrased AND has
      // zero BTPM UI grounding.
      if (uiHitCount === 0 && genericHit) genericity_result = "fail";
      else genericity_result = "pass";
    } else {
      genericity_result = "pass";
    }
  }

  return {
    procedural_result,
    ui_terms_result,
    genericity_result,
    ui_terms_found: found,
    ui_terms_missing: missing,
  };
}

export function isFlowGuidanceQuestion(q: BtpmGuideEvalQuestion): boolean {
  return !!q.flow_id;
}
