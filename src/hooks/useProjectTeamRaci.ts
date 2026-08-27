import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { normalizeProjectTeamRoleLabels } from "@/hooks/projectTeamUtils";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";

export type DecryptedTeamMember = {
  id: string;
  user_id: string;
  project_id: string;
  role_label: string | null;
  canonical_role_key: string | null;
  created_at: string;
  updated_at: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type RaciAssignment = {
  id: string;
  user_id: string | null;
  stakeholder_id: string | null;
  raci_role: string;
  target_type: string;
  target_id: string;
  created_at: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  stakeholder_type: string | null;
  stakeholder_role_label: string | null;
};

export function useProjectTeam(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-team-decrypted", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc("list_decrypted_project_team", {
        _project_id: projectId,
      });
      if (error) throw error;
      return normalizeProjectTeamRoleLabels(projectId, (data as DecryptedTeamMember[]) || []);
    },
    enabled: !!projectId,
  });
}

export function useProjectRaci(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-raci", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc("list_project_raci", {
        _project_id: projectId,
      });
      if (error) throw error;
      return (data as RaciAssignment[]) || [];
    },
    enabled: !!projectId,
  });
}

function pmgErrorMessage(status: string, data: Record<string, unknown>, fallback: string): string {
  const reason = typeof data?.reason === "string" ? (data.reason as string) : null;
  if (status === "not_authorized") return "You do not have permission to perform this action.";
  if (status === "conflict") return "This item was updated by someone else. Refresh and try again.";
  if (status === "invalid") {
    if (reason === "user_not_eligible") return "This user cannot be added to the team.";
    if (reason === "project_id_and_user_id_required" || reason === "member_id_required")
      return "Missing required information.";
    return reason ?? fallback;
  }
  return fallback;
}

export function useAddTeamMember(projectId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      userId,
      roleLabel,
      canonicalRoleKey,
    }: {
      userId: string;
      roleLabel?: string;
      canonicalRoleKey?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("apply_project_team_member_add", {
        _project_id: projectId,
        _user_id: userId,
        _role_label: roleLabel?.trim() || null,
        _canonical_role_key: canonicalRoleKey ?? null,
      });
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied" && result.status !== "no_change") {
        throw new Error(pmgErrorMessage(result.status, result.data, "Failed to add team member"));
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-team-decrypted", projectId] });
      qc.invalidateQueries({ queryKey: ["project-team", projectId] });
      toast({ title: "Team member added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}


export function useUpdateTeamMemberRole(projectId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      memberId,
      expectedUpdatedAt,
      roleLabel,
      canonicalRoleKey,
    }: {
      memberId: string;
      expectedUpdatedAt: string;
      roleLabel: string;
      canonicalRoleKey?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("apply_project_team_member_role_update", {
        _member_id: memberId,
        _role_label: roleLabel.trim() || null,
        _canonical_role_key: canonicalRoleKey ?? null,
        _expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied" && result.status !== "no_change") {
        throw new Error(pmgErrorMessage(result.status, result.data, "Failed to update role"));
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-team-decrypted", projectId] });
      qc.invalidateQueries({ queryKey: ["project-team", projectId] });
      toast({ title: "Role updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useRemoveTeamMember(projectId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      memberId,
      expectedUpdatedAt,
    }: {
      memberId: string;
      expectedUpdatedAt: string;
    }) => {
      const { data, error } = await supabase.rpc("apply_project_team_member_remove", {
        _member_id: memberId,
        _expected_updated_at: expectedUpdatedAt,
      });
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied" && result.status !== "no_change") {
        throw new Error(pmgErrorMessage(result.status, result.data, "Failed to remove team member"));
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-team-decrypted", projectId] });
      qc.invalidateQueries({ queryKey: ["project-team", projectId] });
      toast({ title: "Team member removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}

export function useAddRaciAssignment(projectId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      stakeholderId,
      userId,
      raciRole,
    }: {
      stakeholderId?: string | null;
      userId?: string | null;
      raciRole: string;
    }) => {
      if (!stakeholderId && !userId) throw new Error("Pick a stakeholder");
      const { data, error } = await supabase.rpc("apply_project_raci_add", {
        _project_id: projectId,
        _raci_role: raciRole,
        _stakeholder_id: stakeholderId ?? null,
        _user_id: userId ?? null,
      });
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied" && result.status !== "no_change") {
        const reason = typeof result.data?.reason === "string" ? (result.data.reason as string) : null;
        if (reason === "accountable_already_assigned") {
          throw new Error(
            "Only one Accountable is allowed per object. Remove the current Accountable before assigning another.",
          );
        }
        throw new Error(pmgErrorMessage(result.status, result.data, "Failed to add RACI assignment"));
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-raci", projectId] });
      qc.invalidateQueries({ queryKey: ["project-activity-events", projectId] });
      toast({ title: "RACI assignment added" });
    },
    onError: (e: any) => toast({ title: "Cannot add assignment", description: e.message, variant: "destructive" }),
  });
}

export function useRemoveRaciAssignment(projectId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { data, error } = await supabase.rpc("apply_project_raci_remove", {
        _assignment_id: assignmentId,
      });
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied" && result.status !== "no_change") {
        throw new Error(pmgErrorMessage(result.status, result.data, "Failed to remove RACI assignment"));
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-raci", projectId] });
      qc.invalidateQueries({ queryKey: ["project-activity-events", projectId] });
      toast({ title: "RACI assignment removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
}
