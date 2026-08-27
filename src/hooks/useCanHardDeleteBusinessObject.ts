// Wave 5 Step 5.5 correction — Authority gate for business/config object hard-delete.
//
// Per the frozen Wave 5 authority model, permanently deleting an archived
// business/config object (Program / Project / Phase / Task / Template /
// Backlog / Sprint / Workflow State / KPI Definition) is allowed for:
//   - Workspace Admin (in the object's workspace), OR
//   - Org Admin (of the object's organization).
//
// This hook returns `true` only when the current user matches one of those
// two roles for the given workspace. PM, Contributor, and Viewer always
// receive `false`.
//
// NOTE: This is the UI gate only. The real authority is enforced server-side
// by `_assert_admin` inside every `hard_delete_<type>` RPC and by the
// matching guard inside `list_lifecycle_target_attachments` /
// `purge_attachment_metadata`.
//
// Workspace lifecycle (deactivate/reactivate workspaces) is a SEPARATE
// concern and remains Org-Admin-only — do NOT use this hook for that.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCanHardDeleteBusinessObject(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["can-hard-delete-business-object", workspaceId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !workspaceId) return false;

      // Workspace Admin (or higher) check — covers Workspace Admin role.
      const { data: wsAdmin } = await supabase.rpc("is_workspace_admin_or_higher", {
        _user_id: user.id,
        _workspace_id: workspaceId,
      });
      if (wsAdmin === true) return true;

      // Org Admin check — resolves the user's organization from profile.
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile?.organization_id) return false;

      const { data: orgAdmin } = await supabase.rpc("is_org_admin", {
        _user_id: user.id,
        _organization_id: profile.organization_id,
      });
      return !!orgAdmin;
    },
    enabled: !!workspaceId,
  });
}
