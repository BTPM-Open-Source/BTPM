/**
 * Same-workspace work-object picker (Project / Phase / Task).
 *
 * Reuses the hierarchical ReferencePicker from the comments module so that
 * blocker/risk dialogs share the exact same browse/search behavior, the
 * same protected backend reads, and the same encryption posture.
 */
import { useState } from "react";
import { Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReferencePicker } from "@/components/execution/ReferencePicker";
import type { ReferenceTargetSearchResult } from "@/hooks/useExecutionData";

interface Props {
  workspaceId: string;
  selectedKeys: Set<string>;
  onAdd: (sel: ReferenceTargetSearchResult) => void;
  triggerLabel?: string;
}

export function makeObjectKey(t: { referenced_type?: string; target_type?: string; referenced_id?: string; target_id?: string }) {
  const tt = t.referenced_type ?? t.target_type;
  const ti = t.referenced_id ?? t.target_id;
  return `${tt}:${ti}`;
}

export function WorkObjectPicker({ workspaceId, selectedKeys, onAdd, triggerLabel = "Add work item" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const handleSelect = (sel: ReferenceTargetSearchResult) => {
    const key = makeObjectKey(sel);
    if (!selectedKeys.has(key)) onAdd(sel);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs">
          <Plus className="h-3 w-3 mr-1" /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2 border-b border-border">
          <Input
            autoFocus
            placeholder="Search project / phase / task…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="relative" style={{ minHeight: 120 }}>
          {/* ReferencePicker absolutely-positions its panel — wrap so it sits inside popover */}
          <div className="relative">
            <PickerHost workspaceId={workspaceId} query={query} onSelect={handleSelect} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PickerHost({
  workspaceId,
  query,
  onSelect,
}: {
  workspaceId: string;
  query: string;
  onSelect: (sel: ReferenceTargetSearchResult) => void;
}) {
  // ReferencePicker uses absolute positioning relative to its parent; wrap in
  // a non-absolute container so it renders inline within the popover.
  return (
    <div className="relative h-[260px]">
      <ReferencePicker
        workspaceId={workspaceId}
        query={query}
        onSelect={onSelect}
        onClose={() => {}}
        placement="below"
        embedded
      />
    </div>
  );
}
