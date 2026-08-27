import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import {
  useAiFeatureSettings,
  useAiModelRegistry,
  useUpdateAiFeatureSetting,
  type AiFeatureKey,
  type AiFeatureSettingsRow,
  type AiModelRegistryRow,
} from "@/hooks/useAiSettings";
import { DecisionCaseEvidenceDiagnostic } from "@/components/admin/DecisionCaseEvidenceDiagnostic";
import { DecisionBriefInstructionTemplates } from "@/components/admin/DecisionBriefInstructionTemplates";

type Draft = {
  model_registry_id: string;
  enabled: boolean;
  reasoning_effort: "low" | "medium" | "high" | "none";
  max_files_per_request: string;
  max_individual_file_mb: string;
  max_total_file_mb: string;
  require_user_confirmation: boolean;
};

function rowToDraft(row: AiFeatureSettingsRow): Draft {
  return {
    model_registry_id: row.model_registry_id,
    enabled: row.enabled,
    reasoning_effort: (row.reasoning_effort ?? "none") as Draft["reasoning_effort"],
    max_files_per_request: row.max_files_per_request?.toString() ?? "",
    max_individual_file_mb: row.max_individual_file_mb?.toString() ?? "",
    max_total_file_mb: row.max_total_file_mb?.toString() ?? "",
    require_user_confirmation: row.require_user_confirmation,
  };
}

function parseIntOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

interface FeatureCardProps {
  feature: AiFeatureKey;
  title: string;
  helper: string;
  showLimits: boolean;
  showConfirm: boolean;
  showReasoning: boolean;
  row: AiFeatureSettingsRow | undefined;
  models: AiModelRegistryRow[];
}

function FeatureCard({ feature, title, helper, showLimits, showConfirm, showReasoning, row, models }: FeatureCardProps) {
  const update = useUpdateAiFeatureSetting();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (row) setDraft(rowToDraft(row));
  }, [row]);

  if (!draft || !row) return <Skeleton className="h-64 w-full" />;

  const onSave = async () => {
    try {
      await update.mutateAsync({
        feature_key: feature,
        model_registry_id: draft.model_registry_id,
        enabled: draft.enabled,
        reasoning_effort: showReasoning && draft.reasoning_effort !== "none" ? draft.reasoning_effort : null,
        max_files_per_request: showLimits ? parseIntOrNull(draft.max_files_per_request) : null,
        max_individual_file_mb: showLimits ? parseIntOrNull(draft.max_individual_file_mb) : null,
        max_total_file_mb: showLimits ? parseIntOrNull(draft.max_total_file_mb) : null,
        require_user_confirmation: showConfirm ? draft.require_user_confirmation : false,
      });
      toast({ title: "Saved", description: `${title} settings updated.` });
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message ?? "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{helper}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${feature}-enabled`}>Enabled</Label>
          <Switch
            id={`${feature}-enabled`}
            checked={draft.enabled}
            onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
          />
        </div>

        <div className="space-y-2">
          <Label>Provider</Label>
          <Input value="OpenAI API" disabled />
        </div>

        <div className="space-y-2">
          <Label>Model</Label>
          <Select
            value={draft.model_registry_id}
            onValueChange={(v) => setDraft({ ...draft, model_registry_id: v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.display_name} — {m.capability_tier.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showReasoning && (
          <div className="space-y-2">
            <Label>Reasoning effort</Label>
            <Select
              value={draft.reasoning_effort}
              onValueChange={(v) => setDraft({ ...draft, reasoning_effort: v as Draft["reasoning_effort"] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Default</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {showLimits && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Max files / request</Label>
              <Input
                type="number"
                min={1}
                value={draft.max_files_per_request}
                onChange={(e) => setDraft({ ...draft, max_files_per_request: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Max individual file (MB)</Label>
              <Input
                type="number"
                min={1}
                value={draft.max_individual_file_mb}
                onChange={(e) => setDraft({ ...draft, max_individual_file_mb: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Max total size (MB)</Label>
              <Input
                type="number"
                min={1}
                value={draft.max_total_file_mb}
                onChange={(e) => setDraft({ ...draft, max_total_file_mb: e.target.value })}
              />
            </div>
          </div>
        )}

        {showConfirm && (
          <div className="flex items-center justify-between">
            <Label htmlFor={`${feature}-confirm`}>Require user confirmation</Label>
            <Switch
              id={`${feature}-confirm`}
              checked={draft.require_user_confirmation}
              onCheckedChange={(v) => setDraft({ ...draft, require_user_confirmation: v })}
            />
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminAiSettings() {
  const registry = useAiModelRegistry();
  const settings = useAiFeatureSettings();

  const models = registry.data ?? [];
  const settingsByKey = useMemo(() => {
    const map = new Map<AiFeatureKey, AiFeatureSettingsRow>();
    (settings.data ?? []).forEach((s) => map.set(s.feature_key as AiFeatureKey, s));
    return map;
  }, [settings.data]);

  if (registry.isLoading || settings.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">AI Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure which AI model BTPM uses for each AI-powered capability. API keys remain stored as backend secrets and are never shown here.
        </p>
      </div>

      <FeatureCard
        feature="btpm_guide"
        title="BTPM Guide"
        helper="Controls the model used by the BTPM Guide once runtime wiring is enabled. Existing fallback secret behavior remains unchanged until the Guide is wired to this setting."
        showLimits={false}
        showConfirm={false}
        showReasoning={true}
        row={settingsByKey.get("btpm_guide")}
        models={models}
      />

      <FeatureCard
        feature="decision_cases"
        title="Decision Cases"
        helper="Controls the model and limits for Decision Case AI workflows, including evidence reading and future AI decision brief generation."
        showLimits={true}
        showConfirm={true}
        showReasoning={true}
        row={settingsByKey.get("decision_cases")}
        models={models}
      />

      <FeatureCard
        feature="roadmap_story"
        title="Roadmap Story Pack"
        helper="Controls the model used for future Roadmap Story Pack narrative generation and evidence synthesis. AI runtime is not yet wired; this setting is staged for an upcoming step."
        showLimits={true}
        showConfirm={true}
        showReasoning={true}
        row={settingsByKey.get("roadmap_story")}
        models={models}
      />

      <DecisionCaseEvidenceDiagnostic
        decisionCasesSetting={settingsByKey.get("decision_cases")}
      />

      <DecisionBriefInstructionTemplates />
    </div>
  );
}
