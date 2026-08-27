// API-G.1I / API-K.9 — Pure payload contract for GET /v1/capabilities.
//
// `supportedOperations` means "implemented by this API version". It does NOT
// mean "currently enabled for this caller": actual execution remains governed
// independently by the runtime switches, authentication, Connected App
// enablement, capability grants, Project enablement, delegated user authority
// and canonical PMG business rules. This route is deliberately NOT
// client-specific and never queries grants.
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, touch the database, register routes,
// handle HTTP requests, log, schedule timers, or hold any mutable
// global state.

export const CAPABILITIES_ROUTE = Object.freeze({
  id: "capabilities.get",
  method: "GET",
  path: "/v1/capabilities",
  operation: "read",
} as const);

export type ApiSupportedOperation =
  | "version.get"
  | "capabilities.get"
  | "me.get"
  | "organizations.get"
  | "workspaces.get"
  // API-N.2B — the two accepted external Program reads.
  | "programs.get"
  | "programs.get_by_id"
  | "projects.get"
  | "projects.get_by_id"
  | "projects.planning.get"
  | "execution_updates.append"
  | "risks.create"
  | "risks.update"
  | "blockers.create"
  | "blockers.update"
  | "phases.create"
  | "phases.update"
  | "phases.reorder"
  | "phases.plan"
  | "tasks.create"
  | "tasks.update"
  | "tasks.reorder"
  | "tasks.plan"
  | "tasks.assign"
  | "tasks.transition"
  // API-M.CP.5 — the seven accepted parity read operations, appended in the
  // same order they hold in the live route allowlist.
  | "risks.get"
  | "risks.get_by_id"
  | "blockers.get"
  | "blockers.get_by_id"
  | "execution_updates.get"
  | "phases.get_by_id"
  | "tasks.get_by_id"
  // API-N.5 — the single accepted external Project mutation, appended last to
  // preserve the frozen advertisement order.
  | "projects.create"
  // API-N.6 — the single accepted external Project metadata update.
  | "projects.update"
  // API-N.7 — the single accepted external Project status transition.
  | "projects.transition"
  // API-N.9A — the single accepted external Program command, appended last to
  // preserve the frozen advertisement order.
  | "programs.create"
  // API-N.9B — the single accepted external Program metadata update.
  | "programs.update"
  // API-Q WML-1B — the single accepted external Workspace-member read.
  | "workspace_members.get"
  // API-Q Portfolio-3 — the three accepted external Portfolio reads.
  | "portfolios.get"
  | "portfolios.get_by_id"
  | "portfolios.projects.get"
  // API-Q Portfolio-4B — the single accepted external Portfolio command.
  | "portfolios.create"
  // API-Q Portfolio-5B — the accepted external Portfolio metadata update.
  | "portfolios.update"
  // API-Q Portfolio-6B — the accepted external Project↔Portfolio assignment.
  | "portfolios.assign_project"
  // KPI-1B — the single accepted external Project KPI collection read.
  | "kpis.get"
  // KPI-2B — the single accepted external KPI detail read.
  | "kpis.get_by_id"
  // KPI-3B — the single accepted external KPI update-history read.
  | "kpis.updates.get"
  // KPI-4B — the single accepted external Project KPI definition create.
  | "kpis.create"
  // KPI-5B — the single accepted external KPI definition update command.
  | "kpis.update"
  // KPI-6B — the single accepted external KPI update-history append command.
  | "kpis.updates.append";

export interface ApiCapabilitiesPayload {
  readonly service: "btpm-api";
  readonly apiVersion: "v1";
  readonly supportedOperations: readonly ApiSupportedOperation[];
}

export function buildCapabilitiesPayload(): ApiCapabilitiesPayload {
  const supportedOperations: readonly ApiSupportedOperation[] = Object.freeze([
    "version.get",
    "capabilities.get",
    "me.get",
    "organizations.get",
    "workspaces.get",
    "programs.get",
    "programs.get_by_id",
    "projects.get",
    "projects.get_by_id",
    "projects.planning.get",
    "execution_updates.append",
    "risks.create",
    "risks.update",
    "blockers.create",
    "blockers.update",
    "phases.create",
    "phases.update",
    "phases.reorder",
    "phases.plan",
    "tasks.create",
    "tasks.update",
    "tasks.reorder",
    "tasks.plan",
    "tasks.assign",
    "tasks.transition",
    "risks.get",
    "risks.get_by_id",
    "blockers.get",
    "blockers.get_by_id",
    "execution_updates.get",
    "phases.get_by_id",
    "tasks.get_by_id",
    "projects.create",
    "projects.update",
    "projects.transition",
    "programs.create",
    "programs.update",
    "workspace_members.get",
    "portfolios.get",
    "portfolios.get_by_id",
    "portfolios.projects.get",
    "portfolios.create",
    "portfolios.update",
    "portfolios.assign_project",
    "kpis.get",
    "kpis.get_by_id",
    "kpis.updates.get",
    "kpis.create",
    "kpis.update",
    "kpis.updates.append",
  ] as const);
  return Object.freeze({
    service: "btpm-api",
    apiVersion: "v1",
    supportedOperations,
  } as const);
}
