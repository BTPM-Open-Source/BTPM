/**
 * TAE.4 — Typed frontend hook for setting Task Requester and Executor
 * stakeholder relationships via the protected PMG command
 * `apply_task_stakeholder_roles_set`.
 *
 * No UI is included. Callers pass the caller-known `expectedUpdatedAt`
 * (optimistic concurrency), the desired `requesterStakeholderId`
 * (nullable), and the desired `executorStakeholderIds`. Client-side
 * normalization is limited to stable transmission (drop falsy, dedupe,
 * sort) — the server remains authoritative for containment, former-
 * stakeholder rules, and delta computation.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  parsePmgCommandResult,
  type PmgCommandResult,
  type PmgCommandStatus,
} from "@/lib/pmg/pmgContract";

export interface SetTaskStakeholderRolesInput {
  taskId: string;
  projectId: string;
  expectedUpdatedAt: string;
  requesterStakeholderId: string | null;
  executorStakeholderIds: string[];
}

export interface TaskStakeholderRolesData {
  task_id: string;
  project_id: string;
  requester_stakeholder_id: string | null;
  executor_stakeholder_ids: string[];
  requester_count: number;
  executor_count: number;
  updated_at: string;
}

export interface SetTaskStakeholderRolesOutcome {
  status: Extract<PmgCommandStatus, "applied" | "no_change">;
  data: TaskStakeholderRolesData;
}

const GENERIC_REJECTED =
  "The change was rejected. Refresh and try again.";
const CONFLICT_MESSAGE =
  "This task changed since you opened it. Refresh to see the latest and try again.";
const NOT_AUTHORIZED_MESSAGE =
  "You are not allowed to change requester or executors on this task.";
const INVALID_MESSAGES: Record<string, string> = {
  task_read_only_lifecycle:
    "This task is cancelled or archived and cannot be changed.",
  stakeholder_not_in_project:
    "One or more selected people are not stakeholders on this project.",
  former_stakeholder_cannot_be_added:
    "A former project stakeholder cannot be newly added or switched into a different role.",
  task_id_and_expected_updated_at_required:
    "Missing task identifier or timestamp. Refresh and try again.",
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Narrow, side-effect-free response mapper. Exported for unit tests.
 * Accepts only `applied` and `no_change` PMG statuses and validates the
 * required success-payload shape. Anything else throws a stable,
 * user-safe error message; internal SQL details are never surfaced.
 */
export function mapPmgResultToTaskStakeholderRolesOutcome(
  parsed: PmgCommandResult,
): SetTaskStakeholderRolesOutcome {
  if (parsed.status === "conflict") {
    throw new Error(CONFLICT_MESSAGE);
  }
  if (parsed.status === "not_authorized") {
    throw new Error(NOT_AUTHORIZED_MESSAGE);
  }
  if (parsed.status === "invalid") {
    const reason =
      isPlainObject(parsed.data) && typeof parsed.data.reason === "string"
        ? parsed.data.reason
        : null;
    throw new Error(
      (reason && INVALID_MESSAGES[reason]) || GENERIC_REJECTED,
    );
  }
  if (parsed.status !== "applied" && parsed.status !== "no_change") {
    throw new Error(GENERIC_REJECTED);
  }

  const d = parsed.data;
  const taskId = d.task_id;
  const projectId = d.project_id;
  const requesterId = d.requester_stakeholder_id;
  const execIds = d.executor_stakeholder_ids;
  const reqCount = d.requester_count;
  const execCount = d.executor_count;
  const updatedAt = d.updated_at;

  if (
    typeof taskId !== "string" ||
    typeof projectId !== "string" ||
    typeof reqCount !== "number" ||
    typeof execCount !== "number" ||
    typeof updatedAt !== "string" ||
    !Array.isArray(execIds) ||
    !execIds.every((x) => typeof x === "string")
  ) {
    throw new Error(GENERIC_REJECTED);
  }
  let requesterIdSafe: string | null;
  if (requesterId === null) {
    requesterIdSafe = null;
  } else if (typeof requesterId === "string") {
    requesterIdSafe = requesterId;
  } else {
    throw new Error(GENERIC_REJECTED);
  }


  return {
    status: parsed.status,
    data: {
      task_id: taskId,
      project_id: projectId,
      requester_stakeholder_id: requesterIdSafe,
      executor_stakeholder_ids: (execIds as string[]).slice(),
      requester_count: reqCount,
      executor_count: execCount,
      updated_at: updatedAt,
    },
  };
}

/**
 * Client-side normalization for stable transmission only: strip falsy,
 * deduplicate, sort by string order. Server re-normalizes.
 */
export function normalizeExecutorIdsForTransport(
  ids: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id && typeof id === "string") seen.add(id);
  }
  return Array.from(seen).sort();
}

export function useSetTaskStakeholderRoles() {
  const qc = useQueryClient();
  return useMutation<
    SetTaskStakeholderRolesOutcome,
    Error,
    SetTaskStakeholderRolesInput
  >({
    mutationFn: async (input) => {
      const executors = normalizeExecutorIdsForTransport(
        input.executorStakeholderIds,
      );
      const { data, error } = await supabase.rpc(
        "apply_task_stakeholder_roles_set",
        {
          _task_id: input.taskId,
          _expected_updated_at: input.expectedUpdatedAt,
          _requester_stakeholder_id: input.requesterStakeholderId,
          _executor_stakeholder_ids: executors,
        },
      );
      if (error) throw new Error(GENERIC_REJECTED);
      const parsed = parsePmgCommandResult(data);
      return mapPmgResultToTaskStakeholderRolesOutcome(parsed);
    },
    onSuccess: async (_outcome, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["task-detail", vars.taskId] }),
        qc.invalidateQueries({ queryKey: ["project-tasks", vars.projectId] }),
        qc.invalidateQueries({ queryKey: ["phase-tasks", vars.projectId] }),
        qc.invalidateQueries({
          queryKey: ["project-activity-events", vars.projectId],
        }),
        qc.invalidateQueries({ queryKey: ["team-work-overview"] }),
      ]);
    },
  });
}
