import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PM_WORKFLOW_STATUS_VALUES, getPmWorkflowStatusLabel, getPmWorkflowStatusBadgeClass } from "@/lib/btpmVisualSemantics";

interface Props {
  currentStatus: string;
  canEdit: boolean;
  onStatusChange: (status: string) => void;
  isPending?: boolean;
}

export function StatusUpdateControl({ currentStatus, canEdit, onStatusChange, isPending }: Props) {
  if (!canEdit) {
    return (
      <span className={`text-sm px-2 py-1 rounded ${getPmWorkflowStatusBadgeClass(currentStatus)}`}>
        {getPmWorkflowStatusLabel(currentStatus)}
      </span>
    );
  }

  return (
    <Select value={currentStatus} onValueChange={onStatusChange} disabled={isPending}>
      <SelectTrigger className="w-36 h-8 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PM_WORKFLOW_STATUS_VALUES.map((s) => (
          <SelectItem key={s} value={s}>{getPmWorkflowStatusLabel(s)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
