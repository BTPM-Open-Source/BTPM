import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronsUpDown, Building2, Globe, Settings, Plus } from "lucide-react";
import { useActiveWorkspace } from "@/context/ActiveWorkspaceContext";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/**
 * Scope Selector (UX-1.2B)
 * Adds first-class "All workspaces" option for multi-workspace users.
 * No fake aggregation — All workspaces only navigates to the existing
 * workspaces list at "/".
 */
export function ScopeSelector() {
  const {
    activeScope,
    activeWorkspace,
    activeWorkspaceId,
    workspaces,
    isLoading,
    setActiveWorkspaceId,
    setScopeAll,
  } = useActiveWorkspace();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const isAll = activeScope.type === "all";

  const label = isLoading
    ? "Loading…"
    : isAll
      ? "All workspaces"
      : activeWorkspace?.name ?? (workspaces.length === 0 ? "No workspace access" : "Select workspace");

  const Icon = isAll ? Globe : Building2;

  const handleSelectWorkspace = (id: string) => {
    setOpen(false);
    if (!isAll && id === activeWorkspaceId) return;
    setActiveWorkspaceId(id);
  };

  const handleSelectAll = () => {
    setOpen(false);
    if (isAll) return;
    setScopeAll();
  };

  const handleManage = () => {
    setOpen(false);
    navigate("/");
  };

  const handleCreate = () => {
    setOpen(false);
    navigate("/?create=workspace");
  };

  return (
    <div className="rounded-md border border-sidebar-border/60 bg-sidebar-accent/20">
      <div className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
        Workspace
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={isLoading}
            className="w-full justify-between gap-2 text-left text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            aria-label="Workspace scope selector"
          >
            <span className="flex items-center gap-2 min-w-0">
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate text-sm font-medium">{label}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search workspace..." />
            <CommandList>
              <CommandEmpty>No workspaces.</CommandEmpty>
              <CommandGroup>
                <CommandItem value="__all__" onSelect={handleSelectAll}>
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      isAll ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <Globe className="mr-2 h-4 w-4 opacity-70" />
                  <span>All workspaces</span>
                </CommandItem>
              </CommandGroup>
              {workspaces.length > 0 && (
                <>
                  <CommandSeparator />
                  <CommandGroup heading="Your workspaces">
                    {workspaces.map((w) => (
                      <CommandItem
                        key={w.id}
                        value={w.name}
                        onSelect={() => handleSelectWorkspace(w.id)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            !isAll && w.id === activeWorkspaceId
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        <span className="truncate">{w.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
              <CommandSeparator />
              <CommandGroup heading="Workspace management">
                <CommandItem value="__manage__" onSelect={handleManage}>
                  <Settings className="mr-2 h-4 w-4 opacity-70" />
                  <span>Manage workspaces</span>
                </CommandItem>
                <CommandItem value="__create__" onSelect={handleCreate}>
                  <Plus className="mr-2 h-4 w-4 opacity-70" />
                  <span>Create workspace</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
