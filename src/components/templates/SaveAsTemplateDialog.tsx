import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().trim().nonempty({ message: "Template name is required" }).max(200, { message: "Name must be 200 characters or less" }),
  description: z.string().trim().max(2000, { message: "Description must be 2000 characters or less" }).optional(),
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceId: string;
  defaultName: string;
}

export function SaveAsTemplateDialog({ open, onOpenChange, projectId, workspaceId, defaultName }: Props) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setDescription("");
      setError(null);
    }
  }, [open, defaultName]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("save_project_template_from_project", {
        _project_id: projectId,
        _template_name: name.trim(),
        _template_description: description.trim() || null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-templates", workspaceId] });
      toast({
        title: "Template saved",
        description: `"${name.trim()}" is now available in this workspace's Templates.`,
      });
      onOpenChange(false);
      navigate(`/workspace/${workspaceId}/templates`);
    },
    onError: (e: any) => {
      setError(e.message || "Failed to save template");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ name, description });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message || "Invalid input");
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saveMutation.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Saves the project's reusable structure (phases, tasks, dependencies, KPIs, agile setup). Execution
            history, comments, and assignments are not copied. The template appears in this workspace's Templates tab.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Template name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">Description (optional)</Label>
            <Textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="What is this template good for?"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">{error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saveMutation.isPending || !name.trim()}>
              {saveMutation.isPending ? "Saving…" : "Save template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
