/**
 * AI.6 — Decision Case AI run audit-trail hooks.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  discardDecisionCaseAiRun,
  listDecisionCaseAiRuns,
  saveAiDecisionBriefVersion,
  type DecisionCaseAiBriefStructuredFields,
  type DecisionCaseAiRun,
} from "@/lib/decisionCaseAiBriefService";

const key = (recordId: string) => ["decision-case-ai-runs", recordId] as const;

export function useDecisionCaseAiRuns(recordId: string | null | undefined) {
  return useQuery({
    queryKey: key(recordId ?? ""),
    enabled: !!recordId,
    queryFn: async (): Promise<DecisionCaseAiRun[]> => {
      if (!recordId) return [];
      return await listDecisionCaseAiRuns(recordId);
    },
  });
}

export function useSaveAiDecisionBriefVersion(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      aiRunId: string;
      editedBriefText: string;
      makeCurrent?: boolean;
      structuredFields?: Partial<DecisionCaseAiBriefStructuredFields> | null;
    }) => {
      return await saveAiDecisionBriefVersion({
        recordId,
        aiRunId: args.aiRunId,
        editedBriefText: args.editedBriefText,
        makeCurrent: args.makeCurrent,
        structuredFields: args.structuredFields,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key(recordId) });
      qc.invalidateQueries({ queryKey: ["governance-record-brief-versions", recordId] });
    },
  });
}

export function useDiscardDecisionCaseAiRun(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (aiRunId: string) => {
      await discardDecisionCaseAiRun(aiRunId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key(recordId) });
    },
  });
}
