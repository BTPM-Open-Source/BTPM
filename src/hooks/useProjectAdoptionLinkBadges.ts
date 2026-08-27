/**
 * CM.7C — Derived Adoption link badges for canonical views.
 *
 * This hook does NOT introduce a new RPC. It reuses the existing
 * `useProjectAdoptionSubstrate` read (and `usePhaseTasks` for task-level
 * `is_adoption_related` / `adoption_initiative_id`) and returns lookup maps
 * keyed by object type + object id. Consumers render small "Adoption" /
 * "Adoption · <Initiative>" badges from this map.
 *
 * Source-of-truth rule: this hook NEVER duplicates canonical object data.
 * It only returns a small label payload used to render a badge.
 */
import { useMemo } from "react";
import { useProjectAdoptionSubstrate } from "@/hooks/useProjectAdoption";
import { usePhaseTasks } from "@/hooks/useProjectPlanning";

export type AdoptionBadgeObjectType = "task" | "risk" | "blocker" | "kpi";

export interface AdoptionLinkBadge {
  objectType: AdoptionBadgeObjectType;
  objectId: string;
  adoptionPlanId: string | null;
  adoptionInitiativeId: string | null;
  adoptionInitiativeName: string | null;
  /** Pre-built label, e.g. "Adoption · Communication" or "Adoption Plan". */
  label: string;
}

export interface AdoptionLinkBadgeMaps {
  hasAdoptionPlan: boolean;
  /** by object type -> map<objectId, badge> */
  byType: Record<AdoptionBadgeObjectType, Map<string, AdoptionLinkBadge>>;
  isLoading: boolean;
}

function emptyMaps(): Record<AdoptionBadgeObjectType, Map<string, AdoptionLinkBadge>> {
  return {
    task: new Map(),
    risk: new Map(),
    blocker: new Map(),
    kpi: new Map(),
  };
}

export function buildAdoptionBadgeLabel(initiativeName: string | null | undefined): string {
  return initiativeName && initiativeName.trim().length > 0
    ? `Adoption · ${initiativeName}`
    : "Adoption Plan";
}

export function useProjectAdoptionLinkBadges(
  projectId: string | undefined,
): AdoptionLinkBadgeMaps {
  const substrate = useProjectAdoptionSubstrate(projectId);
  const tasks = usePhaseTasks(projectId);

  return useMemo<AdoptionLinkBadgeMaps>(() => {
    const byType = emptyMaps();
    const initiativeNameById: Record<string, string> = {};
    for (const i of substrate.data?.initiatives ?? []) {
      if (i?.id) initiativeNameById[i.id] = i.name ?? "";
    }
    const planId = substrate.data?.adoptionPlan?.id ?? null;

    // Tasks — derived from canonical task fields. No duplication.
    for (const t of (tasks.data ?? []) as any[]) {
      if (t?.is_adoption_related === true || t?.adoption_initiative_id) {
        const initName = t.adoption_initiative_id
          ? initiativeNameById[t.adoption_initiative_id] ?? null
          : null;
        byType.task.set(t.id, {
          objectType: "task",
          objectId: t.id,
          adoptionPlanId: planId,
          adoptionInitiativeId: t.adoption_initiative_id ?? null,
          adoptionInitiativeName: initName,
          label: buildAdoptionBadgeLabel(initName),
        });
      }
    }

    // Risks / Blockers / KPIs — from adoption_object_links via substrate.
    for (const l of substrate.data?.linkedObjects ?? []) {
      const type = l.object_type as AdoptionBadgeObjectType;
      if (type !== "risk" && type !== "blocker" && type !== "kpi") continue;
      const initName = l.adoption_initiative_id
        ? initiativeNameById[l.adoption_initiative_id] ?? null
        : null;
      byType[type].set(l.object_id, {
        objectType: type,
        objectId: l.object_id,
        adoptionPlanId: planId,
        adoptionInitiativeId: l.adoption_initiative_id ?? null,
        adoptionInitiativeName: initName,
        label: buildAdoptionBadgeLabel(initName),
      });
    }

    return {
      hasAdoptionPlan: !!substrate.data?.hasAdoptionPlan,
      byType,
      isLoading: substrate.isLoading || tasks.isLoading,
    };
  }, [substrate.data, substrate.isLoading, tasks.data, tasks.isLoading]);
}
