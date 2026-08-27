import { useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldLabel } from "@/components/ui/field-label";
import { AlertTriangle, Plus, Trash2, Pencil, Users, Shield } from "lucide-react";
import {
  useProjectTeam, useProjectRaci,
  useUpdateTeamMemberRole, useRemoveTeamMember,
  useAddRaciAssignment, useRemoveRaciAssignment,
  type DecryptedTeamMember, type RaciAssignment,
} from "@/hooks/useProjectTeamRaci";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useProjectStakeholders } from "@/hooks/useProjectStakeholders";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { AddTeamMemberDialog } from "@/components/project/AddTeamMemberDialog";
import { StakeholdersSection } from "@/components/project/StakeholdersSection";
import { ProjectPeoplePresetsMenu } from "@/components/project/ProjectPeoplePresetsMenu";
import { STANDARD_ROLES, getDisplayRoleLabel, type CanonicalRoleKey } from "@/lib/projectTeamRoles";
import type { Tables } from "@/integrations/supabase/types";

function initials(name: string | null, email: string | null) {
  if (name) return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if (email) return email[0].toUpperCase();
  return "?";
}

const RACI_ROLES = [
  { value: "responsible", label: "Responsible", desc: "Does the work" },
  { value: "accountable", label: "Accountable", desc: "Owns the outcome" },
  { value: "consulted", label: "Consulted", desc: "Provides input" },
  { value: "informed", label: "Informed", desc: "Kept in the loop" },
] as const;

