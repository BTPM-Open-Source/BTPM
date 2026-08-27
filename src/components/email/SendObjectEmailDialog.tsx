import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type SendObjectTargetType = "project" | "phase" | "task";

export interface SendObjectEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: SendObjectTargetType;
  targetId: string;
  objectName: string;
  /** Lightweight read-only summary lines shown in the dialog preview. */
  summaryLines: Array<{ label: string; value: string | null | undefined }>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRecipients(raw: string): { valid: string[]; invalid: string[] } {
  const tokens = raw
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    if (EMAIL_RE.test(t)) valid.push(t);
    else invalid.push(t);
  }
  return { valid: Array.from(new Set(valid)), invalid };
}

export function SendObjectEmailDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  objectName,
  summaryLines,
}: SendObjectEmailDialogProps) {
  const { toast } = useToast();
  const typeLabel = targetType.charAt(0).toUpperCase() + targetType.slice(1);
  const defaultSubject = `[BTPM] ${typeLabel}: ${objectName}`;

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  // Reset on open so subject reflects current object
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setSubject(defaultSubject);
      setMessage("");
      setTo("");
    }
    onOpenChange(next);
  };

  const handleSend = async () => {
    const { valid, invalid } = parseRecipients(to);
    if (valid.length === 0) {
      toast({
        title: "Add at least one recipient",
        description: "Enter one or more email addresses, separated by commas.",
        variant: "destructive",
      });
      return;
    }
    if (invalid.length > 0) {
      toast({
        title: "Invalid email address",
        description: `Please fix: ${invalid.join(", ")}`,
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-object-email", {
        body: {
          target_type: targetType,
          target_id: targetId,
          recipients: valid,
          subject: subject.trim() || defaultSubject,
          message: message.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data && (data as any).ok === false) {
        throw new Error((data as any).error || "Send failed");
      }
      const sent = (data as any)?.sent_count ?? valid.length;
      const failed = (data as any)?.failed_count ?? 0;
      toast({
        title: failed > 0 ? "Email partially sent" : "Email sent",
        description:
          failed > 0
            ? `Sent to ${sent} of ${sent + failed}. ${(data as any)?.errors?.join("; ") ?? ""}`
            : `Sent to ${sent} recipient${sent === 1 ? "" : "s"}.`,
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Failed to send email",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const visibleSummary = summaryLines.filter(
    (s) => s.value && String(s.value).trim().length > 0,
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Send {targetType} by email
          </DialogTitle>
          <DialogDescription>
            Sends a branded BTPM email with a deep link and a concise summary of this {targetType}.
            Recipients still need a BTPM account to open it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email-to">To</Label>
            <Input
              id="email-to"
              placeholder="name@example.com, another@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Separate multiple emails with commas.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-message">Message (optional)</Label>
            <Textarea
              id="email-message"
              placeholder="Add a short note for the recipient…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={4000}
            />
          </div>

          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {typeLabel} summary (included in email)
            </p>
            {visibleSummary.length === 0 ? (
              <p className="text-sm text-muted-foreground">No summary fields available.</p>
            ) : (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                {visibleSummary.map((s) => (
                  <div key={s.label} className="contents">
                    <dt className="text-muted-foreground">{s.label}</dt>
                    <dd className="text-foreground font-medium break-words">{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" /> Send email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
