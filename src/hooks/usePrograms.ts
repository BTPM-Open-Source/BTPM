import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";

export function useWorkspacePrograms(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-programs", workspaceId],
    queryFn: async () => {
      if (!workspaceId) throw new Error("No workspace ID");
      const { data, error } = await supabase.rpc("list_decrypted_workspace_programs", {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!workspaceId,
  });
}

export function useProgram(programId: string | undefined) {
  return useQuery({
    queryKey: ["program", programId],
    queryFn: async () => {
      if (!programId) throw new Error("No program ID");
      const { data, error } = await supabase.rpc("get_decrypted_program", {
        _program_id: programId,
      });
      if (error) throw error;
      return data as any;
    },
    enabled: !!programId,
  });
}

export function useProgramProjects(programId: string | undefined) {
  return useQuery({
    queryKey: ["program-projects", programId],
    queryFn: async () => {
      if (!programId) throw new Error("No program ID");
      const { data, error } = await supabase.rpc("list_decrypted_program_projects", {
        _program_id: programId,
      });
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!programId,
  });
}

// Wave 5 Step 5.5 — `is_archived` removed from this payload. Lifecycle
// (archive/unarchive/hard-delete) goes through useLifecycleActions, which
// routes through the canonical Step 5.3 RPCs.
export interface ProgramPayload {
  name?: string;
  status?: string;
  description?: string | null;
}

export function useProgramCreate(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: { name: string; description?: string }) => {
      if (!workspaceId) throw new Error("No workspace ID");
      // PMG.2I — Route through the protected server command. All authority,
      // org resolution, validation, encryption, and audit run server-side.
      const { data, error } = await supabase.rpc("apply_program_create", {
        _name: payload.name,
        _workspace_id: workspaceId,
        _description: payload.description ?? null,
      });
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied") {
        const reason =
          (result.data as { reason?: string } | null)?.reason ??
          `Program creation ${result.status}`;
        throw new Error(reason);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-programs", workspaceId] });
      toast({ title: "Program created" });
    },
    onError: (err: any) => {
      toast({ title: "Error creating program", description: err.message, variant: "destructive" });
    },
  });
}

export function useProgramUpdate(programId: string | undefined, workspaceId?: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: ProgramPayload) => {
      if (!programId) throw new Error("No program ID");

      // PMG.2J — Always read a fresh canonical `updated_at` immediately
      // before the protected update, so intra-flow edits by other commands
      // don't cause a false stale-conflict.
      const { data: fresh, error: freshError } = await supabase.rpc(
        "get_decrypted_program",
        { _program_id: programId },
      );
      if (freshError) throw freshError;
      const expected = (fresh as any)?.updated_at as string | undefined;
      if (!expected) throw new Error("Unable to read current program state");

      const setDescription = Object.prototype.hasOwnProperty.call(payload, "description");
      const normalizedDesc = setDescription
        ? payload.description === "" ? null : payload.description ?? null
        : null;

      const { data, error } = await supabase.rpc("apply_program_update", {
        _program_id: programId,
        _expected_updated_at: expected,
        _name: payload.name ?? null,
        _status: (payload.status ?? null) as any,
        _description: normalizedDesc,
        _set_description: setDescription,
      });
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied" && result.status !== "no_change") {
        const reason =
          (result.data as { reason?: string } | null)?.reason ??
          `Program update ${result.status}`;
        throw new Error(reason);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["program", programId] });
      queryClient.invalidateQueries({ queryKey: ["workspace-programs", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["workspace-programs"] });
      toast({ title: "Program updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error updating program", description: err.message, variant: "destructive" });
    },
  });
}

