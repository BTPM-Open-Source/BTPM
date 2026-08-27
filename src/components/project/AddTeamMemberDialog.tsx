import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldLabel } from "@/components/ui/field-label";
import { useAddTeamMember, useProjectTeam } from "@/hooks/useProjectTeamRaci";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { STANDARD_ROLES, type CanonicalRoleKey } from "@/lib/projectTeamRoles";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  workspaceId: string;
}

export function AddTeamMemberDialog({ open, onOpenChange, projectId, workspaceId }: Props) {
  const { data: team = [] } = useProjectTeam(projectId);
  const { data: wsMembers = [] } = useWorkspaceMembers(workspaceId);
  const addMember = useAddTeamMember(projectId);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [canonicalRoleKey, setCanonicalRoleKey] = useState<CanonicalRoleKey | "">("");
  const [customRoleLabel, setCustomRoleLabel] = useState("");

  useEffect(() => {
    if (open) {
      setSelectedUserId("");
      setCanonicalRoleKey("");
      setCustomRoleLabel("");
    }
  }, [open]);

  const teamUserIds = new Set(team.map((m) => m.user_id));
  const available = wsMembers.filter((m) => !teamUserIds.has(m.id));

  const handleAdd = () => {
    if (!selectedUserId) return;
    const isCustom = canonicalRoleKey === "custom";
    const standard = STANDARD_ROLES.find((r) => r.key === canonicalRoleKey);
    const roleLabel = isCustom
      ? customRoleLabel.trim()
      : standard && standard.key !== "custom"
        ? standard.label
        : "";
    addMember.mutate(
      {
        userId: selectedUserId,
        roleLabel: roleLabel || undefined,
        canonicalRoleKey: canonicalRoleKey || null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const canSubmit =
    !!selectedUserId &&
    (canonicalRoleKey === "" ||
      (canonicalRoleKey !== "custom") ||
      (canonicalRoleKey === "custom" && customRoleLabel.trim().length > 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Team Member</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <FieldLabel hint="Pick a workspace member to add to this project's team. Workspace members must be invited at the workspace level first.">
              Workspace Member
            </FieldLabel>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">All workspace members are already on the team.</p>
            ) : (
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger><SelectValue placeholder="Select a member" /></SelectTrigger>
                <SelectContent>
                  {available.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <FieldLabel hint="Standard roles (Project Manager, Project Sponsor, etc.) are used for downstream automation like the generated Project Charter. Pick Other / Custom for a free-text role.">
              Project Role
            </FieldLabel>
            <Select value={canonicalRoleKey} onValueChange={(v) => setCanonicalRoleKey(v as CanonicalRoleKey)}>
              <SelectTrigger><SelectValue placeholder="Select a role (optional)" /></SelectTrigger>
              <SelectContent>
                {STANDARD_ROLES.map((r) => (
                  <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canonicalRoleKey === "custom" && (
            <div>
              <FieldLabel hint="Free-text label for this person's responsibility on the project. Does not affect permissions.">
                Custom Role Label
              </FieldLabel>
              <Input
                value={customRoleLabel}
                onChange={(e) => setCustomRoleLabel(e.target.value)}
                placeholder="e.g. SAP Cutover Coordinator"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!canSubmit || addMember.isPending}>
              {addMember.isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
