import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parsePmgCommandResult, type PmgCommandResult } from "@/lib/pmg/pmgContract";
import {
  rpcTyped,
  type ObjectLinkInput,
  type ProjectBlockerRow,
  type ProjectRiskRow,
  type UserLinkInput,
} from "@/lib/entityLinks";

// Re-export aggregate row types so consumers have one import path.
export type { ProjectBlockerRow, ProjectRiskRow };

// --- PMG status handling for canonical Risk commands (API-J.3A) ---
const RISK_CONFLICT_MESSAGE =
  "This Risk was updated elsewhere. Close and reopen the editor to load the latest version.";

function riskPmgError(result: PmgCommandResult, action: "create" | "update"): Error {
  if (result.status === "not_authorized") {
    return new Error("You are not authorized to " + action + " Risks on this project.");
  }
  if (result.status === "invalid") {
    return new Error("Invalid Risk details. Please review the fields and try again.");
  }
  if (result.status === "conflict") return new Error(RISK_CONFLICT_MESSAGE);
  return new Error(
    action === "create" ? "Could not create the Risk. Please try again." : "Could not save the Risk. Please try again.",
  );
}


// --- Project-wide risks (all levels: project, phase, task) ---
export function useProjectAllRisks(projectId: string | undefined) {
  return useQuery<ProjectRiskRow[]>({
    queryKey: ["project-all-risks", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await rpcTyped<ProjectRiskRow[]>("list_project_all_risks", {
        _project_id: projectId,
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!projectId,
  });
}

// --- Project-wide blockers (all levels) ---
export function useProjectAllBlockers(projectId: string | undefined) {
  return useQuery<ProjectBlockerRow[]>({
    queryKey: ["project-all-blockers", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await rpcTyped<ProjectBlockerRow[]>("list_project_all_blockers", {
        _project_id: projectId,
      });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: !!projectId,
  });
}

// --- Atomic risk create/update with structured links ---
export interface RiskWithLinksInput {
  title: string;
  description?: string | null;
  mitigation_plan?: string | null;
  likelihood: string;
  impact: string;
  status: string;
  target_type: string;
  target_id: string;
  organization_id: string;
  workspace_id: string;
  user_links: UserLinkInput[];
  object_links: ObjectLinkInput[];
}

interface RpcIdResult {
  id: string;
}

export function useCreateRisk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: RiskWithLinksInput): Promise<RpcIdResult> => {
      const { data, error } = await (supabase.rpc as any)("apply_risk_create", {
        _target_type: v.target_type,
        _target_id: v.target_id,
        _title: v.title,
        _description: v.description ?? null,
        _mitigation_plan: v.mitigation_plan ?? null,
        _likelihood: v.likelihood,
        _impact: v.impact,
        _status: v.status,
        _user_links: v.user_links,
        _object_links: v.object_links,
      });
      if (error) throw new Error("Could not create the Risk. Please try again.");
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied") throw riskPmgError(result, "create");
      const id = (result.data as { id?: unknown })?.id ?? result.target_id;
      if (typeof id !== "string") throw riskPmgError(result, "create");
      return { id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-all-risks"] });
      qc.invalidateQueries({ queryKey: ["project-risks"] });
      qc.invalidateQueries({ queryKey: ["entity-links", "risk"] });
    },
  });
}

export interface RiskUpdateInput {
  id: string;
  expected_updated_at: string;
  title: string;
  description?: string | null;
  mitigation_plan?: string | null;
  likelihood: string;
  impact: string;
  status: string;
  user_links: UserLinkInput[];
  object_links: ObjectLinkInput[];
}

export function useUpdateRisk() {
  const qc = useQueryClient();
  const invalidateRisks = () => {
    qc.invalidateQueries({ queryKey: ["project-all-risks"] });
    qc.invalidateQueries({ queryKey: ["project-risks"] });
    qc.invalidateQueries({ queryKey: ["entity-links", "risk"] });
  };
  return useMutation({
    mutationFn: async (v: RiskUpdateInput): Promise<RpcIdResult> => {
      const { data, error } = await (supabase.rpc as any)("apply_risk_update", {
        _risk_id: v.id,
        _expected_updated_at: v.expected_updated_at,
        _title: v.title,
        _description: v.description ?? null,
        _mitigation_plan: v.mitigation_plan ?? null,
        _likelihood: v.likelihood,
        _impact: v.impact,
        _status: v.status,
        _user_links: v.user_links,
        _object_links: v.object_links,
      });
      if (error) throw new Error("Could not save the Risk. Please try again.");
      const result = parsePmgCommandResult(data);
      if (result.status === "conflict") {
        invalidateRisks();
        throw riskPmgError(result, "update");
      }
      if (result.status !== "applied" && result.status !== "no_change") {
        throw riskPmgError(result, "update");
      }
      return { id: v.id };
    },
    onSuccess: invalidateRisks,
  });

}

// --- Canonical blocker create/update (API-J.3B) ---
const BLOCKER_CONFLICT_MESSAGE =
  "This Blocker was updated elsewhere. Close and reopen the editor to load the latest version.";

function blockerPmgError(result: PmgCommandResult, action: "create" | "update"): Error {
  if (result.status === "not_authorized") {
    return new Error("You are not authorized to " + action + " Blockers on this project.");
  }
  if (result.status === "invalid") {
    return new Error("Invalid Blocker details. Please review the fields and try again.");
  }
  if (result.status === "conflict") return new Error(BLOCKER_CONFLICT_MESSAGE);
  return new Error(
    action === "create"
      ? "Could not create the Blocker. Please try again."
      : "Could not save the Blocker. Please try again.",
  );
}

export interface BlockerWithLinksInput {
  title: string;
  description?: string | null;
  severity: string;
  status?: string;
  target_type: string;
  target_id: string;
  user_links: UserLinkInput[];
  object_links: ObjectLinkInput[];
}

export interface BlockerCreateResult extends RpcIdResult {
  target_type: string;
  target_id: string;
}

export function useCreateBlockerWithLinks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: BlockerWithLinksInput): Promise<BlockerCreateResult> => {
      const { data, error } = await (supabase.rpc as any)("apply_blocker_create", {
        _target_type: v.target_type,
        _target_id: v.target_id,
        _title: v.title,
        _description: v.description ?? null,
        _severity: v.severity,
        _status: v.status ?? "open",
        _user_links: v.user_links,
        _object_links: v.object_links,
      });
      if (error) throw new Error("Could not create the Blocker. Please try again.");
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied") throw blockerPmgError(result, "create");
      const id = (result.data as { id?: unknown })?.id ?? result.target_id;
      if (typeof id !== "string") throw blockerPmgError(result, "create");
      return { id, target_type: v.target_type, target_id: v.target_id };
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["project-all-blockers"] });
      qc.invalidateQueries({ queryKey: ["project-blockers"] });
      qc.invalidateQueries({ queryKey: ["blockers", d.target_type, d.target_id] });
      qc.invalidateQueries({ queryKey: ["entity-links", "blocker"] });
    },
  });
}

