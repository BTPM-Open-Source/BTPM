# Governance Decision Case Management — Canonical Architecture and UX Contract

Status: APPROVED ARCHITECTURE — DC.0
Scope: Documentation and memory only. No product behavior change in this step.

## 1. Purpose

Define the canonical architecture, lifecycle, UX information architecture,
data ownership, and implementation sequence for Governance Decision Case
Management before any code is written, so that the new decision workflow
does not become a messy extension of the existing Record Governance
Evidence modal.

This contract is binding for phases DC.1 through DC.11.

## 2. Current repo baseline

Project Governance today is implemented around:

- Pages: `src/pages/ProjectGovernance.tsx`
- Hooks: `src/hooks/useProjectGovernance.ts`
- Components: `src/components/project/governance/RecordFormDialog.tsx`,
  `src/components/project/governance/RecordDetailDialog.tsx`
- Tables: `governance_records`, `governance_record_decisions`,
  `governance_record_links`, `governance_cadences`
- RPCs: `list_project_governance_records`,
  `get_governance_record_detail`, `create_governance_record`,
  `update_governance_record`, plus cadence + summary RPCs

The current Governance page supports cadences, evidence records,
structured decisions inside evidence records, linked project objects,
SharePoint evidence reference, and Outlook/Teams reference URL. The
existing `RecordFormDialog` is suitable for normal evidence capture and
must not be overloaded with the full Decision Case flow.

## 3. Canonical object model

Decision Cases are anchored to `governance_records` as a distinct
canonical subtype/flow, not a parallel module. The canonical
discriminator is `governance_records.record_kind`, with values
`'evidence_record'` (default) and `'decision_case'`. The earlier draft
term `is_decision_case` is not used.

Schema added in DC.1 (live):

- `governance_records.record_kind` — discriminator
- `governance_records.decision_stage` — 7-stage lifecycle, CHECK-enforced
- `governance_records.decision_question` — encrypted
- `governance_records.decision_owner_stakeholder_id` — FK
  `project_stakeholders(id)` ON DELETE SET NULL. The FK alone is
  insufficient: protected RPCs MUST validate same-project membership
  (`project_stakeholders.project_id = governance_records.project_id`).
  This mirrors `set_governance_record_decisions`. The owner stakeholder
  must belong to the same project as the decision case.
- `governance_records.target_decision_date`

Future tables, introduced from DC.4 onward (not yet built):

- Multi-evidence references table (DC.4)
- BTPM context relevance table (DC.5/DC.6)
- Copilot brief versioning table (DC.7)
- Decision outcome / closure fields (DC.8)
- Generated output artifact references (DC.9–DC.11)

Concrete column and table names are deferred to DC.1; the model must
preserve scope integrity, encryption at rest, RLS posture, and protected
SECURITY DEFINER RPCs already established for governance.

## 4. Decision Case vs Evidence Record vs Cadence

- Cadence — expected governance rhythm (e.g. monthly SteerCo).
- Evidence Record — evidence that a governance event happened. Simple
  capture, no managed lifecycle. Owned by the existing `RecordFormDialog`.
- Decision Case — managed lifecycle for decision preparation, evidence
  collection, Copilot brief handling, stakeholder package creation,
  decision taken, generated outputs, and closure. Owned by a dedicated
  full-page workspace.

A Decision Case is NOT merely a normal Evidence Record with more fields,
and NOT a separate top-level module disconnected from Governance.

## 5. UX information architecture

The top-level project tab remains `Governance` — no new top-level
project tab named `Decisions`.

Inside Governance, the page becomes an internal hub with three sections
and optional Outputs (future):

- Decision Cases
- Evidence Records
- Cadences
- Outputs (later, if needed)

Visible header actions:

- Create decision case (primary, opens lightweight init then routes to
  the decision case workspace)
- Record evidence (existing evidence-record flow)
- Create cadence (existing cadence flow)

Decision Cases must be discoverable inside Governance via the
Decision Cases section and the `Create decision case` action.

## 6. Decision Case lifecycle stages

Canonical lifecycle (server-enforced, single source of truth):

1. Initiated
2. Evidence Collection
3. Brief Prepared
4. Provided to Stakeholders
5. Pending Decision
6. Decision Taken
7. Closed

Stage transitions live on the governance record and are written through
protected RPCs.

## 7. Dedicated Decision Case workspace

Route:

```
/workspace/:workspaceId/project/:projectId/governance/decision-cases/:recordId
```

Tabs in the workspace:

