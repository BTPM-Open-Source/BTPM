/**
 * API-ADM.3 / API-N.10A — the single presentation-only business-domain grouping
 * source for every API capability administration surface (Platform Admin
 * "Supported capabilities", Connected App Organization permissions and
 * Connected App Workspace permissions).
 *
 * This module is pure presentation metadata. It must NOT contain any
 * authorization, grant, scope or backend logic, and it must never mutate or
 * filter capability records.
 */

export type ApiCapabilityDomain =
  | "directory"
  | "portfolios"
  | "programs"
  | "projects_planning"
  | "execution_updates"
  | "kpis"
  | "risks"
  | "blockers"
  | "other";

export interface ApiCapabilityDomainMeta {
  readonly id: ApiCapabilityDomain;
  readonly label: string;
  readonly description: string;
}

/** Fixed canonical presentation order. */
export const API_CAPABILITY_DOMAINS: readonly ApiCapabilityDomainMeta[] = Object.freeze([
  {
    id: "directory",
    label: "Directory & access",
    description:
      "Foundational discovery capabilities for Organizations, Workspaces and Workspace members.",
  },
  {
    id: "portfolios",
    label: "Portfolios",
    description: "Portfolio discovery, Portfolio data and Project ↔ Portfolio assignment.",
  },
  {
    id: "programs",
    label: "Programs",
    description: "Program discovery and Program-data capabilities.",
  },
  {
    id: "projects_planning",
    label: "Projects & planning",
    description: "Project, planning, Phase and Task capabilities.",
  },
  {
    id: "execution_updates",
    label: "Execution updates",
    description: "Progress-update capabilities.",
  },
  { id: "kpis", label: "KPIs", description: "KPI definition, measurement and update capabilities." },
  { id: "risks", label: "Risks", description: "Risk-management capabilities." },
  { id: "blockers", label: "Blockers", description: "Blocker-management capabilities." },
  {
    id: "other",
    label: "Other",
    description: "Capabilities not yet assigned to a presentation group.",
  },
] as const);

/** Canonical capability-key domain prefix → presentation group. */
const DOMAIN_PREFIX_MAP: Readonly<Record<string, ApiCapabilityDomain>> = Object.freeze({
  organizations: "directory",
  workspaces: "directory",
  workspace_members: "directory",
  
  portfolios: "portfolios",
  programs: "programs",
  projects: "projects_planning",
  planning: "projects_planning",
  phases: "projects_planning",
  tasks: "projects_planning",
  execution_updates: "execution_updates",
  kpis: "kpis",
  risks: "risks",
  blockers: "blockers",
});



/**
 * Resolve the presentation domain of a canonical capability key by its domain
 * prefix (the segment before the first ":"). Unknown domains fall back to
 * "other" so no capability is ever hidden.
 */
export function getCapabilityDomain(capabilityKey: string): ApiCapabilityDomain {
  if (typeof capabilityKey !== "string") return "other";
  const prefix = capabilityKey.trim().toLowerCase().split(":")[0];
  if (!prefix) return "other";
  return DOMAIN_PREFIX_MAP[prefix] ?? "other";
}

/**
 * Group capabilities into the fixed domain order, preserving the incoming
 * (backend-provided) order inside each group and omitting empty groups.
 */
export function groupCapabilitiesByDomain<T extends { capability_key: string }>(
  capabilities: readonly T[],
): { domain: ApiCapabilityDomainMeta; capabilities: T[] }[] {
  return API_CAPABILITY_DOMAINS.map((domain) => ({
    domain,
    capabilities: capabilities.filter((c) => getCapabilityDomain(c.capability_key) === domain.id),
  })).filter((g) => g.capabilities.length > 0);
}
