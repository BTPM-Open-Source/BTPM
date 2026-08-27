import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const WORKSPACE_ROLES = [
  { value: "workspace_admin", label: "Workspace Admin" },
  { value: "project_manager", label: "Project Manager" },
  { value: "contributor", label: "Contributor" },
  { value: "viewer", label: "Viewer" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  existingUserIds: string[];
  onSubmit: (userId: string, role: string) => void;
  loading?: boolean;
}

export default function WsAddMemberDialog({ open, onOpenChange, workspaceId, existingUserIds, onSubmit, loading }: Props) {
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedRole, setSelectedRole] = useState("contributor");

  const { data: candidates } = useQuery({
    queryKey: ["ws-add-member-candidates", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ws_list_add_member_candidates", {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return (data || []) as { user_id: string; display_name: string | null; email: string | null }[];
    },
    enabled: open && !!workspaceId,
  });

  const available = (candidates || []).filter((u) => !existingUserIds.includes(u.user_id));

  const handleSubmit = () => {
    if (selectedUser && selectedRole) {
      onSubmit(selectedUser, selectedRole);
      setSelectedUser("");
      setSelectedRole("contributor");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Member</DialogTitle>
          <DialogDescription>Add an existing organization user to this workspace.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>User</Label>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">No additional users available to add.</p>
            ) : (
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger><SelectValue placeholder="Select user…" /></SelectTrigger>
                <SelectContent>
                  {available.map((u) => (
                    <SelectItem key={u.user_id} value={u.user_id}>
                      {u.display_name || u.email || u.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
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
          <Button onClick={handleSubmit} disabled={!selectedUser || loading}>
            {loading ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
