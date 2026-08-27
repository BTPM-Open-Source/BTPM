// Wave 5 Step 5.5 — Reusable lifecycle action cluster.
//
// Renders Archive / Unarchive (PM+) and an admin-only Permanent-Delete
// affordance with archived-first guard and confirm dialog. Used across
// detail surfaces (Project, Phase, Task, KPI, Sprint, etc.) so the
// product never ships a one-off lifecycle path.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import {
  useArchiveTarget,
  useUnarchiveTarget,
  useHardDeleteTarget,
} from "@/hooks/useLifecycleActions";
import { HardDeleteConfirmDialog } from "./HardDeleteConfirmDialog";
import type { LifecycleTargetType } from "@/lib/lifecycleService";

interface Props {
  target: LifecycleTargetType;
  id: string;
  name: string;
  isArchived: boolean;
  /** PM+ in this workspace — controls Archive/Unarchive visibility. */
  canArchive: boolean;
  /** Org admin — controls Permanent Delete visibility. */
  canHardDelete: boolean;
  /** Optional cascade explanation for the confirm dialog. */
  cascadeDescription?: string;
  /** Require typing the name (used for project/program/phase). */
  requireTypeName?: boolean;
  /** React Query keys to invalidate after each action. */
  invalidate?: (string | string[])[];
  /** Called after a successful hard-delete (for navigation, etc.). */
  onAfterHardDelete?: () => void;
  /** Visual size for the button row. */
  size?: "sm" | "default";
  /** Hide labels (icon-only). */
  iconOnly?: boolean;
}

export function LifecycleActions({
  target,
  id,
  name,
  isArchived,
  canArchive,
  canHardDelete,
  cascadeDescription,
  requireTypeName,
  invalidate,
  onAfterHardDelete,
  size = "sm",
  iconOnly = false,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const archive = useArchiveTarget(target);
  const unarchive = useUnarchiveTarget(target);
  const hardDelete = useHardDeleteTarget(target);

  const targetLabel = target.replace(/_/g, " ");

  return (
    <>
      <div className="flex items-center gap-1">
        {canArchive && (
          isArchived ? (
            <Button
              variant="ghost"
              size={iconOnly ? "icon" : size}
              disabled={unarchive.isPending}
              onClick={() => unarchive.mutate({ id, invalidate })}
              title="Restore"
            >
              <ArchiveRestore className={iconOnly ? "h-4 w-4" : "h-4 w-4 mr-1"} />
              {!iconOnly && "Restore"}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size={iconOnly ? "icon" : size}
              disabled={archive.isPending}
              onClick={() => archive.mutate({ id, invalidate })}
              title="Archive"
            >
              <Archive className={iconOnly ? "h-4 w-4" : "h-4 w-4 mr-1"} />
              {!iconOnly && "Archive"}
            </Button>
          )
        )}

        {canHardDelete && isArchived && (
          <Button
            variant="ghost"
            size={iconOnly ? "icon" : size}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            disabled={hardDelete.isPending}
            onClick={() => setConfirmOpen(true)}
            title="Permanent Delete"
          >
            <Trash2 className={iconOnly ? "h-4 w-4" : "h-4 w-4 mr-1"} />
            {!iconOnly && "Permanent Delete"}
          </Button>
        )}
      </div>

      <HardDeleteConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        targetLabel={targetLabel}
        targetName={name}
        cascadeDescription={cascadeDescription}
        requireTypeName={requireTypeName}
        isPending={hardDelete.isPending}
        onConfirm={() =>
          hardDelete.mutate(
            { id, invalidate },
            {
              onSuccess: () => {
                setConfirmOpen(false);
                onAfterHardDelete?.();
              },
            },
          )
        }
      />
    </>
  );
}
