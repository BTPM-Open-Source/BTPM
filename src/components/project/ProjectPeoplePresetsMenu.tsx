/**
 * WPP.5 — Project-level "People presets" menu.
 *
 * One compact, discoverable entry point rendered from the Project Team
 * header. Contains exactly two actions:
 *   1. Apply preset               → ApplyProjectPeoplePresetDialog
 *   2. Save current people as preset → SaveProjectPeoplePresetDialog
 *
 * Both actions are gated behind the existing Project Team edit authority
 * (`canEdit`). "Save" is additionally disabled when the project has no
 * active team members or stakeholders.
 */
import { useState } from "react";
import { BookmarkPlus, Bookmark, Users2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SaveProjectPeoplePresetDialog } from "@/components/project/SaveProjectPeoplePresetDialog";
import { ApplyProjectPeoplePresetDialog } from "@/components/project/ApplyProjectPeoplePresetDialog";

interface Props {
  projectId: string;
  workspaceId: string;
  canEdit: boolean;
  activeTeamCount: number;
  activeStakeholderCount: number;
}

export function ProjectPeoplePresetsMenu({
  projectId, workspaceId, canEdit,
  activeTeamCount, activeStakeholderCount,
}: Props) {
  const [applyOpen, setApplyOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  if (!canEdit) return null;

  const canSave = activeTeamCount + activeStakeholderCount > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            aria-label="People presets"
          >
            <Users2 className="h-4 w-4 mr-1" />
            People presets
            <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>People presets</DropdownMenuLabel>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setApplyOpen(true); }}>
            <Bookmark className="h-4 w-4 mr-2" />
            Apply preset
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canSave}
            onSelect={(e) => { e.preventDefault(); if (canSave) setSaveOpen(true); }}
          >
            <BookmarkPlus className="h-4 w-4 mr-2" />
            Save current people as preset
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ApplyProjectPeoplePresetDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        projectId={projectId}
        workspaceId={workspaceId}
      />
      <SaveProjectPeoplePresetDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        projectId={projectId}
        workspaceId={workspaceId}
        activeTeamCount={activeTeamCount}
        activeStakeholderCount={activeStakeholderCount}
      />
    </>
  );
}
