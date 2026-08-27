import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldOff, UserPlus, Lock } from "lucide-react";

/**
 * Phase 4D.9 — Reusable dialog for managing admin authority.
 *
 * scope determines which set of governed backend RPCs is called.
 * All writes hit SECURITY DEFINER RPCs; no direct table mutation.
 */

export type AdminScope =
  | "platform_tenant_admin"    // Platform Super Admin managing Tenant Admins
  | "tenant_tenant_admin"      // Tenant Admin managing same-level Tenant Admins
  | "tenant_org_admin"         // Tenant Admin managing Org Admins for an Organization
  | "org_org_admin";           // Org Admin managing same-level Org Admins

interface AdminRow {
  membership_id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
  status: string;
  is_protected?: boolean;
  can_remove: boolean;
  created_at: string;
}

interface CandidateRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  is_org_member?: boolean;
}

const RPC = {
  platform_tenant_admin: {
    list: "platform_admin_list_tenant_admins",
    candidates: "platform_admin_list_tenant_admin_candidates",
    assign: "platform_admin_assign_tenant_admin",
    remove: "platform_admin_remove_tenant_admin",
    scopeParam: "_tenant_id" as const,
  },
  tenant_tenant_admin: {
    list: "tenant_admin_list_tenant_admins",
    candidates: "tenant_admin_list_tenant_admin_candidates",
    assign: "tenant_admin_assign_tenant_admin",
    remove: "tenant_admin_remove_tenant_admin",
    scopeParam: "_tenant_id" as const,
  },
  tenant_org_admin: {
    list: "tenant_admin_list_org_admins",
    candidates: "tenant_admin_list_org_admin_candidates",
    assign: "tenant_admin_assign_org_admin",
    remove: "tenant_admin_remove_org_admin",
    scopeParam: "_organization_id" as const,
  },
  org_org_admin: {
    list: "org_admin_list_org_admins",
    candidates: "org_admin_list_org_admin_candidates",
    assign: "org_admin_assign_org_admin",
    remove: "org_admin_remove_org_admin",
    scopeParam: "_organization_id" as const,
  },
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: AdminScope;
  /** Tenant id or Organization id depending on scope. */
  scopeId: string;
  contextLabel?: string | null;
}

function translateError(msg: string): string {
  if (msg.includes("last_tenant_admin")) return "Cannot remove the last Tenant Admin.";
  if (msg.includes("last_org_admin")) return "Cannot remove the last Org Admin.";
  if (msg.includes("protected_tenant_admin")) return "This protected Tenant Admin cannot be modified here.";
  if (msg.includes("target_not_active_tenant_member")) return "User must be an active Tenant Member first.";
  if (msg.includes("target_not_active_org_member")) return "User must be an active Org Member of this Organization.";
  if (msg.includes("target_not_active_org_admin")) return "User is not currently an active Org Admin.";
  if (msg.includes("target_not_tenant_admin")) return "User is not a Tenant Admin.";
  if (msg.includes("target_membership_inactive")) return "This user's Organization membership is not active.";
  if (msg.includes("not_authorized")) return "You are not authorized.";
  return msg;
}

