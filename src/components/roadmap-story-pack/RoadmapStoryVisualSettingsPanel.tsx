/**
 * Phase 6B.7b.2 — Roadmap Story Visual Settings panel.
 *
 * Replaces the passive Visual Template Library. Each implemented visual
 * template exposes:
 *   • Include toggle — controls whether the visual is allowed/required
 *     in the generated Story.
 *   • Narrative toggle (narrative-capable blocks only) — controls whether
 *     the explanatory "What this means" / implication / action text may
 *     appear for that block.
 *
 * Settings persist per Story Pack via SECURITY DEFINER RPCs. Save state
 * is a manual explicit action to avoid noisy autosave calls; changes
 * take effect on the next AI Blueprint regeneration and are also
 * enforced deterministically at overlay/validation time.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  FileText,
  Gauge,
  Layers,
  Loader2,
  Megaphone,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import {
  ROADMAP_STORY_PRESENTATION_TEMPLATES,
  TEMPLATE_FAMILY_LABELS,
  type RoadmapStoryPresentationTemplate,
  type RoadmapStoryPresentationTemplateKey,
} from "@/lib/roadmap-story/roadmapStoryPresentationTemplates";
import {
  buildDefaultRoadmapStoryVisualSettings,
  isNarrativeCapableBlockType,
  ROADMAP_STORY_VISUAL_SETTINGS_SCHEMA_VERSION,
  type RoadmapStoryVisualSettings,
} from "@/lib/roadmap-story/roadmapStoryVisualSettings";
import {
  useRoadmapStoryVisualSettings,
  useUpdateRoadmapStoryVisualSettings,
} from "@/hooks/useRoadmapStoryVisualSettings";

const FAMILY_ICON: Record<RoadmapStoryPresentationTemplate["family"], React.ComponentType<{ className?: string }>> = {
  executive_message: Sparkles,
  metrics_signals: Activity,
  portfolio: Layers,
  timeline: CheckCircle2,
  charts: BarChart3,
  risk_decision: ShieldAlert,
  kpi: Gauge,
  evidence: FileText,
};

interface Props {
  storyPackId: string;
  /** Block types currently present in the deterministic blueprint. Anything
   *  outside this set is shown but marked "unavailable" (Include forced off). */
  availableBlockTypes: string[];
  isArchived?: boolean;
}

