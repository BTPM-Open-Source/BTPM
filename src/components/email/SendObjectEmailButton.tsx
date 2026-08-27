import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { SendObjectEmailDialog, type SendObjectTargetType } from "./SendObjectEmailDialog";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";

interface SendObjectEmailButtonProps {
  /** Workspace ID — retained for parity with existing callers; not used for auth. */
  workspaceId: string | undefined;
  /** Project ID — used for project-level PM authority check. Required. */
  projectId: string | undefined;
  targetType: SendObjectTargetType;
  targetId: string;
  objectName: string;
  summaryLines: Array<{ label: string; value: string | null | undefined }>;
  /** Visual variant for the trigger button. Defaults to "outline". */
  variant?: "outline" | "ghost" | "default" | "secondary";
  size?: "sm" | "default";
}

/**
 * Lightweight Send Email trigger used on Project / Phase / Task object surfaces.
 *
 * Visibility is gated on project-level PM authority (org admin / workspace
 * admin / project_manager on the specific project). The backend re-enforces
 * the same authority; this hide is a usability nicety.
 */
export function SendObjectEmailButton({
  projectId,
  targetType,
  targetId,
  objectName,
  summaryLines,
  variant = "outline",
  size = "sm",
}: SendObjectEmailButtonProps) {
  const [open, setOpen] = useState(false);
  const { canEdit } = useProjectPlanningAuthority(projectId);

  if (!canEdit) return null;

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Mail className="h-4 w-4 mr-1.5" />
        Send email
      </Button>
      <SendObjectEmailDialog
        open={open}
        onOpenChange={setOpen}
        targetType={targetType}
        targetId={targetId}
        objectName={objectName}
        summaryLines={summaryLines}
      />
    </>
  );
}