1. Setup
2. Evidence & Context
3. Copilot Brief
4. Stakeholder Package
5. Decision Taken & Closure

The workspace is a full page, not a large overloaded modal. Modal use is
limited to small focused dialogs (e.g. add evidence reference).

## 8. Data ownership and source-of-truth rules

- Final decision truth is stored in structured decision/outcome fields
  on the governance record, not in Word or PPT.
- Copilot output is draft material, never the approved decision.
- Word and PPT outputs are downstream generated artifacts only.
- SharePoint, OneNote, Outlook, and Teams evidence remain external.
  BTPM stores controlled references and metadata only — never
  uncontrolled copies of the documents.
- Cross-project context is relationship-based and permission-checked
  (dependencies, shared risks/blockers, manual authorized add). No
  broad same-program data dump.
- Activity history and traceability for a Decision Case remain visible
  inside Governance, not in a separate audit silo.

## 9. Evidence handling rules

- Decision Cases support multiple evidence references (DC.4): OneNote
  page, SharePoint file, Outlook reference, Teams reference, MoM, other
  link. Normal Evidence Records keep their current single-reference UX.
- All evidence references are metadata + URL only.
- No upload pipeline into Supabase storage as a parallel evidence
  store.

## 10. Copilot output handling rules

- Copilot raw output is stored as draft text, separately from edited
  brief, executive summary, recommendation, options, guardrails, and
  residual risks (DC.7).
- Brief versioning is required so an audit trail exists.
- Copilot draft never becomes the decision outcome; closure fields in
  DC.8 are the only place final decision truth is written.

## 11. Generated Word/PPT output handling rules

- Word sign-off (DC.9) and PPT one-pager (DC.10) reuse existing DOCX
  and PPT generation + SharePoint publish patterns. No new generation
  framework.
- Generated outputs are artifacts, not source of truth. Regeneration is
  always possible from canonical decision case data.
- DC.11 surfaces an Outputs panel with version history and SharePoint
  links.

## 12. Cross-project context rules

- Allowed inclusion: linked through an existing project dependency,
  shared risk/blocker, or manual authorized addition by a user with
  rights in both projects.
- Forbidden: pulling all sibling projects in the same program.
- Permission checks happen server-side in the same RPC layer that
  governs the Decision Case.

## 13. What must NOT be built into `RecordFormDialog`

The existing `RecordFormDialog` is restricted to normal evidence capture.
The following must NOT be added to it:

- Decision lifecycle stage controls
- Decision question / owner / target date fields
- Multi-evidence reference editor
- BTPM context relevance selection
- Cross-project context UI
- Copilot brief workspace or versioning
- Stakeholder package authoring
- Decision Taken & Closure capture
- Generated Word/PPT output controls
- Outputs panel

All of the above belong inside the dedicated Decision Case workspace.

## 14. Implementation phase plan from DC.1 onward

- DC.1 — Decision Case backend vocabulary (record kind flag, lifecycle
  stage, decision question/owner/target date, protected RPCs,
  encryption). No large UX.
- DC.2 — Governance Hub refactor into Decision Cases / Evidence Records
  / Cadences sections with `Create decision case` action. No full
  workspace yet.
- DC.3 — Decision Case workspace shell at the canonical route with all
  five tabs scaffolded; only Setup is functional.
- DC.4 — Multi-evidence references for decision cases only.
- DC.5 — BTPM context and relevance selection inside same project.
- DC.6 — Controlled cross-project context (dependency / shared
  risk-blocker / manual authorized).
- DC.7 — Copilot Brief workspace with versioning.
- DC.8 — Decision Taken & Closure structured fields.
- DC.9 — Word decision sign-off generation (reuse DOCX pattern).
- DC.10 — PPT one-pager generation (reuse PPT pattern).
- DC.11 — Outputs panel, version history, SharePoint links, end-to-end
  UAT and phase closure.

## 15. Acceptance criteria for this architecture contract

- Decision Cases are anchored to Governance but follow their own
  canonical workflow, route, and UX.
- The current Record Governance Evidence modal is not overloaded with
  decision lifecycle, Copilot, stakeholder, closure, or output logic.
- Normal Evidence Records and Decision Cases are separate UX flows
  under the Governance tab.
- The Decision Case workspace lives at the canonical route with the
  five-tab structure above.
- Lifecycle stages, source-of-truth rules, evidence rules, Copilot
  rules, output rules, and cross-project rules above are binding for
  DC.1 through DC.11.
- No new top-level `Decisions` project tab is introduced.
- TypeScript build continues to pass because no product code is
  changed in DC.0.
