import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCreateDependency, useDeleteDependency } from "@/hooks/useProjectPlanning";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowDownLeft, ArrowUpRight, X, Plus, Link as LinkIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMemo, useState } from "react";
import { mapDependencyError } from "@/lib/dependencyConflictEngine";
import { ConceptHelp } from "@/components/knowledge/ConceptHelp";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { KC_CONCEPTS } from "@/components/knowledge/kc-concepts";

export type DepEntityType = "project" | "phase" | "task";

export interface DependencyCandidate {
  id: string;
  name: string;
  /** Optional contextual hint shown next to the name (e.g. phase name, dates) */
  hint?: string;
}

interface Props {
  entityId: string;
  entityType: DepEntityType;
  entityName: string;
  workspaceId: string;
  organizationId: string;
  candidates: DependencyCandidate[];
  canEdit: boolean;
  /** Compact = inline (used inside dialogs); default = full card-style block */
  compact?: boolean;
}

/**
 * Canonical dependency UX for Project / Phase / Task.
 * v1 semantics: same-level only, Finish-to-Start only.
 *
 * Canonical stored direction (Phase 6):
 *   source = predecessor (must finish first)
 *   target = successor   (the item that is blocked until predecessor finishes)
 *
 * From the perspective of the entity rendering this panel:
 *   - "Blocked by" = predecessors → rows where target_id = this entity (incoming edges)
 *   - "Blocks"     = successors   → rows where source_id = this entity (outgoing edges)
 *
 * Server-side rules enforced (and surfaced here):
 *   • same-level (validate_dependency_same_level)
 *   • no self-reference
 *   • unique (source_type, source_id, target_type, target_id)
 *   • no cycles (validate_dependency_no_cycle)
 *   • planning authority required for insert/update/delete (RLS)
 *   • activity log on insert/delete (log_dependency_change)
 */
export function DependencyPanel({
  entityId, entityType, entityName, workspaceId, organizationId,
  candidates, canEdit, compact = false,
}: Props) {
  const { toast } = useToast();
  const createDep = useCreateDependency();
  const deleteDep = useDeleteDependency();
  const [predecessor, setPredecessor] = useState<string>("");

  const { data: deps = [], isLoading } = useQuery({
    queryKey: ["entity-deps", entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_entity_dependencies", {
        _entity_type: entityType,
        _entity_id: entityId,
      });
      if (error) throw error;
      return (data || []) as Array<{
        id: string; source_id: string; source_type: string;
        target_id: string; target_type: string; dependency_type: string;
        updated_at: string;
      }>;

    },
    enabled: !!entityId,
  });

  // Canonical: source = predecessor, target = successor.
  // Predecessors of THIS entity = rows where this entity is the TARGET (incoming).
  // Successors  of THIS entity = rows where this entity is the SOURCE (outgoing).
  const predecessors = deps.filter((d) => d.target_id === entityId);
  const successors = deps.filter((d) => d.source_id === entityId);

  const candidatesById = useMemo(() => {
    const m: Record<string, DependencyCandidate> = {};
    for (const c of candidates) m[c.id] = c;
    return m;
  }, [candidates]);

  const linkedIds = new Set<string>([
    entityId,
    ...predecessors.map((d) => d.source_id), // the predecessor on each incoming edge
    ...successors.map((d) => d.target_id),   // the successor   on each outgoing edge
  ]);
  const available = candidates.filter((c) => !linkedIds.has(c.id));

  const handleAdd = async () => {
    if (!predecessor) return;
    try {
      // Add: this entity is BLOCKED BY `predecessor`.
      // Canonical encoding: source = predecessor (must finish first), target = this entity (successor).
      await createDep.mutateAsync({
        source_id: predecessor,
        source_type: entityType,
        target_id: entityId,
        target_type: entityType,
        dependency_type: "finish_to_start",
        workspace_id: workspaceId,
        organization_id: organizationId,
      });
      setPredecessor("");
      toast({ title: "Dependency added", description: `Blocked by ${candidatesById[predecessor]?.name ?? "item"}` });
    } catch (e: any) {
      toast({ title: "Could not add dependency", description: mapDependencyError(e), variant: "destructive" });
    }
  };

  const handleRemove = async (id: string, expectedUpdatedAt: string, otherName: string) => {
    try {
      await deleteDep.mutateAsync({ id, expected_updated_at: expectedUpdatedAt });
      toast({ title: "Dependency removed", description: otherName });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };


  const wrapperClass = compact
    ? "space-y-3"
    : "border border-border rounded-lg p-4 space-y-3 bg-card";

  return (
    <div className={wrapperClass}>
      {!compact && (
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <LinkIcon className="h-4 w-4" /> Dependencies
            <ConceptHelp
              term={KC_CONCEPTS.dependency.term}
              shortText={KC_CONCEPTS.dependency.shortText}
              articleSlug={KC_CONCEPTS.dependency.slug}
            />
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {entityType} · Finish-to-Start · same level
            </span>
            <KnowledgeLink slug="how-to-add-a-dependency" label="How to add" />
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : deps.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No dependencies. <span className="italic">{entityName}</span> is not blocked by and does not block any other {entityType}.
        </p>
      ) : (
        <div className="space-y-3">
          {predecessors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <ArrowDownLeft className="h-3.5 w-3.5" /> Blocked by ({predecessors.length})
              </p>
              <ul className="space-y-1">
                {predecessors.map((d) => {
                  // Predecessor on an incoming edge is the SOURCE side.
                  const c = candidatesById[d.source_id];
                  const name = c?.name ?? d.source_id.slice(0, 8);
                  return (
                    <li key={d.id} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="text-[10px] uppercase">FS</Badge>
                      <span className="truncate flex-1">
                        {name}
                        {c?.hint && <span className="text-muted-foreground ml-1 text-xs">· {c.hint}</span>}
                      </span>
                      {canEdit && (
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6"
                          onClick={() => handleRemove(d.id, d.updated_at, name)}

                          aria-label={`Remove dependency on ${name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {successors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <ArrowUpRight className="h-3.5 w-3.5" /> Blocks ({successors.length})
              </p>
              <ul className="space-y-1">
                {successors.map((d) => {
                  // Successor on an outgoing edge is the TARGET side.
                  const c = candidatesById[d.target_id];
                  const name = c?.name ?? d.target_id.slice(0, 8);
                  return (
                    <li key={d.id} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="text-[10px] uppercase">FS</Badge>
                      <span className="truncate flex-1">
                        {name}
                        {c?.hint && <span className="text-muted-foreground ml-1 text-xs">· {c.hint}</span>}
                      </span>
                      {canEdit && (
                        <Button
                          variant="ghost" size="icon" className="h-6 w-6"
                          onClick={() => handleRemove(d.id, d.updated_at, name)}
                          aria-label={`Remove dependency from ${name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <div className="pt-2 border-t border-border/50 space-y-2">
          <p className="text-xs text-muted-foreground">
            Add a predecessor — an item that must <strong>finish before</strong> this {entityType} starts.
          </p>
          <div className="flex gap-2">
            <Select value={predecessor} onValueChange={setPredecessor}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder={available.length ? `Choose a ${entityType} that blocks this one…` : `No other ${entityType}s available`} />
              </SelectTrigger>
              <SelectContent>
                {available.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.hint && <span className="text-muted-foreground ml-1 text-xs">· {c.hint}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm" variant="outline" className="h-8"
              onClick={handleAdd}
              disabled={!predecessor || createDep.isPending || available.length === 0}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Blocked by
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