export function ManageAdminsDialog({ open, onOpenChange, scope, scopeId, contextLabel }: Props) {
  const cfg = RPC[scope];
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [showCandidates, setShowCandidates] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<AdminRow | null>(null);

  const titleMap: Record<AdminScope, string> = {
    platform_tenant_admin: "Manage Tenant Admins",
    tenant_tenant_admin: "Manage Tenant Admins",
    tenant_org_admin: "Manage Org Admins",
    org_org_admin: "Manage Org Admins",
  };
  const roleLabel = scope.endsWith("tenant_admin") ? "Tenant Admin" : "Org Admin";

  const listKey = ["manage-admins", scope, scopeId];
  const listQ = useQuery({
    queryKey: listKey,
    enabled: open && !!scopeId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(cfg.list, { [cfg.scopeParam]: scopeId });
      if (error) throw error;
      return (data ?? []) as AdminRow[];
    },
    staleTime: 10_000,
  });

  const candKey = ["manage-admins-cand", scope, scopeId, search];
  const candQ = useQuery({
    queryKey: candKey,
    enabled: open && showCandidates && !!scopeId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(cfg.candidates, {
        [cfg.scopeParam]: scopeId,
        _query: search || null,
      });
      if (error) throw error;
      return (data ?? []) as CandidateRow[];
    },
    staleTime: 5_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["manage-admins"] });
    qc.invalidateQueries({ queryKey: ["tenant-admin-members"] });
    qc.invalidateQueries({ queryKey: ["tenant-admin-organizations"] });
    qc.invalidateQueries({ queryKey: ["platform-admin-list-tenants"] });
    qc.invalidateQueries({ queryKey: ["admin-access-summary"] });
  };

  const assignM = useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await (supabase.rpc as any)(cfg.assign, {
        [cfg.scopeParam]: scopeId,
        _target_user_id: userId,
        _reason: reason || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: `${roleLabel} assigned` });
      setReason("");
      setShowCandidates(false);
      invalidate();
    },
    onError: (e: any) => toast({ title: "Assign failed", description: translateError(e.message ?? String(e)), variant: "destructive" }),
  });

  const removeM = useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await (supabase.rpc as any)(cfg.remove, {
        [cfg.scopeParam]: scopeId,
        _target_user_id: userId,
        _reason: reason || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: `${roleLabel} authority removed` });
      setReason("");
      setConfirmRemove(null);
      invalidate();
    },
    onError: (e: any) => toast({ title: "Remove failed", description: translateError(e.message ?? String(e)), variant: "destructive" }),
  });

  const admins = listQ.data ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{titleMap[scope]}</DialogTitle>
            <DialogDescription>
              {contextLabel ? `${contextLabel} · ` : ""}Assign or remove {roleLabel} authority for existing active members.
              No email is sent.
            </DialogDescription>
          </DialogHeader>

          {listQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : listQ.error ? (
            <p className="text-sm text-destructive">Failed to load admins.</p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Name</TableHead>
                    <TableHead className="w-[35%]">Email</TableHead>
                    <TableHead className="w-[12%]">Status</TableHead>
                    <TableHead className="w-[13%] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {admins.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">
                        No {roleLabel}s yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {admins.map((a) => (
                    <TableRow key={a.membership_id}>
                      <TableCell className="font-medium align-top">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate">
                            {a.display_name?.trim() || <span className="text-muted-foreground">Unnamed user</span>}
                          </span>
                          {a.is_protected && (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              <Lock className="h-3 w-3 mr-1" /> Protected
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground align-top">
                        <span className="block truncate">{a.email ?? "—"}</span>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className="capitalize">{a.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right align-top">
                        {a.can_remove ? (
                          <Button size="sm" variant="outline" onClick={() => setConfirmRemove(a)}>
                            <ShieldOff className="h-3.5 w-3.5 mr-1" /> Remove
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {a.is_protected ? "Protected" : "—"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Reason (optional, recorded in audit)</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this change being made?"
              rows={2}
            />
          </div>

          {!showCandidates ? (
            <div className="flex justify-between items-center gap-2">
              <Button variant="outline" size="sm" disabled title="Coming later">
                <UserPlus className="h-3.5 w-3.5 mr-1" /> Invite new admin — coming later
              </Button>
              <Button size="sm" onClick={() => setShowCandidates(true)}>
                <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Assign existing member
              </Button>
            </div>
          ) : (
            <div className="space-y-2 border rounded-md p-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Search by name or email…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button variant="ghost" size="sm" onClick={() => { setShowCandidates(false); setSearch(""); }}>
                  Cancel
                </Button>
              </div>
              {candQ.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <div className="max-h-64 overflow-auto">
                  <Table>
                    <TableBody>
                      {(candQ.data ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={2} className="text-center text-xs text-muted-foreground py-4">
                            No eligible members found.
                          </TableCell>
                        </TableRow>
                      )}
                      {(candQ.data ?? []).map((c) => (
                        <TableRow key={c.user_id}>
                          <TableCell>
                            <div className="text-sm">{c.display_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{c.email ?? "—"}</div>
                            {scope === "tenant_org_admin" && c.is_org_member === false && (
                              <div className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">
                                Not yet in this Organization — assigning will add them as Org Admin.
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              disabled={assignM.isPending}
                              onClick={() => assignM.mutate(c.user_id)}
                            >
                              Assign
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRemove} onOpenChange={(v) => !v && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {roleLabel} authority?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRemove?.display_name || confirmRemove?.email} will be demoted to{" "}
              {scope.endsWith("tenant_admin") ? "Tenant Member" : "Org Member"}.
              Their membership row is preserved. This action is audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRemove && removeM.mutate(confirmRemove.user_id)}
            >
              Remove authority
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
