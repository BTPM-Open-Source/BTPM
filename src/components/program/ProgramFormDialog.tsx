import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FieldLabel } from "@/components/ui/field-label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Constants } from "@/integrations/supabase/types";

const statuses = Constants.public.Enums.pm_status;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  program?: { name: string; status: string; description: string | null } | null;
  onSave: (data: { name: string; status?: string; description?: string }) => Promise<void>;
  saving: boolean;
}

export function ProgramFormDialog({ open, onOpenChange, program, onSave, saving }: Props) {
  const isEdit = !!program;
  const [name, setName] = useState("");
  const [status, setStatus] = useState("planned");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setName(program?.name || "");
      setStatus(program?.status || "planned");
      setDescription(program?.description || "");
    }
  }, [open, program]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      name: name.trim(),
      ...(isEdit ? { status } : {}),
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Program" : "New Program"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <FieldLabel hint="A short, recognisable name for this program. Programs group related projects under a single delivery umbrella." required>
              Program Name
            </FieldLabel>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          {isEdit && (
            <div className="space-y-1">
              <FieldLabel hint="Lifecycle state of the program: planned → active → on hold / completed / cancelled.">
                Status
              </FieldLabel>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => (
                    <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <FieldLabel hint="Optional notes about the purpose, scope or stakeholders of this program.">
              Description
            </FieldLabel>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : isEdit ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
