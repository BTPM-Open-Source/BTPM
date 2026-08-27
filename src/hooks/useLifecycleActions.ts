// Wave 5 Step 5.5 — Lifecycle React hooks.
//
// Thin wrappers around lifecycleService that integrate React Query
// invalidations and toast feedback. Every business-object lifecycle
// surface (Program, Project, Phase, Task, Template, Sprint, Backlog,
// Workflow State, KPI Definition) MUST go through these hooks.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  archiveTarget,
  unarchiveTarget,
  hardDeleteTarget,
  type LifecycleTargetType,
} from "@/lib/lifecycleService";
import { toast } from "sonner";

interface BaseVars {
  id: string;
  /** Optional invalidation hints to refresh lists after the action. */
  invalidate?: (string | string[])[];
}

function useInvalidator() {
  const qc = useQueryClient();
  return (keys?: (string | string[])[]) => {
    if (!keys) return;
    keys.forEach((k) => qc.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
  };
}

export function useArchiveTarget(target: LifecycleTargetType) {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: ({ id }: BaseVars) => archiveTarget(target, id),
    onSuccess: (_d, vars) => {
      invalidate(vars.invalidate);
      toast.success("Archived");
    },
    onError: (e: any) => toast.error(e?.message || "Archive failed"),
  });
}

export function useUnarchiveTarget(target: LifecycleTargetType) {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: ({ id }: BaseVars) => unarchiveTarget(target, id),
    onSuccess: (_d, vars) => {
      invalidate(vars.invalidate);
      toast.success("Restored");
    },
    onError: (e: any) => toast.error(e?.message || "Restore failed"),
  });
}

export function useHardDeleteTarget(target: LifecycleTargetType) {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: ({ id }: BaseVars) => hardDeleteTarget(target, id),
    onSuccess: (res, vars) => {
      invalidate(vars.invalidate);
      const parts: string[] = ["Permanently deleted"];
      if (res.storage_deleted > 0) parts.push(`${res.storage_deleted} file(s) removed`);
      if (res.metadata_deleted > 0) parts.push(`${res.metadata_deleted} attachment record(s) cleaned`);
      toast.success(parts.join(" · "));
    },
    onError: (e: any) => {
      const msg = e?.message || "Delete failed";
      // Surface the most common Step 5.3 / 5.5 server errors clearly.
      if (msg.includes("must be archived")) {
        toast.error("Object must be archived before it can be permanently deleted.");
      } else if (msg.includes("Forbidden") || msg.includes("admin")) {
        toast.error("Only an Organization Admin can permanently delete this.");
      } else if (msg.includes("LIFECYCLE_BLOCKED_ATTACHMENTS")) {
        toast.error("Attachments are still present. Please retry — file cleanup will run again.");
      } else {
        toast.error(msg);
      }
    },
  });
}
