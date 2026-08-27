import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AiModelRegistryRow = Database["public"]["Tables"]["ai_model_registry"]["Row"];
export type AiFeatureSettingsRow = Database["public"]["Tables"]["ai_feature_settings"]["Row"];
export type AiFeatureKey = "btpm_guide" | "decision_cases" | "roadmap_story";

export function useAiModelRegistry() {
  return useQuery({
    queryKey: ["ai-model-registry"],
    queryFn: async (): Promise<AiModelRegistryRow[]> => {
      const { data, error } = await supabase.rpc("list_ai_model_registry");
      if (error) throw error;
      return (data ?? []) as AiModelRegistryRow[];
    },
  });
}

export function useAiFeatureSettings() {
  return useQuery({
    queryKey: ["ai-feature-settings"],
    queryFn: async (): Promise<AiFeatureSettingsRow[]> => {
      const { data, error } = await supabase.rpc("get_ai_feature_settings");
      if (error) throw error;
      return (data ?? []) as AiFeatureSettingsRow[];
    },
  });
}

export interface UpdateAiFeatureSettingInput {
  feature_key: AiFeatureKey;
  model_registry_id: string;
  enabled: boolean;
  reasoning_effort: "low" | "medium" | "high" | null;
  max_files_per_request: number | null;
  max_individual_file_mb: number | null;
  max_total_file_mb: number | null;
  require_user_confirmation: boolean;
}

export function useUpdateAiFeatureSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAiFeatureSettingInput) => {
      const { data, error } = await supabase.rpc("update_ai_feature_setting", {
        _feature_key: input.feature_key,
        _model_registry_id: input.model_registry_id,
        _enabled: input.enabled,
        _reasoning_effort: input.reasoning_effort,
        _max_files_per_request: input.max_files_per_request,
        _max_individual_file_mb: input.max_individual_file_mb,
        _max_total_file_mb: input.max_total_file_mb,
        _require_user_confirmation: input.require_user_confirmation,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-feature-settings"] });
    },
  });
}
