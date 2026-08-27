import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AiInstructionTemplateRow =
  Database["public"]["Tables"]["ai_instruction_templates"]["Row"];

export type AiInstructionFeatureKey = "decision_case_brief";

export function useAiInstructionTemplates(feature: AiInstructionFeatureKey) {
  return useQuery({
    queryKey: ["ai-instruction-templates", feature],
    queryFn: async (): Promise<AiInstructionTemplateRow[]> => {
      const { data, error } = await supabase.rpc("list_ai_instruction_templates", {
        _feature_key: feature,
      });
      if (error) throw error;
      return (data ?? []) as AiInstructionTemplateRow[];
    },
  });
}

export function useCreateAiInstructionTemplateVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      feature: AiInstructionFeatureKey;
      title: string;
      instruction_text: string;
      notes: string | null;
    }) => {
      const { data, error } = await supabase.rpc(
        "create_ai_instruction_template_version",
        {
          _feature_key: input.feature,
          _title: input.title,
          _instruction_text: input.instruction_text,
          _notes: input.notes,
        },
      );
      if (error) throw error;
      return data as AiInstructionTemplateRow;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["ai-instruction-templates", v.feature] });
    },
  });
}

export function useActivateAiInstructionTemplate(feature: AiInstructionFeatureKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("activate_ai_instruction_template", {
        _id: id,
      });
      if (error) throw error;
      return data as AiInstructionTemplateRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-instruction-templates", feature] });
    },
  });
}

export function useArchiveAiInstructionTemplate(feature: AiInstructionFeatureKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("archive_ai_instruction_template", {
        _id: id,
      });
      if (error) throw error;
      return data as AiInstructionTemplateRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-instruction-templates", feature] });
    },
  });
}