export interface BlockerUpdateInput {
  id: string;
  expected_updated_at: string;
  title: string;
  description?: string | null;
  severity: string;
  status: string;
  user_links: UserLinkInput[];
  object_links: ObjectLinkInput[];
}

export function useUpdateBlocker() {
  const qc = useQueryClient();
  const invalidateBlockers = () => {
    qc.invalidateQueries({ queryKey: ["project-all-blockers"] });
    qc.invalidateQueries({ queryKey: ["project-blockers"] });
    qc.invalidateQueries({ queryKey: ["blockers"] });
    qc.invalidateQueries({ queryKey: ["entity-links", "blocker"] });
  };
  return useMutation({
    mutationFn: async (v: BlockerUpdateInput): Promise<RpcIdResult> => {
      const { data, error } = await (supabase.rpc as any)("apply_blocker_update", {
        _blocker_id: v.id,
        _expected_updated_at: v.expected_updated_at,
        _title: v.title,
        _description: v.description ?? null,
        _severity: v.severity,
        _status: v.status,
        _user_links: v.user_links,
        _object_links: v.object_links,
      });
      if (error) throw new Error("Could not save the Blocker. Please try again.");
      const result = parsePmgCommandResult(data);
      if (result.status === "conflict") {
        invalidateBlockers();
        throw blockerPmgError(result, "update");
      }
      if (result.status !== "applied" && result.status !== "no_change") {
        throw blockerPmgError(result, "update");
      }
      return { id: v.id };
    },
    onSuccess: invalidateBlockers,
  });
}