export function RoadmapStoryVisualSettingsPanel({
  storyPackId,
  availableBlockTypes,
  isArchived = false,
}: Props) {
  const query = useRoadmapStoryVisualSettings(storyPackId);
  const update = useUpdateRoadmapStoryVisualSettings(storyPackId);
  const [draft, setDraft] = useState<RoadmapStoryVisualSettings | null>(null);

  const availabilitySet = useMemo(
    () => new Set(availableBlockTypes),
    [availableBlockTypes],
  );

  useEffect(() => {
    if (query.data?.resolved && !draft) {
      setDraft(query.data.resolved);
    }
  }, [query.data?.resolved, draft]);

  const active = draft ?? query.data?.resolved ?? buildDefaultRoadmapStoryVisualSettings();

  const dirty = useMemo(() => {
    if (!draft || !query.data?.resolved) return false;
    return JSON.stringify(draft.blocks) !== JSON.stringify(query.data.resolved.blocks);
  }, [draft, query.data?.resolved]);

  const grouped = useMemo(() => {
    const map = new Map<RoadmapStoryPresentationTemplate["family"], RoadmapStoryPresentationTemplate[]>();
    for (const t of ROADMAP_STORY_PRESENTATION_TEMPLATES) {
      const arr = map.get(t.family) ?? [];
      arr.push(t);
      map.set(t.family, arr);
    }
    return map;
  }, []);

  const setBlock = (
    id: RoadmapStoryPresentationTemplateKey,
    patch: Partial<{ include: boolean; narrative: boolean }>,
  ) => {
    setDraft((prev) => {
      const base = prev ?? active;
      const cur = base.blocks[id];
      const nextInclude = patch.include ?? cur.include;
      const canNarrate = isNarrativeCapableBlockType(id) && nextInclude;
      const nextNarrative = canNarrate
        ? (patch.narrative ?? cur.narrative)
        : false;
      return {
        ...base,
        schemaVersion: ROADMAP_STORY_VISUAL_SETTINGS_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        blocks: {
          ...base.blocks,
          [id]: { include: nextInclude, narrative: nextNarrative },
        },
      };
    });
  };

  const applyBulk = (
    fn: (
      t: RoadmapStoryPresentationTemplate,
    ) => { include: boolean; narrative: boolean },
  ) => {
    setDraft((prev) => {
      const base = prev ?? active;
      const blocks = { ...base.blocks };
      for (const t of ROADMAP_STORY_PRESENTATION_TEMPLATES) {
        blocks[t.id] = fn(t);
      }
      return {
        ...base,
        schemaVersion: ROADMAP_STORY_VISUAL_SETTINGS_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        blocks,
      };
    });
  };

  const handleSelectAllAvailable = () =>
    applyBulk((t) => ({
      include: availabilitySet.has(t.id) || t.id === "source_limitations_footer",
      narrative: isNarrativeCapableBlockType(t.id),
    }));
  const handleClearAll = () =>
    applyBulk(() => ({ include: false, narrative: false }));
  const handleResetRecommended = () =>
    setDraft(buildDefaultRoadmapStoryVisualSettings());
  const handleNarrativesOn = () =>
    setDraft((prev) => {
      const base = prev ?? active;
      const blocks = { ...base.blocks };
      for (const t of ROADMAP_STORY_PRESENTATION_TEMPLATES) {
        if (blocks[t.id].include && isNarrativeCapableBlockType(t.id)) {
          blocks[t.id] = { ...blocks[t.id], narrative: true };
        }
      }
      return { ...base, blocks, updatedAt: new Date().toISOString() };
    });
  const handleNarrativesOff = () =>
    setDraft((prev) => {
      const base = prev ?? active;
      const blocks = { ...base.blocks };
      for (const t of ROADMAP_STORY_PRESENTATION_TEMPLATES) {
        if (isNarrativeCapableBlockType(t.id)) {
          blocks[t.id] = { ...blocks[t.id], narrative: false };
        }
      }
      return { ...base, blocks, updatedAt: new Date().toISOString() };
    });

  const handleSave = () => {
    if (!draft) return;
    update.mutate(draft, {
      onSuccess: () => {
        toast({
          title: "Visual settings saved",
          description: "Regenerate the presentation blueprint to apply.",
        });
      },
      onError: (e) => {
        toast({
          variant: "destructive",
          title: "Could not save visual settings",
          description: e.message,
        });
      },
    });
  };

  const handleDiscard = () => {
    if (query.data?.resolved) setDraft(query.data.resolved);
  };

  const disabled = isArchived || update.isPending;

  return (
    <Card className="border-[#E1E1DC] bg-white shadow-none">
      <CardHeader className="pb-3 border-b border-[#E1E1DC]">
        <div className="flex items-center gap-2">
          <span className="h-3 w-[3px] rounded-sm bg-[#ED1C38]" aria-hidden />
          <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[#516490]">
            Per-Story visual settings
          </span>
        </div>
        <CardTitle className="text-base font-semibold tracking-tight text-[#1C1F3F] flex items-center gap-2 mt-1">
          <BarChart3 className="h-4 w-4 text-[#ED1C38]" />
          Visual settings
          <Badge variant="outline" className="text-[10px] border-[#1C1F3F]/30 text-[#1C1F3F] bg-white">
            {ROADMAP_STORY_PRESENTATION_TEMPLATES.length} implemented
          </Badge>
        </CardTitle>
        <p className="text-[12px] text-[#516490] max-w-2xl leading-relaxed">
          Choose which BTPM-rendered visuals the AI must include in this
          Story. Turn <span className="font-semibold text-[#1C1F3F]">Narrative</span> off
          if you want a numbers / status-focused presentation without
          explanatory text blocks. BTPM enforces these settings on top of
          the AI output — the AI never returns HTML, CSS, SVG, or chart
          images; all visuals render from structured source data.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleSelectAllAvailable} disabled={disabled}>
            Select all available
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={handleClearAll} disabled={disabled}>
            Clear all
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={handleResetRecommended} disabled={disabled}>
            <RotateCcw className="h-3 w-3" /> Reset recommended
          </Button>
          <span className="mx-1 h-4 w-px bg-[#E1E1DC]" aria-hidden />
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={handleNarrativesOn} disabled={disabled}>
            Narratives on for included
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={handleNarrativesOff} disabled={disabled}>
            Narratives off for included
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {query.isLoading && (
              <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </span>
            )}
            {dirty && (
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={handleDiscard} disabled={disabled}>
                Discard
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={disabled || !dirty}
              className="h-7 gap-1 text-[11px]"
            >
              {update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save settings
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {Array.from(grouped.entries()).map(([family, templates]) => {
          const Icon = FAMILY_ICON[family];
          return (
            <div key={family} className="rounded-md border border-[#E1E1DC] bg-white overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[#E1E1DC] bg-[#F2F2F2] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#1C1F3F]">
                <Icon className="h-3.5 w-3.5 text-[#ED1C38]" />
                {TEMPLATE_FAMILY_LABELS[family]}
              </div>
              <ul className="divide-y divide-[#E1E1DC]">
                {templates.map((t) => {
                  const setting = active.blocks[t.id];
                  const narrativeCapable = isNarrativeCapableBlockType(t.id);
                  // A template is "available" if it is present in the current
                  // deterministic blueprint OR is one of the metadata blocks
                  // (limitations footer) that BTPM can always synthesise.
                  const alwaysAvailable = t.id === "source_limitations_footer";
                  const available = alwaysAvailable || availabilitySet.has(t.id);
                  return (
                    <li key={t.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] font-semibold text-[#1C1F3F]">{t.name}</span>
                          <span className="text-[10px] font-mono text-[#516490]">{t.id}</span>
                          {!available && (
                            <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-[#EAC16D] text-[#7A5512] bg-[#FFF9EA]">
                              Unavailable
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-[#516490]">{t.purpose}</div>
                        {t.dataCategories.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {t.dataCategories.map((c) => (
                              <Badge
                                key={c}
                                variant="outline"
                                className="h-4 px-1.5 text-[9px] border-[#E1E1DC] text-[#516490] bg-[#F8F8F6]"
                              >
                                {c}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#516490]">
                          Include
                          <Switch
                            checked={setting.include && available}
                            disabled={disabled || !available}
                            onCheckedChange={(v) => setBlock(t.id, { include: !!v })}
                          />
                        </label>
                        {narrativeCapable && (
                          <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#516490]">
                            Narrative
                            <Switch
                              checked={setting.narrative && setting.include && available}
                              disabled={disabled || !available || !setting.include}
                              onCheckedChange={(v) => setBlock(t.id, { narrative: !!v })}
                            />
                          </label>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        <div className="flex items-center gap-2 text-[10px] text-[#516490]">
          <Megaphone className="h-3 w-3 text-[#ED1C38]" />
          Changes take effect the next time you generate the presentation
          blueprint. BTPM also enforces Include/Narrative settings on the
          AI output, so nothing you turned off can slip back in.
        </div>
      </CardContent>
    </Card>
  );
}

export default RoadmapStoryVisualSettingsPanel;
