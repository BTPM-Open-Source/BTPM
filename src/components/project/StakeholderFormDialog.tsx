import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import {
  useAddProjectStakeholder,
  useUpdateProjectStakeholder,
  type ProjectStakeholder,
} from "@/hooks/useProjectStakeholders";
import { useToast } from "@/hooks/use-toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceId: string;
  /** When provided, dialog is in edit mode for this stakeholder */
  editing?: ProjectStakeholder | null;
};

export function StakeholderFormDialog({ open, onOpenChange, projectId, workspaceId, editing }: Props) {
  const { toast } = useToast();
  const { data: wsMembers = [] } = useWorkspaceMembers(workspaceId);
  const addMutation = useAddProjectStakeholder(projectId);
  const updateMutation = useUpdateProjectStakeholder(projectId);

  const isEdit = !!editing;
  const [type, setType] = useState<"workspace_member" | "external">("workspace_member");
  const [userId, setUserId] = useState<string>("");
  const [externalName, setExternalName] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [startDate, setStartDate] = useState<string>("");

  useEffect(() => {
    if (open) {
      if (editing) {
        setType(editing.stakeholder_type);
        setUserId(editing.user_id ?? "");
        setExternalName(editing.external_name ?? "");
        setRoleLabel(editing.role_label ?? "");
        setNotes(editing.notes ?? "");
        setStartDate(editing.start_date ?? "");
      } else {
        setType("workspace_member");
        setUserId("");
        setExternalName("");
        setRoleLabel("");
        setNotes("");
        setStartDate("");
      }
    }
  }, [open, editing]);

  const isPending = addMutation.isPending || updateMutation.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEdit && editing) {
        await updateMutation.mutateAsync({
          stakeholder_id: editing.id,
          role_label: roleLabel || null,
          external_name: editing.stakeholder_type === "external" ? externalName : null,
          notes: notes || null,
          start_date: startDate || null,
        });
        toast({ title: "Stakeholder updated" });
      } else {
        if (type === "workspace_member" && !userId) {
          toast({ title: "Pick a workspace member", variant: "destructive" });
          return;
        }
        if (type === "external" && !externalName.trim()) {
          toast({ title: "External name is required", variant: "destructive" });
          return;
        }
        await addMutation.mutateAsync({
          stakeholder_type: type,
          user_id: type === "workspace_member" ? userId : null,
          external_name: type === "external" ? externalName.trim() : null,
          role_label: roleLabel || null,
          notes: notes || null,
          start_date: startDate || null,
        });
        toast({ title: "Stakeholder added" });
      }
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: isEdit ? "Failed to update stakeholder" : "Failed to add stakeholder",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit stakeholder" : "Add stakeholder"}</DialogTitle>
            <DialogDescription>
              Stakeholders are tracked separately from project team. They do not affect permissions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {!isEdit && (
              <div className="space-y-2">
                <Label>Stakeholder type</Label>
                <RadioGroup
                  value={type}
                  onValueChange={(v) => setType(v as "workspace_member" | "external")}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="workspace_member" id="r-internal" />
                    <Label htmlFor="r-internal" className="font-normal">Workspace member</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="external" id="r-external" />
                    <Label htmlFor="r-external" className="font-normal">External</Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {type === "workspace_member" && !isEdit && (
              <div className="space-y-2">
                <Label htmlFor="member">Workspace member</Label>
                <Select value={userId} onValueChange={setUserId}>
                  <SelectTrigger id="member">
                    <SelectValue placeholder="Select a member" />
                  </SelectTrigger>
                  <SelectContent>
                    {wsMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {type === "external" && (
              <div className="space-y-2">
                <Label htmlFor="ext-name">External name</Label>
                <Input
                  id="ext-name"
                  value={externalName}
                  onChange={(e) => setExternalName(e.target.value)}
                  placeholder="e.g. Acme Corp · Jane Doe"
                  disabled={isEdit && editing?.stakeholder_type !== "external"}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="role">Role / relationship (optional)</Label>
              <Input
                id="role"
                value={roleLabel}
                onChange={(e) => setRoleLabel(e.target.value)}
                placeholder="e.g. Sponsor, Customer SME, Vendor PM"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="start-date">Start date (optional)</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                When this stakeholder's involvement on the project begins.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isEdit ? "Save changes" : "Add stakeholder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
