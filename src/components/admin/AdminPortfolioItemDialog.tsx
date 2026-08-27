import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import {
  useAdminPortfolioMutations,
  type AdminPortfolioItem,
  type PortfolioLifecycleState,
  type PortfolioStrategicPriority,
  PORTFOLIO_LIFECYCLE_STATES,
  PORTFOLIO_STRATEGIC_PRIORITIES,
  portfolioLifecycleLabel,
  portfolioStrategicPriorityLabel,
} from "@/hooks/useAdminPortfolioItems";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  item: AdminPortfolioItem | null;
}

const NO_OWNER = "__none__";

export default function AdminPortfolioItemDialog({
  open,
  onOpenChange,
  organizationId,
  item,
}: Props) {
  const isEdit = !!item;
  const { data: users } = useAdminUsers(organizationId);
  const mutations = useAdminPortfolioMutations(organizationId);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [lifecycle, setLifecycle] = useState<PortfolioLifecycleState>("opportunity_candidate");
  const [priority, setPriority] = useState<PortfolioStrategicPriority>("medium");
  const [ownerId, setOwnerId] = useState<string>(NO_OWNER);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setCode(item?.code ?? "");
    setDescription(item?.description ?? "");
    setLifecycle((item?.lifecycle_state as PortfolioLifecycleState) ?? "opportunity_candidate");
    setPriority((item?.strategic_priority as PortfolioStrategicPriority) ?? "medium");
    setOwnerId(item?.owner_id ?? NO_OWNER);
    setNameError(null);
  }, [open, item]);

  const ownerOptions = useMemo(() => {
    return (users ?? [])
      .filter(
        (u) => u.row_kind === "active_user" && !!u.user_id && u.status === "active",
      )
      .map((u) => ({
        id: u.user_id as string,
        label: u.display_name?.trim() || u.email,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const submitting =
    mutations.createPortfolioItem.isPending || mutations.updatePortfolioItem.isPending;

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Name is required");
      return;
    }
    if (trimmedName.length > 200) {
      setNameError("Name must be 200 characters or fewer");
      return;
    }
    const trimmedCode = code.trim();
    if (trimmedCode.length > 80) return;
    const trimmedDesc = description.trim();
    if (trimmedDesc.length > 4000) return;

    const payload = {
      name: trimmedName,
      code: trimmedCode ? trimmedCode : null,
      description: trimmedDesc ? trimmedDesc : null,
      lifecycle_state: lifecycle,
      strategic_priority: priority,
      owner_id: ownerId === NO_OWNER ? null : ownerId,
    };

    try {
      if (isEdit && item) {
        await mutations.updatePortfolioItem.mutateAsync({ id: item.id, ...payload });
      } else {
        await mutations.createPortfolioItem.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {
      /* toast surfaced by mutation */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Portfolio" : "New Portfolio"}</DialogTitle>
          <DialogDescription>
            Portfolio is an organization-level grouping used to connect projects
            across workspaces.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pf-name">Name<span className="text-destructive"> *</span></Label>
            <Input
              id="pf-name"
              value={name}
              maxLength={200}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              placeholder="e.g. FY26 Growth Initiatives"
            />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pf-code">Code / reference</Label>
            <Input
              id="pf-code"
              value={code}
              maxLength={80}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Optional short code"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pf-desc">Description</Label>
            <Textarea
              id="pf-desc"
              value={description}
              maxLength={4000}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Lifecycle stage</Label>
              <Select
                value={lifecycle}
                onValueChange={(v) => setLifecycle(v as PortfolioLifecycleState)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PORTFOLIO_LIFECYCLE_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {portfolioLifecycleLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Strategic priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as PortfolioStrategicPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PORTFOLIO_STRATEGIC_PRIORITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {portfolioStrategicPriorityLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Owner</Label>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_OWNER}>No owner</SelectItem>
                {ownerOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {isEdit ? "Save changes" : "Create Portfolio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
