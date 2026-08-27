/**
 * Same-workspace people picker.
 *
 * Wraps the existing decrypted ws_list_members RPC (via useWorkspaceMembers).
 * Only workspace members are returned — no org-wide search, no cross-workspace.
 * Used for blocker/risk "People involved" structured fields.
 */
import { useState, useMemo } from "react";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";

interface Props {
  workspaceId: string;
  selectedUserIds: string[];
  onAdd: (user: { user_id: string; display_name: string | null }) => void;
  triggerLabel?: string;
}

export function PeoplePicker({ workspaceId, selectedUserIds, onAdd, triggerLabel = "Add person" }: Props) {
  const { data: members = [], isLoading } = useWorkspaceMembers(workspaceId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const candidates = useMemo(() => {
    const taken = new Set(selectedUserIds);
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => !taken.has(m.id))
      .filter((m) => (q ? m.display_name.toLowerCase().includes(q) : true));
  }, [members, selectedUserIds, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs">
          <Plus className="h-3 w-3 mr-1" /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-2 border-b border-border flex items-center gap-1">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <Input
            autoFocus
            placeholder="Search workspace members…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-1"
          />
        </div>
        <div className="max-h-56 overflow-y-auto py-1">
          {isLoading && <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>}
          {!isLoading && candidates.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No matching members.</p>
          )}
          {candidates.map((m) => (
            <button
              key={m.id}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-foreground"
              onClick={() => {
                onAdd({ user_id: m.id, display_name: m.display_name });
                setQuery("");
                setOpen(false);
              }}
            >
              {m.display_name}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
