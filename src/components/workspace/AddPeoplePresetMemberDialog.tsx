/**
 * WPP.6 — Add a member to a Workspace People Preset.
 *
 * Compact dialog with three modes:
 *   - Team member: pick an active current-workspace user.
 *   - Workspace-user stakeholder: pick an active current-workspace user.
 *   - External stakeholder: enter a display name.
 *
 * Delegates the write to the WPP.2 `add_project_people_preset_member` RPC
 * via the shared React Query hook. Never invites users, never modifies
 * memberships, never touches users from another workspace.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useAddProjectPeoplePresetMember } from "@/hooks/useProjectPeoplePresets";
import {
  STANDARD_ROLES,
  type CanonicalRoleKey,
} from "@/lib/projectTeamRoles";
import type {
  PresetMemberKind,
  PresetStakeholderType,
} from "@/lib/projectPeoplePresets";

export type AddPresetMemberMode =
  | "team_member"
  | "stakeholder_workspace"
  | "stakeholder_external";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  presetId: string;
  expectedPresetUpdatedAt: string;
  mode: AddPresetMemberMode;
  /** user_ids already present in this preset for the same kind (used to hide duplicates in the picker). */
  existingUserIdsForKind: string[];
}

export function AddPeoplePresetMemberDialog({
  open,
  onOpenChange,
  workspaceId,
  presetId,
  expectedPresetUpdatedAt,
  mode,
  existingUserIdsForKind,
}: Props) {
  const { data: wsMembers = [], isLoading: membersLoading } =
    useWorkspaceMembers(workspaceId);
  const add = useAddProjectPeoplePresetMember(workspaceId);
  const idemRef = useRef<string>("");

  const [userId, setUserId] = useState("");
  const [externalName, setExternalName] = useState("");
  const [roleKey, setRoleKey] = useState<CanonicalRoleKey | "">("");
  const [customLabel, setCustomLabel] = useState("");

  useEffect(() => {
    if (open) {
      idemRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `wpp6-add-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUserId("");
      setExternalName("");
      setRoleKey("");
      setCustomLabel("");
    }
  }, [open, mode]);

  const eligible = useMemo(
    () => wsMembers.filter((m) => !existingUserIdsForKind.includes(m.id)),
    [wsMembers, existingUserIdsForKind],
  );

  const memberKind: PresetMemberKind =
    mode === "team_member" ? "team_member" : "stakeholder";
  const stakeholderType: PresetStakeholderType | null =
    mode === "team_member"
      ? null
      : mode === "stakeholder_workspace"
        ? "workspace_member"
        : "external";

  const title =
    mode === "team_member"
      ? "Add team member"
      : mode === "stakeholder_workspace"
        ? "Add workspace stakeholder"
        : "Add external stakeholder";

  const canSubmit = (() => {
    if (add.isPending) return false;
    if (mode === "stakeholder_external") return externalName.trim().length > 0;
    return !!userId;
  })();

  const handleSubmit = () => {
    if (!canSubmit) return;
    const effectiveRoleKey: CanonicalRoleKey | null = roleKey || null;
    const effectiveLabel =
      effectiveRoleKey === "custom" ? customLabel.trim() || null : null;

    add.mutate(
      {
        preset_id: presetId,
        expected_preset_updated_at: expectedPresetUpdatedAt,
        member_kind: memberKind,
        stakeholder_type: stakeholderType,
        user_id: mode === "stakeholder_external" ? null : userId,
        external_name:
          mode === "stakeholder_external" ? externalName.trim() : null,
        canonical_role_key: effectiveRoleKey,
        role_label: effectiveLabel,
        idempotency_key: idemRef.current,
      },
      {
        onSuccess: (res) => {
          if (res.status === "applied" || res.status === "no_change") {
            toast.success(
              res.status === "applied"
                ? "Member added to preset"
                : "No change — this member is already in the preset",
            );
            onOpenChange(false);
            return;
          }
          if (res.status === "conflict") {
            toast.error(
              "This preset was changed by someone else. Please refresh and try again.",
            );
            return;
          }
          if (res.status === "not_authorized") {
            toast.error("You are not authorized to modify this preset.");
            return;
          }
          if (res.status === "invalid") {
            const reason = String(res.data?.reason ?? "invalid");
            const map: Record<string, string> = {
              duplicate_external: "An external stakeholder with this name is already in the preset.",
              duplicate_member: "This user is already in the preset for that role.",
              external_name_required: "External name is required.",
              user_required: "Please select a workspace user.",
              user_not_in_workspace: "This user is no longer an active workspace member.",
            };
            toast.error(map[reason] ?? "Could not add member to preset.");
            return;
          }
          toast.error("Could not add member to preset.");
        },
        onError: (err: unknown) => {
          toast.error(
            `Could not add member: ${err instanceof Error ? err.message : "unknown error"}`,
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === "stakeholder_external"
              ? "Add an external stakeholder by name."
              : "Only active members of the current workspace can be added."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {mode !== "stakeholder_external" ? (
            <div className="space-y-2">
              <Label htmlFor="wpp6-user">Workspace member</Label>
              {membersLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : eligible.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No additional workspace members available.
                </p>
              ) : (
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger id="wpp6-user">
                    <SelectValue placeholder="Select a member…" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligible.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="wpp6-ext">External name</Label>
              <Input
                id="wpp6-ext"
                value={externalName}
                onChange={(e) => setExternalName(e.target.value)}
                placeholder="e.g. Acme Corp · Jane Doe"
                maxLength={200}
                autoFocus
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="wpp6-role">Role (optional)</Label>
            <Select
              value={roleKey || "__none__"}
              onValueChange={(v) =>
                setRoleKey(v === "__none__" ? "" : (v as CanonicalRoleKey))
              }
            >
              <SelectTrigger id="wpp6-role">
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
            disabled={add.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {add.isPending ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
