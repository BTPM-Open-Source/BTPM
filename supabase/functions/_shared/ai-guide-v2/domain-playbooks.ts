// AI-GUIDE.V2-ARCH.1B-REFINE — Domain playbooks (planner-side).
//
// Structured obligations per BTPM domain_situation. These are NOT final
// answers and NOT prose templates. The planner consumes a playbook to build
// must_say / must_not_say / opening / safe_navigation for the renderer.
//
// Hard rules:
//   - No final user-facing prose lives here. Strings here are planner
//     instructions and short, situation-grounded sentences the renderer may
//     paraphrase. There is no per-question routing logic here.
//   - No keyword regex / question matching. Only situation-keyed entries.

import type { BtpmDomainSituation } from "./domain-ontology.ts";

export interface DomainPlaybook {
  /** Short, situation-grounded opening the planner may use as a starter. */
  opening?: string;
  /** Sentences/obligations that MUST be present in the rendered answer. */
  required_must_say: string[];
  /** Sentences/claims that MUST NOT appear. */
  forbidden_must_not_say: string[];
  /** Plain-English navigation labels (never raw routes). */
  safe_navigation?: string;
}

const PLAYBOOKS: Partial<Record<BtpmDomainSituation, DomainPlaybook>> = {
  blocked_work: {
    opening:
      "In BTPM, treat something that is already preventing the task from moving forward as a blocker, not a risk and not a dependency.",
    required_must_say: [
      "If something is already preventing the task from moving forward, treat it as a blocker in BTPM.",
      "A risk is for something that might happen later; a blocker is for something already preventing progress now.",
      "A dependency only expresses that one BTPM item must wait for another BTPM item; it is not the solution to an external delay.",
      "Record the blocker on the task or in the Risks & Blockers area: capture what is blocking the work, who or what you are waiting for, and what action, decision, owner, or next step is needed to unblock it.",
      "If the task status or progress is affected, update the task or add a dated execution update so the team has visibility, at a safe high level.",
      "Use the wording 'Risks & Blockers area' (or 'the task or Risks & Blockers area'). Do not use 'Risks-blockers section'.",
    ],
    forbidden_must_not_say: [
      "Do not say a blocker was created on the user's behalf.",
      "Do not invent exact button names or page labels that are not verified.",
      "Do not list live blockers from the user's project.",
      "Do not call something a dependency unless it sequences two BTPM items.",
      "Do not write 'Risks-blockers section'.",
      "Do not give a generic 'open the Risks-blockers section' answer; explain what to record and update.",
    ],
    safe_navigation: "the task or the Risks & Blockers area",
  },
  future_risk: {
    opening:
      "In BTPM, a possible future issue is tracked as a risk rather than a blocker.",
    required_must_say: [
      "A vendor or external delay that might affect a future date is a risk, not a blocker, unless it is already preventing current work.",
      "Record the risk in BTPM with what could happen, when, and how it would impact the plan.",
      "If the issue starts blocking current work, convert it into a blocker on the affected task.",
    ],
    forbidden_must_not_say: [
      "Do not treat a potential future issue only as a blocker.",
      "Do not invent exact click-by-click steps unless a verified workflow is attached.",
    ],
  },
  dependency_sequencing: {
    opening:
      "In BTPM, sequencing one item to run only after another is expressed as a dependency.",
    required_must_say: [
      "A dependency expresses that one BTPM item must wait for another BTPM item.",
      "Use a blocker only if the work is already prevented from moving forward.",
    ],
    forbidden_must_not_say: [
      "Do not say dependencies can be created from the Gantt view.",
      "Do not invent cross-level dependencies that are not supported.",
    ],
  },
  sharepoint_boundary: {
    required_must_say: [
      "Generated or exported documents in SharePoint are outputs; editing the SharePoint file does not update BTPM unless a governed sync exists.",
      "BTPM remains the source of truth for project data.",
    ],
    forbidden_must_not_say: [
      "Do not imply edits in SharePoint automatically flow back into BTPM.",
    ],
  },
  generated_document_boundary: {
    required_must_say: [
      "Generated documents (status decks, charters) are outputs derived from BTPM data; editing the generated file does not change BTPM.",
      "Update the underlying BTPM records to change the next generated output.",
    ],
    forbidden_must_not_say: [
      "Do not imply changes to the exported document flow back into BTPM.",
    ],
  },
  powerbi_reporting_boundary: {
    required_must_say: [
      "Power BI surfaces KPI snapshots; the source of truth for KPI definitions and updates is BTPM.",
    ],
    forbidden_must_not_say: [],
  },
  page_purpose_guidance: {
    required_must_say: [
      "Identify the BTPM area that fits the user's description based on the Knowledge Center, and say it clearly if it is verified (typically the Roadmap or a project's Overview/Dashboard view).",
      "Explain that the page is for visibility and understanding; to change underlying values, open the specific project area, not the summary view, unless a verified flow says otherwise.",
      "If the exact label is not verified in the Knowledge Center, acknowledge the uncertainty instead of inventing a name.",
    ],
    forbidden_must_not_say: [
      "Do not invent exact screen names or tile labels that are not verified.",
      "Do not overrule a specific concept article with a generic page label.",
    ],
  },
  task_completion_approval_boundary: {
    opening:
      "In BTPM, task completion is tracked through status and execution updates rather than a separate built-in approval workflow.",
    required_must_say: [
      "I do not have verified guidance that BTPM has a separate, built-in approval flow specifically for task completion.",
      "BTPM tracks task status and progress (for example through the task's status, execution updates, and comments), which is not the same as a formal approval.",
      "If your organization needs a formal sign-off, that is usually a governance or RACI convention configured by your team, not a built-in BTPM action.",
      "Ask a Workspace Admin or check the Knowledge Center if your team has documented a local approval process for task completion.",
    ],
    forbidden_must_not_say: [
      "Do not claim BTPM has a built-in task-completion approval workflow.",
      "Do not present KPI submission, KPI approval, or status-deck generation as a task-completion approval.",
      "Do not invent an approval button, approve action, or sign-off control on the task.",
      "Do not say the assistant approved or completed the task.",
    ],
  },

  // AI-GUIDE.V2-ARCH.1C — predecessor/prior-task blocked work.
  predecessor_or_dependency_blocked_work: {
    opening:
      "In BTPM, when a task cannot proceed because a related earlier task is not finished, the most likely cause is that the two tasks are sequenced as a dependency.",
    required_must_say: [
      "A likely reason is that the current task depends on a previous (predecessor) task that must finish first; in BTPM that sequencing is expressed as a dependency between two BTPM items.",
      "Other safe reasons to consider: the previous task's status or progress may not yet be updated to complete; there may be a real blocker recorded on the current task; or you may not have permission to complete or update the task.",
      "If a sequencing relationship is intended, model it as a dependency between the BTPM items, not as a workaround.",
      "If the obstacle is not just sequence (something is actively preventing progress), record it as a blocker on the current task.",
      "If the obstacle affects status or progress, update the task or add a dated execution update so the team has visibility.",
    ],
    forbidden_must_not_say: [
      "Do not say a dependency is always the reason without considering blockers, missing updates, or permissions.",
      "Do not say dependencies can be created from the Gantt view.",
      "Do not claim cross-level dependencies are supported.",
      "Do not say the assistant completed the task or created the dependency.",
      "Do not invent exact button names that are not verified.",
    ],
    safe_navigation: "the task detail page or the project planning area",
  },

  // AI-GUIDE.V2-ARCH.1C — progress / contribution reporting.
  progress_or_contribution_reporting: {
    opening:
      "In BTPM, work that contributes to a project is reported against the work item where it belongs, not in a separate generic feedback channel.",
    required_must_say: [
      "Report the contribution against the work item it belongs to (typically the task, phase, or project area you were working on).",
      "Use a dated execution update when the contribution changes progress, status, or schedule and you want the team to see it on the timeline.",
      "Use a comment for discussion, context, or clarification that is not itself a progress change.",
      "If the contribution changes execution state, also update the task's status or progress so reporting stays accurate.",
      "Only update a KPI when the contribution actually changes a KPI value; do not report generic progress as a KPI update.",
    ],
    forbidden_must_not_say: [
      "Do not route generic project contribution reporting to BTPM Guide or admin-evaluation articles.",
      "Do not assume the contribution is a KPI update unless the user mentioned a KPI or metric.",
      "Do not assume it is governance evidence unless the user mentioned a meeting, decision, or governance event.",
      "Do not claim the assistant reported the update for the user.",
      "Do not invent exact button names that are not verified.",
    ],
    safe_navigation: "the task detail page or the project planning area",
  },

  // AI-GUIDE.V2-ARCH.1C — governance event reporting (SteerCo / reviews).
  governance_event_reporting: {
    opening:
      "In BTPM, a planned governance event such as a SteerCo is reported by recording governance evidence about what actually happened, separate from the cadence that scheduled it.",
    required_must_say: [
      "If the SteerCo (or other governance event) actually happened, record it as governance evidence (a governance record) on the project.",
      "Capture the event type and date, the topic or purpose, the key decisions or outcomes, and the follow-up actions with their owners.",
      "Attach or link supporting evidence (notes, status deck, minutes) when available.",
      "A governance cadence expresses the expectation that the event will happen; the governance record is the evidence that it did happen.",
      "If the meeting was planned but did not happen, update the cadence/expectation instead of recording evidence that it happened.",
    ],
    forbidden_must_not_say: [
      "Do not say BTPM schedules the meeting.",
      "Do not say BTPM reads Outlook, Teams, or the calendar to know the meeting happened, unless a verified integration is documented.",
      "Do not claim the assistant created the governance record.",
      "Do not invent exact button names that are not verified.",
      "Do not treat a planned cadence as proof that the meeting happened.",
    ],
    safe_navigation: "the project governance area",
  },

  // ===========================================================================
  // AI-GUIDE.V2-QA.3 — Domain-boundary playbooks.
  // ===========================================================================

  btpm_core_concept: {
    opening:
      "BTPM is a project management and governance application for business transformation work, structured as Organization > Workspace > Program > Project > Phase > Task.",
    required_must_say: [
      "BTPM is the source of truth for project structure, planning, execution updates, governance, and KPI definitions/updates.",
      "BTPM is complementary to SharePoint (which stores generated documents and files) and Power BI (which surfaces downstream reporting and KPI snapshots); it does not replace them.",
      "BTPM does not replace every business tool and is not a chat, email, or document co-authoring platform.",
    ],
    forbidden_must_not_say: [
      "Do not claim BTPM replaces SharePoint, Power BI, Outlook, Teams, or every business tool.",
      "Do not claim Power BI or SharePoint is the live project record.",
      "Do not claim BTPM automatically manages meetings or communications.",
      "Do not imply BTPM Guide can read live operational data.",
    ],
  },

  btpm_guide_capability_boundary: {
    opening:
      "BTPM Guide is the in-product help assistant; it answers from the Knowledge Center and does not read live project data.",
    required_must_say: [
      "BTPM Guide answers from the Knowledge Center; it does not read your actual project records, risks, blockers, KPIs, SharePoint files, Power BI reports, or user data.",
      "If the Knowledge Center does not have enough information, the Guide will say so rather than guess.",
      "To see live project information, open the relevant BTPM area directly (project, risks & blockers, KPIs, governance).",
    ],
    forbidden_must_not_say: [
      "Do not claim BTPM Guide can read live project risks, blockers, KPIs, SharePoint files, Power BI reports, or user records.",
      "Do not expose internal pipeline names (classifier, retriever, embeddings, validator) in normal answers.",
      "Do not route normal capability questions to admin evaluation articles unless the user is asking about admin evaluation.",
    ],
    safe_navigation: "the BTPM area for the data you want to see",
  },

  kpi_concept: {
    required_must_say: [
      "BTPM distinguishes KPI definitions (what is measured), KPI updates (entered values over time), and KPI snapshots (the officially captured point-in-time value used by reporting).",
      "Some KPIs are calculated automatically by the BTPM KPI engine; others are entered manually.",
    ],
    forbidden_must_not_say: [
      "Do not say KPI updates and KPI snapshots are the same thing.",
      "Do not invent KPI formulas that are not in the Knowledge Center.",
    ],
  },

  kpi_app_integration_concept: {
    required_must_say: [
      "The KPI App is a separate integration that consumes BTPM KPI snapshots and applies the KPI Automation Protocol.",
      "BTPM remains the source of truth for KPI definitions and updates; the KPI App is downstream submission/reporting.",
      "KPI readiness statuses indicate whether a submission is eligible to proceed.",
    ],
    forbidden_must_not_say: [
      "Do not treat the KPI App as live operational project data reading.",
      "Do not claim arbitrary dashboard numbers are submitted to the KPI App.",
      "Do not say BTPM auto-approves KPI submissions unless the Knowledge Center explicitly says so.",
    ],
  },

  kpi_submission_approval_boundary: {
    opening:
      "BTPM does not automatically approve KPI submissions; KPI App submissions follow the KPI Automation Protocol and readiness rules.",
    required_must_say: [
      "I do not have verified guidance that BTPM automatically approves KPI submissions on the user's behalf.",
      "KPI submissions go through the KPI App and are governed by the KPI Automation Protocol and KPI readiness statuses.",
      "This is different from task-completion approval, which is a separate concept.",
    ],
    forbidden_must_not_say: [
      "Do not say BTPM automatically approves KPI submissions.",
      "Do not present KPI submission approval as task-completion approval.",
      "Do not claim the assistant submitted or approved a KPI.",
    ],
  },

  kpi_snapshot_concept: {
    required_must_say: [
      "An official KPI snapshot is the point-in-time KPI value captured by BTPM for governed reporting.",
      "Manual KPI update history records value changes over time; snapshots are the officially captured values used downstream.",
    ],
    forbidden_must_not_say: [
      "Do not claim manual updates and official snapshots are the same record.",
      "Do not claim the assistant captured a snapshot for the user.",
    ],
  },

  powerbi_admin_usage: {
    required_must_say: [
      "The Power BI Admin page is used by admins to check Power BI connection, provisioning, sync status, and reporting readiness for BTPM data.",
      "It does not change BTPM project data; BTPM remains the source of truth.",
      "Only users with the appropriate admin permission can configure Power BI.",
    ],
    forbidden_must_not_say: [
      "Do not say any user can configure Power BI.",
      "Do not say Power BI Admin edits update project data in BTPM.",
    ],
  },

  powerbi_staleness_or_sync_issue: {
    required_must_say: [
      "If Power BI looks stale or different from BTPM, the underlying cause is usually sync timing, readiness, or snapshot capture state — not that Power BI is the source of truth.",
      "Check that recent BTPM updates were captured (snapshots, execution updates) and that the Power BI sync/refresh has completed.",
      "BTPM remains the governed source of truth; Power BI reflects what has been pushed to it.",
    ],
    forbidden_must_not_say: [
      "Do not say Power BI sync fixes missing or wrong BTPM data.",
      "Do not say Power BI is the live project record.",
    ],
  },

  generated_document_source_of_truth_boundary: {
    required_must_say: [
      "The Weekly Project Status Deck is a generated output derived from BTPM data; it is not the source of truth.",
      "Editing the generated deck does not update BTPM; update the underlying BTPM records to change the next generated deck.",
      "Before generating the deck, check that the relevant BTPM data (status, KPIs, governance evidence, risks/blockers) is current.",
    ],
    forbidden_must_not_say: [
      "Do not say the status deck is the source of truth.",
      "Do not say editing the deck updates BTPM.",
      "Do not claim the assistant generated the deck.",
    ],
  },

  // ===========================================================================
  // AI-GUIDE.V2-HUMANQA.2 — Guide-intent + page/object guidance playbooks.
  // These give the renderer object-area mapping for guidance answers without
  // inventing buttons or reading live state. Each line is a planner
  // obligation, paraphrasable by the renderer.
  // ===========================================================================

  guide_or_navigation_reporting_intent: {
    opening:
      "In BTPM, each thing you want to see, report, or update lives on a specific BTPM record.",
    required_must_say: [
      "Map the user's intent to the BTPM area that owns it: project goals/scope => Project Overview; task work and add/create tasks => Project Planning page (then Task detail); task progress => Task detail with an execution update; phase progress => Phase detail with an execution update; risks and blockers => the Risks & Blockers area (or on the task); governance notes, evidence, decisions => Project Governance (as a governance record); generated decks/exports => the Files / generated documents area; what is late or the timeline => Project Gantt, Roadmap, or the Timeline view.",
      "Explain what that area is for; explain what it is NOT for if there is a common confusion (for example: Roadmap shows portfolio/project visibility but is not where you maintain tasks; My Work is a personal assigned-work view).",
      "If the user asked 'what should I update' for status, point to the appropriate BTPM record (task/phase/project status or a dated execution update) rather than to a generic note.",
    ],
    forbidden_must_not_say: [
      "Do not list or summarise actual current records (risks, blockers, tasks, KPIs).",
      "Do not invent exact button or tile labels that are not in the Knowledge Center.",
      "Do not send users to Roadmap to add or maintain tasks.",
      "Do not send users to Roadmap to add notes or governance evidence.",
      "Do not claim the assistant read live SharePoint files, Power BI reports, or project data.",
      "Do not begin with 'BTPM Guide can point you ...' or any self-referential preamble; answer the user's question directly.",
    ],
    safe_navigation: "the BTPM area that owns the object you want to see or update",
  },

  comment_or_execution_update_guidance: {
    opening:
      "In BTPM, a dated execution update is for progress/history/status, and a comment is for discussion/context. Notes do not go on the Roadmap.",
    required_must_say: [
      "Use a dated execution update when the entry should become part of the project's progress, history, or status (what changed, when, impact).",
      "Use a comment when the entry is discussion, context, or a question that is not itself a progress change.",
      "If the actual execution state changed, also update the task/phase/project status or progress so reporting stays accurate.",
      "Both go on the relevant BTPM record (task, phase, or project area) — not on the Roadmap.",
    ],
    forbidden_must_not_say: [
      "Do not route the user to Roadmap to add notes or updates.",
      "Do not treat 'project history' as a live-data lookup — explain it is the dated execution update / activity history surface.",
      "Do not claim the assistant added a comment or execution update for the user.",
    ],
    safe_navigation: "the task, phase, or project area for the work you are reporting on",
  },

  work_structure_modelling_guidance: {
    opening:
      "BTPM models work as Organization > Workspace > Program > Project > Phase > Task. Use those levels to keep work structured instead of forcing everything into one level.",
    required_must_say: [
      "A program groups related projects; a project is one delivery stream; a phase is a major stage within a project; a task is an executable work item inside a phase.",
      "Multiple parallel streams under one transformation are usually modelled as multiple projects under a program (or as phases within one project if they are tightly coupled stages, not parallel streams).",
      "A very large phase (for example a single 'Implementation' phase) is usually a sign it should be split into smaller phases with their own tasks.",
      "Too many flat tasks usually means they should be regrouped under phases (and possibly split between projects).",
      "When setting up work, it is normally easier to first define the structure (project, phases, tasks), then assign owners and add dates and dependencies.",
    ],
    forbidden_must_not_say: [
      "Do not invent custom hierarchy levels that BTPM does not support.",
      "Do not say tasks live directly on the Roadmap.",
      "Do not invent exact button names that are not verified.",
      "Do not claim the assistant restructured the work for the user.",
    ],
    safe_navigation: "the Project Planning page and the project's phase/task structure",
  },

  external_plan_source_boundary: {
    opening:
      "BTPM is the governed project record. External files (Excel, PowerPoint, SharePoint) can support communication or evidence, but they are not the live project plan.",
    required_must_say: [
      "If the plan lives in Excel or PowerPoint, the project structure (project, phases, tasks, dates, owners, dependencies) should be modelled in BTPM so reporting and governance work.",
      "SharePoint can store supporting evidence (minutes, decks, files); the governance record or execution update in BTPM is what makes it traceable.",
      "Generated decks and exports are outputs, not the source of truth — editing them does not update BTPM.",
      "If a decision was made outside BTPM, record it in BTPM as a governance record (or as an execution update for execution-level changes) and link or attach the supporting evidence.",
    ],
    forbidden_must_not_say: [
      "Do not say the Excel/PowerPoint/SharePoint file is the live BTPM record.",
      "Do not say BTPM reads the contents of SharePoint files.",
      "Do not say editing the generated deck updates BTPM.",
      "Do not invent an import-from-Excel button unless it is verified.",
    ],
    safe_navigation: "the Project Planning page, Project Governance, and the Files / generated documents area",
  },

  status_or_health_update: {
    opening:
      "In BTPM, status, stage, health, and progress are related but distinct concepts; they live on the project record and are reflected on summary tiles.",
    required_must_say: [
      "Status is the project's current workflow condition. Stage is the delivery/maturity point. Health is the overall RAG/at-attention signal. Progress is how much work is completed.",
      "A red tile usually indicates a health/risk/attention signal, not necessarily that no work is happening; a task can be complete while the project still looks behind because other work, blockers, KPIs, or governance items are off-track.",
      "To change the signal, update the underlying record (task/phase/project status or progress, blockers, risks, KPI updates, governance evidence) rather than the tile itself.",
      "The assistant does not read the user's actual status values — it explains how the concepts relate and where the underlying record lives.",
    ],
    forbidden_must_not_say: [
      "Do not claim a specific project is red/green/at risk right now.",
      "Do not say the tile is editable directly.",
      "Do not list current open blockers, risks, or KPI values.",
    ],
    safe_navigation: "the Project Overview and the relevant task, phase, or KPI record",
  },

  baseline_change: {
    opening:
      "In BTPM, the baseline is the approved reference plan; the current plan is the active working plan. Changing dates may update the current plan; changing the baseline is governance-sensitive.",
    required_must_say: [
      "Day-to-day date adjustments live on the current plan (task/phase dates, execution updates).",
      "If the approved reference plan needs to change (for example after a steering decision), that is a baseline change and is governance-sensitive — it typically needs the appropriate approval, not a silent edit.",
      "A plan changed after a meeting often combines all three: an execution update describing what changed, current-plan date updates on the affected tasks/phases, and possibly a baseline change if the approved reference was moved.",
      "The assistant does not read the user's actual baseline or current plan values.",
    ],
    forbidden_must_not_say: [
      "Do not claim the baseline was changed automatically.",
      "Do not say editing a date silently changes the baseline.",
      "Do not invent a 'rebaseline' button unless verified.",
    ],
    safe_navigation: "the Project Planning page, the affected task/phase records, and Project Governance for baseline approval",
  },

  phase_task_planning: {
    opening:
      "Tasks live under a project's phase structure in BTPM, not on the Roadmap or My Work directly.",
    required_must_say: [
      "Add and create tasks from the Project Planning page (the task then has its own Task detail).",
      "Roadmap is a portfolio/project visibility view; My Work is a personal assigned-work view; neither is the primary place to maintain the task structure.",
      "Use phases to group related tasks; split a phase when it grows too large to track.",
    ],
    forbidden_must_not_say: [
      "Do not send users to the Roadmap to create tasks.",
      "Do not invent exact button names that are not verified.",
      "Do not claim the assistant created a task for the user.",
    ],
    safe_navigation: "the Project Planning page (and Task detail once a task exists)",
  },

  // ARCH.1E-FIX.3 — alias playbook for explicit task-planning intent.
  task_planning_guidance: {
    opening:
      "Tasks are added and maintained under a project's phase structure on the Project Planning page.",
    required_must_say: [
      "Add and locate tasks from the Project Planning page; each task then opens into a Task detail.",
      "Roadmap and My Work are visibility views — they are not where you create or maintain the task structure.",
      "If you cannot see how to add a task, check that you are on the Project Planning page for the project, and that you have edit permission; ask a Workspace Admin if not.",
    ],
    forbidden_must_not_say: [
      "Do not say the closest BTPM area for adding or finding tasks is the Roadmap.",
      "Do not invent exact button names that are not verified.",
      "Do not claim the assistant created a task for the user.",
    ],
    safe_navigation: "the Project Planning page (and Task detail once a task exists)",
  },

  // ARCH.1E-FIX.3 — KPI vs project-health mixed concept question.
  kpi_project_health_mixed_guidance: {
    opening:
      "In BTPM, project execution status and KPI performance are related but distinct — a project can be on track operationally while a KPI is underperforming, and vice versa.",
    required_must_say: [
      "Project status/progress reflects whether the planned work is on track; a KPI reflects a measured value defined for the project.",
      "Tasks completing on time can keep a project green for execution while a KPI is still red because the outcome it measures has not improved yet (KPIs often lag execution progress).",
      "Record execution updates when work progresses; update a KPI only when the measured value changes.",
      "If a KPI looks inconsistent with what you see, review its definition, source, and reporting period (and confirm the latest official snapshot is captured).",
    ],
    forbidden_must_not_say: [
      "Do not claim to have read the user's actual project status or live KPI values.",
      "Do not say the project is on track or off track for the user's specific project.",
      "Do not say execution progress automatically updates a KPI value.",
    ],
    safe_navigation: "the Project Overview and the project's KPIs area",
  },

};



export function getDomainPlaybook(
  situation: BtpmDomainSituation | null | undefined,
): DomainPlaybook | null {
  if (!situation) return null;
  return PLAYBOOKS[situation] ?? null;
}
