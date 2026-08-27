import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FieldLabel } from "@/components/ui/field-label";

const WORKSPACE_ROLES = [
  { value: "workspace_admin", label: "Workspace Admin" },
  { value: "project_manager", label: "Project Manager" },
  { value: "contributor", label: "Contributor" },
  { value: "viewer", label: "Viewer" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  existingWorkspaceIds: string[];
  onSubmit: (workspaceId: string, role: string) => void;
  loading?: boolean;
}

export default function AddWorkspaceAccessDialog({
  open, onOpenChange, organizationId, existingWorkspaceIds, onSubmit, loading,
}: Props) {
  const [selectedWs, setSelectedWs] = useState("");
  const [selectedRole, setSelectedRole] = useState("contributor");

  const { data: workspaces } = useQuery({
    queryKey: ["admin-org-workspaces", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_org_workspaces", {
        _organization_id: organizationId,
      });
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: open && !!organizationId,
  });

  const available = workspaces?.filter((w) => !existingWorkspaceIds.includes(w.id)) || [];

  const handleSubmit = () => {
    if (selectedWs && selectedRole) {
      onSubmit(selectedWs, selectedRole);
      setSelectedWs("");
      setSelectedRole("contributor");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Workspace Access</DialogTitle>
          <DialogDescription>Grant this user access to a workspace with a specific role.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <FieldLabel hint="Workspace where this user will receive access. Each workspace is an isolated team space inside the organization.">
              Workspace
            </FieldLabel>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">No additional workspaces available.</p>
            ) : (
              <Select value={selectedWs} onValueChange={setSelectedWs}>
                <SelectTrigger><SelectValue placeholder="Select workspace…" /></SelectTrigger>
                <SelectContent>
                  {available.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <FieldLabel hint="Workspace Admin: full control. Project Manager: create/edit projects. Contributor: edit assigned items. Viewer: read-only.">
              Role
            </FieldLabel>
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORKSPACE_ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!selectedWs || !selectedRole || loading}>
            {loading ? "Adding…" : "Add Access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
