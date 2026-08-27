import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldLabel } from "@/components/ui/field-label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  loading?: boolean;
  onSubmit: (email: string) => void;
}

export default function InviteUserDialog({ open, onOpenChange, loading, onSubmit }: Props) {
  const [email, setEmail] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    onSubmit(email.trim());
    setEmail("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>
            Send an invitation email to join the organization. You can assign workspace access after they accept.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <FieldLabel hint="Email address that will receive the invitation link. The user will join your organization once they accept." required>
              Email
            </FieldLabel>
            <Input
              type="email"
              placeholder="user@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!email.trim() || loading}>
              {loading ? "Sending…" : "Send Invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
