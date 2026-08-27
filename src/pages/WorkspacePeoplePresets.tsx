/**
 * WPP.6 — Workspace People Presets library.
 *
 * A single Workspace Settings tab that lists the workspace's active (and
 * optionally archived) presets and, on selection, renders an inline
 * detail/editor. All reads and writes go through the WPP.2 protected
 * RPC service via `@/hooks/useProjectPeoplePresets`. No direct table
 * writes, no new RPCs.
 *
 * Authority: follows the existing Workspace Settings convention
 * (`useCanManageWorkspace`). The protected RPCs remain authoritative
 * and are honestly translated to user-visible messaging.
 *
 * Out of scope for WPP.6 (deliberately absent): create-empty, duplicate,
 * reorder, import/export, comparison, organization scope, cross-workspace
 * operations, synchronization, history, notifications, apply-to-project.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  Plus,
  Trash2,
  Pencil,
  Users,
  UserRound,
  ExternalLink,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useParams } from "react-router-dom";
import {
  useProjectPeoplePresets,
  useProjectPeoplePreset,
  useRenameProjectPeoplePreset,
  useArchiveProjectPeoplePreset,
  useRestoreProjectPeoplePreset,
  useUpdateProjectPeoplePresetMember,
  useRemoveProjectPeoplePresetMember,
} from "@/hooks/useProjectPeoplePresets";
import { useCanManageWorkspace } from "@/hooks/useWorkspaceMembersAdmin";
import type {
  ProjectPeoplePresetMember,
  ProjectPeoplePresetDetail,
} from "@/lib/projectPeoplePresets";
import type { PmgCommandResult } from "@/lib/pmg/pmgContract";
import {
  STANDARD_ROLES,
  getDisplayRoleLabel,
  type CanonicalRoleKey,
} from "@/lib/projectTeamRoles";
import {
  AddPeoplePresetMemberDialog,
  type AddPresetMemberMode,
} from "@/components/workspace/AddPeoplePresetMemberDialog";

interface WorkspacePeoplePresetsProps {
  workspaceId?: string;
}

export default function WorkspacePeoplePresets({
  workspaceId: workspaceIdProp,
}: WorkspacePeoplePresetsProps = {}) {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = workspaceIdProp ?? params.workspaceId;

  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: canManage } = useCanManageWorkspace(workspaceId);
  const canEdit = canManage === true;

  const { data: presets = [], isLoading } = useProjectPeoplePresets(
    workspaceId,
    { includeArchived },
  );

  if (!workspaceId) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a workspace to manage People presets.
      </p>
    );
  }

  if (selectedId) {
    return (
      <PresetDetailView
        workspaceId={workspaceId}
        presetId={selectedId}
        canEdit={canEdit}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            People presets
          </h2>
          <p className="text-xs text-muted-foreground">
            Reusable snapshots of Project Team Members and Stakeholders,
            scoped to this workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="wpp6-show-archived"
            checked={includeArchived}
            onCheckedChange={setIncludeArchived}
          />
          <Label
            htmlFor="wpp6-show-archived"
            className="text-xs text-muted-foreground"
          >
            Show archived
          </Label>
        </div>
      </div>

      {!canEdit && (
        <p className="text-xs text-muted-foreground">
          Read-only view. Only Workspace Admins can edit People presets.
        </p>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : presets.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No People presets yet. Presets are created from a Project's People
          page using “Save current people as preset”.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[80px] text-right">Team</TableHead>
              <TableHead className="w-[110px] text-right">
                Stakeholders
              </TableHead>
              <TableHead className="w-[80px] text-right">Total</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {presets.map((p) => {
              const archived = !!p.archived_at;
              return (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setSelectedId(p.id)}
                >
                  <TableCell className="font-medium">
                    {p.name || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {p.description || (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.team_count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.stakeholder_count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.member_count}
                  </TableCell>
                  <TableCell>
                    {archived ? (
                      <Badge variant="secondary">Archived</Badge>
                    ) : (
                      <Badge variant="default">Active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail / editor view
// ---------------------------------------------------------------------------

function PresetDetailView({
  workspaceId,
  presetId,
  canEdit,
  onBack,
}: {
  workspaceId: string;
  presetId: string;
  canEdit: boolean;
  onBack: () => void;
}) {
  const { data, isLoading } = useProjectPeoplePreset(presetId);
  const rename = useRenameProjectPeoplePreset(workspaceId);
  const archive = useArchiveProjectPeoplePreset(workspaceId);
  const restore = useRestoreProjectPeoplePreset(workspaceId);
  const removeMember = useRemoveProjectPeoplePresetMember(workspaceId, presetId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [addMode, setAddMode] = useState<AddPresetMemberMode | null>(null);
  const [editingMember, setEditingMember] =
    useState<ProjectPeoplePresetMember | null>(null);
  const [confirmingRemove, setConfirmingRemove] =
    useState<ProjectPeoplePresetMember | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  // Mirror header form from server data (only when not dirtied by user).
  useEffect(() => {
    if (data && !nameDirty) {
      setName(data.preset.name ?? "");
      setDescription(data.preset.description ?? "");
    }
  }, [data, nameDirty]);

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to presets
        </Button>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const preset = data.preset;
  const archived = !!preset.archived_at;
  const detail: ProjectPeoplePresetDetail = data;

  const teamMembers = detail.members.filter(
    (m) => m.member_kind === "team_member",
  );
  const stakeholders = detail.members.filter(
    (m) => m.member_kind === "stakeholder",
  );

  const existingUserIdsForKind = (mode: AddPresetMemberMode): string[] => {
    if (mode === "team_member") {
      return teamMembers
        .map((m) => m.user_id)
        .filter((id): id is string => !!id);
    }
    if (mode === "stakeholder_workspace") {
      return stakeholders
        .filter((m) => m.stakeholder_type === "workspace_member")
        .map((m) => m.user_id)
        .filter((id): id is string => !!id);
    }
    return [];
  };

  const handleSaveHeader = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Preset name is required.");
      return;
    }
    rename.mutate(
      {
        preset_id: preset.id,
        name: trimmed,
        description: description.trim() || null,
        expected_updated_at: preset.updated_at,
      },
      {
        onSuccess: (res) => {
          handlePmgToast(res, {
            applied: "Preset updated",
            no_change: "No change",
            invalidReasonMap: {
              name_required: "Preset name is required.",
              duplicate_name:
                "Another preset in this workspace already uses this name.",
            },
          });
          if (res.status === "applied" || res.status === "no_change") {
            setNameDirty(false);
          }
        },
      },
    );
  };

  const handleArchive = () => {
    archive.mutate(
      {
        preset_id: preset.id,
        expected_updated_at: preset.updated_at,
      },
      {
        onSuccess: (res) => {
          handlePmgToast(res, {
            applied: "Preset archived",
            no_change: "Preset is already archived",
          });
        },
      },
    );
  };

  const handleRestore = () => {
    restore.mutate(
      {
        preset_id: preset.id,
        expected_updated_at: preset.updated_at,
      },
      {
        onSuccess: (res) => {
          handlePmgToast(res, {
            applied: "Preset restored",
            no_change: "Preset is already active",
          });
        },
      },
    );
  };

  const handleRemoveMember = (m: ProjectPeoplePresetMember) => {
    removeMember.mutate(
      {
        member_id: m.id,
        expected_preset_updated_at: preset.updated_at,
      },
      {
        onSuccess: (res) => {
          handlePmgToast(res, {
            applied: "Member removed",
            no_change: "Member already removed",
            invalidReasonMap: {
              last_member:
                "A preset must contain at least one member. Add another member before removing this one.",
              final_member:
                "A preset must contain at least one member. Add another member before removing this one.",
            },
          });
          setConfirmingRemove(null);
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to presets
        </Button>
        {canEdit && (
          <div className="flex items-center gap-2">
            {archived ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRestore}
                disabled={restore.isPending}
              >
                <ArchiveRestore className="h-4 w-4 mr-1" /> Restore
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingArchive(true)}
                disabled={archive.isPending}
              >
                <Archive className="h-4 w-4 mr-1" /> Archive
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Header edit */}
      <div className="rounded-md border p-4 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="wpp6-detail-name">Name</Label>
          <Input
            id="wpp6-detail-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameDirty(true);
            }}
            disabled={!canEdit || archived}
            maxLength={200}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="wpp6-detail-desc">Description</Label>
          <Textarea
            id="wpp6-detail-desc"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setNameDirty(true);
            }}
            disabled={!canEdit || archived}
            rows={2}
            maxLength={1000}
          />
        </div>
        {canEdit && !archived && (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSaveHeader}
              disabled={rename.isPending || !nameDirty}
            >
              {rename.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </div>

      {/* Members */}
      <div className="rounded-md border">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="text-sm font-medium">
            Members{" "}
            <span className="text-muted-foreground">
              ({detail.members.length})
            </span>
          </div>
          {canEdit && !archived && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setAddMode("team_member")}>
                  <Users className="h-4 w-4 mr-2" /> Team member (workspace
                  user)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setAddMode("stakeholder_workspace")}
                >
                  <UserRound className="h-4 w-4 mr-2" /> Stakeholder
                  (workspace user)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setAddMode("stakeholder_external")}
                >
                  <ExternalLink className="h-4 w-4 mr-2" /> External
                  stakeholder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {detail.members.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            This preset has no members yet.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Role</TableHead>
                {canEdit && !archived && (
                  <TableHead className="w-[80px]" />
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.member_kind === "stakeholder" &&
                    m.stakeholder_type === "external"
                      ? m.external_name || "—"
                      : m.display_name || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {kindLabel(m)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {getDisplayRoleLabel(
                      m.canonical_role_key,
                      m.role_label,
                    ) || "—"}
                  </TableCell>
                  {canEdit && !archived && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setEditingMember(m)}
                          >
                            <Pencil className="h-4 w-4 mr-2" /> Edit role
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setConfirmingRemove(m)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {addMode && (
        <AddPeoplePresetMemberDialog
          open={!!addMode}
          onOpenChange={(o) => !o && setAddMode(null)}
          workspaceId={workspaceId}
          presetId={preset.id}
          expectedPresetUpdatedAt={preset.updated_at}
          mode={addMode}
          existingUserIdsForKind={existingUserIdsForKind(addMode)}
        />
      )}

      {editingMember && (
        <EditPresetMemberDialog
          open={!!editingMember}
          onOpenChange={(o) => !o && setEditingMember(null)}
          workspaceId={workspaceId}
          presetId={preset.id}
          member={editingMember}
          expectedPresetUpdatedAt={preset.updated_at}
        />
      )}

      <AlertDialog
        open={!!confirmingRemove}
        onOpenChange={(o) => !o && setConfirmingRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member from preset</AlertDialogTitle>
            <AlertDialogDescription>
              Remove{" "}
              <strong>
                {confirmingRemove?.display_name ||
                  confirmingRemove?.external_name ||
                  "this member"}
              </strong>{" "}
              from this preset? Existing projects that were already applied
              with this preset are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                confirmingRemove && handleRemoveMember(confirmingRemove)
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmingArchive}
        onOpenChange={setConfirmingArchive}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this preset?</AlertDialogTitle>
            <AlertDialogDescription>
              Archived presets are hidden from the default library view and
              cannot be applied to projects until restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleArchive();
                setConfirmingArchive(false);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit-role dialog (name/kind are immutable in WPP.2 update contract)
// ---------------------------------------------------------------------------

function EditPresetMemberDialog({
  open,
  onOpenChange,
  workspaceId,
  presetId,
  member,
  expectedPresetUpdatedAt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  presetId: string;
  member: ProjectPeoplePresetMember;
  expectedPresetUpdatedAt: string;
}) {
  const update = useUpdateProjectPeoplePresetMember(workspaceId, presetId);
  const [roleKey, setRoleKey] = useState<CanonicalRoleKey | "">(
    (member.canonical_role_key as CanonicalRoleKey | null) ?? "",
  );
  const [customLabel, setCustomLabel] = useState(member.role_label ?? "");
  const [externalName, setExternalName] = useState(
    member.external_name ?? "",
  );

  const isExternal =
    member.member_kind === "stakeholder" &&
    member.stakeholder_type === "external";

  const handleSubmit = () => {
    const key: CanonicalRoleKey | null = roleKey || null;
    const label = key === "custom" ? customLabel.trim() || null : null;
    update.mutate(
      {
        member_id: member.id,
        expected_preset_updated_at: expectedPresetUpdatedAt,
        canonical_role_key: key,
        role_label: label,
        external_name: isExternal ? externalName.trim() || null : null,
      },
      {
        onSuccess: (res) => {
          handlePmgToast(res, {
            applied: "Member updated",
            no_change: "No change",
            invalidReasonMap: {
              external_name_required: "External name is required.",
              duplicate_external:
                "Another external stakeholder in this preset already uses this name.",
            },
          });
          if (res.status === "applied" || res.status === "no_change") {
            onOpenChange(false);
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
          <DialogDescription>
            Change the saved role. The member kind cannot be changed here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {isExternal && (
            <div className="space-y-2">
              <Label htmlFor="wpp6-edit-ext">External name</Label>
              <Input
                id="wpp6-edit-ext"
                value={externalName}
                onChange={(e) => setExternalName(e.target.value)}
                maxLength={200}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="wpp6-edit-role">Role</Label>
            <Select
              value={roleKey || "__none__"}
              onValueChange={(v) =>
                setRoleKey(v === "__none__" ? "" : (v as CanonicalRoleKey))
              }
            >
              <SelectTrigger id="wpp6-edit-role">
                <SelectValue placeholder="No role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No role</SelectItem>
                {STANDARD_ROLES.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {roleKey === "custom" && (
              <Input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Custom role label"
                maxLength={120}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindLabel(m: ProjectPeoplePresetMember): string {
  if (m.member_kind === "team_member") return "Team member";
  if (m.stakeholder_type === "external") return "External stakeholder";
  return "Stakeholder";
}

function handlePmgToast(
  res: PmgCommandResult,
  opts: {
    applied: string;
    no_change: string;
    invalidReasonMap?: Record<string, string>;
  },
) {
  if (res.status === "applied") {
    toast.success(opts.applied);
    return;
  }
  if (res.status === "no_change") {
    toast.success(opts.no_change);
    return;
  }
  if (res.status === "conflict") {
    toast.error(
      "This preset was changed by someone else. Please refresh and try again.",
    );
    return;
  }
  if (res.status === "not_authorized") {
    toast.error("You are not authorized to perform this action.");
    return;
  }
  if (res.status === "invalid") {
    const reason = String(res.data?.reason ?? "invalid");
    const mapped = opts.invalidReasonMap?.[reason];
    toast.error(mapped ?? "This change is not allowed.");
    return;
  }
  toast.error("Could not complete this action.");
}
