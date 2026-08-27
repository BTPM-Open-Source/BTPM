/**
 * KC.4 — Curated short-form concept copy + stable Knowledge slugs used by
 * ConceptHelp tooltips and KnowledgeLink "Learn more" links across BTPM
 * operational surfaces.
 *
 * Short text is local on purpose: tooltips never trigger network fetches,
 * and the canonical full text remains in the Knowledge article body.
 */

export const KC_SLUGS = {
  whatIsBtpm: "what-is-btpm",
  understandingStructure: "understanding-btpm-structure",
  classificationRulebook: "program-project-phase-task-rulebook",
  taskTypes: "task-types-rulebook",
  dependenciesRulebook: "dependencies-rulebook",
  riskVsBlocker: "risk-vs-blocker-rulebook",
  commentVsExecutionUpdate: "comment-vs-execution-update-rulebook",
  kpiDefinitions: "kpi-definitions-and-updates",
  howToCreateProject: "how-to-create-a-project",
  howToCreatePhasesAndTasks: "how-to-create-phases-and-tasks",
  howToAddDependency: "how-to-add-a-dependency",
  howToUpdateExecution: "how-to-update-execution",
  howToUseGantt: "how-to-use-gantt",
  howToManageRisksAndBlockers: "how-to-manage-risks-and-blockers",
  howToUpdateKpis: "how-to-update-kpis",
  rolesAndPermissions: "roles-and-permissions",
  workspaceAccess: "workspace-access",
  healthScheduleSignal: "health-rag-schedule-signal",
  roadmapAndGantt: "roadmap-and-gantt",
  traceability: "traceability-and-activity-history",
  sharepointPlaceholder: "sharepoint-file-management-placeholder",
  powerBiPlaceholder: "power-bi-access-placeholder",
  kpiPowerAppPlaceholder: "kpi-powerapp-bridge-placeholder",
  governanceTraceability: "project-governance-traceability",
  governanceCadenceVsRecord: "governance-cadence-vs-record",
  howToSetUpGovernanceCadence: "how-to-set-up-governance-cadence",
  howToRecordGovernanceEvidence: "how-to-record-governance-evidence",
  governanceOverviewCalendar: "governance-overview-and-calendar",
  governancePowerBiReadiness: "governance-reporting-power-bi-readiness",
  faqGovernanceScheduler: "faq-is-governance-traceability-a-meeting-scheduler",
  btpmKpiEngine: "btpm-kpi-engine",
  manualVsAutomaticKpis: "manual-vs-automatic-kpis",
  kpiSnapshotsVsUpdates: "official-kpi-snapshots-vs-manual-update-history",
  kpiReadinessStatuses: "kpi-readiness-statuses",
  howToConfigureProjectKpis: "how-to-configure-project-kpis",
  howToCaptureKpiSnapshots: "how-to-capture-kpi-snapshots",
  kpiDashboardConsumption: "kpi-dashboard-and-reporting-consumption",
  automaticKpiFormulas: "automatic-kpi-library-and-formulas",
} as const;

export const KC_CONCEPTS = {
  classification: {
    term: "Program → Project → Phase → Task",
    shortText:
      "BTPM uses a fixed hierarchy. Programs group projects; projects own phases; phases own tasks. Pick the right level — don't model phases as tasks.",
    slug: KC_SLUGS.classificationRulebook,
  },
  taskTypes: {
    term: "Task types",
    shortText:
      "Task type tags the kind of work (e.g. milestone, deliverable). It clarifies intent — it does not change scheduling.",
    slug: KC_SLUGS.taskTypes,
  },
  dependency: {
    term: "Dependency",
    shortText:
      "A dependency is a real Finish-to-Start sequencing constraint between same-level items — not a visual association.",
    slug: KC_SLUGS.dependenciesRulebook,
  },
  riskVsBlocker: {
    term: "Risk vs Blocker",
    shortText:
      "Risk = something that may happen and harm the work. Blocker = something that is already preventing progress now.",
    slug: KC_SLUGS.riskVsBlocker,
  },
  commentVsExecutionUpdate: {
    term: "Comment vs Execution Update",
    shortText:
      "Comments are free conversation. Execution updates are dated status entries that drive reporting — keep them separate.",
    slug: KC_SLUGS.commentVsExecutionUpdate,
  },
  kpi: {
    term: "KPIs",
    shortText:
      "KPIs can be manual or automatic. BTPM captures official KPI snapshots for reporting while keeping manual update history separate.",
    slug: KC_SLUGS.btpmKpiEngine,
  },
  gantt: {
    term: "Gantt",
    shortText:
      "Gantt is one surface with view and edit modes — never a separate planning truth. Source data stays canonical.",
    slug: KC_SLUGS.howToUseGantt,
  },
  roadmap: {
    term: "Roadmap",
    shortText:
      "Cross-project sequencing and priority overview. Health (RAG) and Schedule signals are derived from canonical data.",
    slug: KC_SLUGS.roadmapAndGantt,
  },
  healthSchedule: {
    term: "Health (RAG) & Schedule signal",
    shortText:
      "Derived signals from canonical reporting. Health summarises overall risk; schedule shows on-track vs behind.",
    slug: KC_SLUGS.healthScheduleSignal,
  },
  rolesAndPermissions: {
    term: "Roles & permissions",
    shortText:
      "Org admins and workspace roles control who can plan, edit, and administer. Server-enforced — UI hiding is not the gate.",
    slug: KC_SLUGS.rolesAndPermissions,
  },
  workspaceAccess: {
    term: "Workspace access",
    shortText:
      "Workspace membership controls visibility into projects in that workspace. Add or remove members from this page.",
    slug: KC_SLUGS.workspaceAccess,
  },
  governanceTraceability: {
    term: "Governance Traceability",
    shortText:
      "Tracks expected project governance cadence against actual governance evidence. It proves governance happened; it does not schedule meetings.",
    slug: KC_SLUGS.governanceTraceability,
  },
  governanceCadence: {
    term: "Governance Cadence",
    shortText:
      "A planned project governance expectation, such as SteerCo every two weeks. It is not a meeting invite.",
    slug: KC_SLUGS.governanceCadenceVsRecord,
  },
  governanceRecord: {
    term: "Governance Record",
    shortText:
      "Evidence that governance happened, including actual date, summary, decisions, linked objects, and evidence reference.",
    slug: KC_SLUGS.governanceCadenceVsRecord,
  },
} as const;

export type KcConceptKey = keyof typeof KC_CONCEPTS;