export default function ProjectTeam() {
  const { projectId, workspaceId } = useParams<{ projectId: string; workspaceId: string }>();
  const { project } = useOutletContext<{ project: Tables<"projects"> }>();
  const { canEdit } = useProjectPlanningAuthority(projectId);

  const { data: team = [], isLoading: teamLoading } = useProjectTeam(projectId);
  const { data: raci = [], isLoading: raciLoading } = useProjectRaci(projectId);
  const { data: wsMembers = [] } = useWorkspaceMembers(workspaceId);
  const { data: stakeholders = [] } = useProjectStakeholders(projectId);
  const activeStakeholders = stakeholders.filter((s) => !s.removed_at);

  const updateRole = useUpdateTeamMemberRole(projectId!);
  const removeMember = useRemoveTeamMember(projectId!);
  const addRaci = useAddRaciAssignment(projectId!);
  const removeRaci = useRemoveRaciAssignment(projectId!);

  // Add team member dialog (extracted)
  const [addTeamOpen, setAddTeamOpen] = useState(false);

  // WPP.5 — People presets menu (Apply / Save current people as preset)
  const activeTeamCount = team.length;
  const activeStakeholderCount = activeStakeholders.length;

  // Edit role dialog
  const [editMember, setEditMember] = useState<DecryptedTeamMember | null>(null);
  const [editRoleKey, setEditRoleKey] = useState<CanonicalRoleKey | "">("");
  const [editCustomLabel, setEditCustomLabel] = useState("");

  // RACI dialog
  const [addRaciOpen, setAddRaciOpen] = useState(false);
  const [raciStakeholderId, setRaciStakeholderId] = useState("");
  const [raciRole, setRaciRole] = useState("");

  const handleEditRole = () => {
    if (!editMember) return;
    const isCustom = editRoleKey === "custom";
    const standard = STANDARD_ROLES.find((r) => r.key === editRoleKey);
    const roleLabel = isCustom
      ? editCustomLabel.trim()
      : standard && standard.key !== "custom"
        ? standard.label
        : "";
    updateRole.mutate(
      {
        memberId: editMember.id,
        expectedUpdatedAt: editMember.updated_at,
        roleLabel,
        canonicalRoleKey: editRoleKey || null,
      },
      {
        onSuccess: () => {
          setEditMember(null);
          setEditRoleKey("");
          setEditCustomLabel("");
        },
      },
    );
  };

  const handleAddRaci = () => {
    if (!raciStakeholderId || !raciRole) return;
    const sh = activeStakeholders.find((s) => s.id === raciStakeholderId);
    addRaci.mutate(
      { stakeholderId: raciStakeholderId, userId: sh?.user_id ?? null, raciRole },
      {
        onSuccess: () => { setAddRaciOpen(false); setRaciStakeholderId(""); setRaciRole(""); },
      },
    );
  };

  // RACI warnings & enforcement
  const accountableList = raci.filter(r => r.raci_role === "accountable");
  const noAccountable = accountableList.length === 0;
  const hasAccountable = accountableList.length >= 1;

  // Reset selected RACI role if it becomes invalid (Accountable taken)
  if (addRaciOpen && raciRole === "accountable" && hasAccountable) {
    // defer state update to next tick to avoid setState during render
    queueMicrotask(() => setRaciRole(""));
  }

  // Group RACI by role
  const raciByRole = RACI_ROLES.map(r => ({
    ...r,
    assignments: raci.filter(a => a.raci_role === r.value),
  }));

  return (
    <div className="space-y-8">
      {/* ===== PROJECT TEAM ROSTER ===== */}
      <section>
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Users className="h-5 w-5" /> Project Team
            <span className="text-sm font-normal text-muted-foreground">({team.length})</span>
          </h2>
          {canEdit && (
            <div className="flex items-center gap-2">
              <ProjectPeoplePresetsMenu
                projectId={projectId!}
                workspaceId={workspaceId!}
                canEdit={canEdit}
                activeTeamCount={activeTeamCount}
                activeStakeholderCount={activeStakeholderCount}
              />
              <Button size="sm" onClick={() => setAddTeamOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add Member
              </Button>
            </div>
          )}
        </div>

        {teamLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : team.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No team members assigned to this project yet.
              {canEdit && " Click 'Add Member' to get started."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {team.map(m => (
              <Card key={m.id}>
                <CardContent className="flex items-center gap-4 py-4">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="text-sm">
                      {initials(m.display_name, m.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.display_name || m.email || "Unknown"}</p>
                    {m.email && m.display_name && (
                      <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                    )}
                  </div>
                  {(() => {
                    const display = getDisplayRoleLabel(m.canonical_role_key, m.role_label);
                    return display ? (
                      <Badge variant="secondary" className="shrink-0">{display}</Badge>
                    ) : null;
                  })()}
                  {canEdit && (
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => {
                          setEditMember(m);
                          const key = m.canonical_role_key as CanonicalRoleKey | null;
                          setEditRoleKey(key ?? "");
                          setEditCustomLabel(key === "custom" ? (m.role_label || "") : "");
                        }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => removeMember.mutate({ memberId: m.id, expectedUpdatedAt: m.updated_at })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ===== STAKEHOLDERS ===== */}
      <StakeholdersSection
        projectId={projectId!}
        workspaceId={workspaceId!}
        canEdit={canEdit}
      />

      {/* ===== PROJECT-LEVEL RACI ===== */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Shield className="h-5 w-5" /> Project RACI
          </h2>
          {canEdit && (
            <Button size="sm" onClick={() => setAddRaciOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Assignment
            </Button>
          )}
        </div>

        {/* Warning when no Accountable */}
        {!raciLoading && noAccountable && (
          <div className="flex items-center gap-2 mb-4 p-3 rounded-md border bg-muted/50">
            <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">
              No Accountable person assigned. Consider assigning someone who owns the project outcome.
            </p>
          </div>
        )}

        {raciLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : raci.length === 0 && !canEdit ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No RACI assignments for this project.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {raciByRole.map(group => (
              <Card key={group.value}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    <span>{group.label}</span>
                    <span className="text-xs font-normal text-muted-foreground">{group.desc}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {group.assignments.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">None assigned</p>
                  ) : (
                    <div className="space-y-2">
                      {group.assignments.map(a => (
                        <div key={a.id} className="flex items-center gap-3">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-xs">
                              {initials(a.display_name, a.email)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm flex-1 truncate">{a.display_name || a.email || "Unknown"}</span>
                          {canEdit && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => removeRaci.mutate(a.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ===== ADD TEAM MEMBER DIALOG (extracted) ===== */}
      <AddTeamMemberDialog
        open={addTeamOpen}
        onOpenChange={setAddTeamOpen}
        projectId={projectId!}
        workspaceId={workspaceId!}
      />

      {/* WPP.5 — People presets (Apply / Save) are rendered by ProjectPeoplePresetsMenu in the header. */}



      {/* ===== EDIT ROLE DIALOG ===== */}
      <Dialog open={!!editMember} onOpenChange={open => { if (!open) setEditMember(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Role</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {editMember?.display_name || editMember?.email}
            </p>
            <div>
              <FieldLabel hint="Standard roles (Project Manager, Project Sponsor, etc.) are used for downstream automation like the generated Project Charter. Pick Other / Custom for a free-text role.">
                Project Role
              </FieldLabel>
              <Select value={editRoleKey} onValueChange={(v) => setEditRoleKey(v as CanonicalRoleKey)}>
                <SelectTrigger><SelectValue placeholder="Select a role (optional)" /></SelectTrigger>
                <SelectContent>
                  {STANDARD_ROLES.map((r) => (
                    <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editRoleKey === "custom" && (
              <div>
                <FieldLabel hint="Free-text label for this person's responsibility on the project.">
                  Custom Role Label
                </FieldLabel>
                <Input
                  value={editCustomLabel}
                  onChange={(e) => setEditCustomLabel(e.target.value)}
                  placeholder="e.g. SAP Cutover Coordinator"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditMember(null)}>Cancel</Button>
              <Button
                onClick={handleEditRole}
                disabled={updateRole.isPending || (editRoleKey === "custom" && editCustomLabel.trim().length === 0)}
              >
                {updateRole.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ===== ADD RACI DIALOG ===== */}
      <Dialog open={addRaciOpen} onOpenChange={setAddRaciOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add RACI Assignment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <FieldLabel hint="Pick from this project's Stakeholders. Add stakeholders first if the person you need is not listed.">
                Person
              </FieldLabel>
              {activeStakeholders.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3 rounded-md border bg-muted/40">
                  No project stakeholders have been added yet. Add stakeholders before assigning RACI.
                </p>
              ) : (
                <Select value={raciStakeholderId} onValueChange={setRaciStakeholderId}>
                  <SelectTrigger><SelectValue placeholder="Select a stakeholder" /></SelectTrigger>
                  <SelectContent>
                    {activeStakeholders.map((s) => {
                      const typeLabel = s.stakeholder_type === "external" ? "External" : "Workspace member";
                      const role = s.role_label?.trim();
                      return (
                        <SelectItem key={s.id} value={s.id}>
                          {s.display_name}
                          <span className="text-xs text-muted-foreground ml-2">
                            · {typeLabel}{role ? ` · ${role}` : ""}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <FieldLabel hint="RACI role: Responsible (does the work), Accountable (owns outcome — only one), Consulted (gives input), Informed (kept up to date).">
                RACI Role
              </FieldLabel>
              <Select value={raciRole} onValueChange={setRaciRole}>
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {RACI_ROLES.map(r => {
                    const isAccountableLocked = r.value === "accountable" && hasAccountable;
                    return (
                      <SelectItem
                        key={r.value}
                        value={r.value}
                        disabled={isAccountableLocked}
                      >
                        {r.label} — {r.desc}
                        {isAccountableLocked && " (already assigned)"}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {hasAccountable && (
                <p className="text-xs text-muted-foreground mt-1">
                  Only one Accountable is allowed per object. Remove the current Accountable before assigning another.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddRaciOpen(false)}>Cancel</Button>
              <Button onClick={handleAddRaci} disabled={!raciStakeholderId || !raciRole || addRaci.isPending || activeStakeholders.length === 0}>
                {addRaci.isPending ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
