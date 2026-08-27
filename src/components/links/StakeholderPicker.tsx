/**
 * Project Stakeholders picker.
 *
 * Sourced from `list_project_stakeholders` (project-scoped) and returns
 * either a stakeholder_id link (any active stakeholder, internal or external).
 * Used by Blocker / Risk "People involved" fields so that externals (e.g. SteerCo
 * members from EQT) can be linked alongside workspace members.
 */
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useProjectStakeholders } from "@/hooks/useProjectStakeholders";
import type { DraftPersonLink } from "@/lib/entityLinks";

interface Props {
  projectId: string;
  selectedStakeholderIds: string[];
  onAdd: (person: DraftPersonLink) => void;
  triggerLabel?: string;
}

export function StakeholderPicker({
  projectId,
  selectedStakeholderIds,
  onAdd,
  triggerLabel = "Add person",
}: Props) {
  const { data: stakeholders = [], isLoading } = useProjectStakeholders(projectId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const candidates = useMemo(() => {
    const taken = new Set(selectedStakeholderIds);
    const q = query.trim().toLowerCase();
    return stakeholders
      .filter((s) => !s.removed_at)
      .filter((s) => !taken.has(s.id))
      .filter((s) => (q ? (s.display_name ?? "").toLowerCase().includes(q) : true));
  }, [stakeholders, selectedStakeholderIds, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs">
          <Plus className="h-3 w-3 mr-1" /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="p-2 border-b border-border flex items-center gap-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <Input
            autoFocus
            placeholder="Search project stakeholders…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-1"
          />
        </div>
        <div className="max-h-56 overflow-y-auto py-1">
          {isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>}
          {!isLoading && candidates.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No matching stakeholders. Add them in the project Stakeholders panel first.
            </p>
          )}
          {candidates.map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-foreground flex items-center gap-2"
              onClick={() => {
                onAdd({
                  user_id: null,
                  stakeholder_id: s.id,
                  stakeholder_type: s.stakeholder_type,
                  display_name: s.display_name,
                });
                setQuery("");
                setOpen(false);
              }}
            >
              <span className="truncate flex-1">{s.display_name}</span>
              <Badge
                variant={s.stakeholder_type === "workspace_member" ? "secondary" : "outline"}
                className="text-[10px] shrink-0"
              >
                {s.stakeholder_type === "workspace_member" ? "Member" : "External"}
              </Badge>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
