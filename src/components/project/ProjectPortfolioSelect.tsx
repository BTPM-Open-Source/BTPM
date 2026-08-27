import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { PortfolioPickerItem } from "@/hooks/useProjectPortfolio";

export interface AssignedPortfolioDisplay {
  id: string;
  name: string;
  code: string | null;
  is_archived?: boolean;
}

interface Props {
  value: string; // portfolio id or "none"
  onChange: (value: string) => void;
  items: PortfolioPickerItem[];
  currentAssigned?: AssignedPortfolioDisplay | null;
  loading?: boolean;
  disabled?: boolean;
  labelId?: string;
}

function formatOption(name: string, code: string | null): string {
  return code ? `${code} — ${name}` : name;
}

export function ProjectPortfolioSelect({
  value,
  onChange,
  items,
  currentAssigned,
  loading,
  disabled,
  labelId,
}: Props) {
  const activeIds = new Set(items.map((i) => i.id));
  // If current assignment exists but is not returned by the active picker
  // (e.g. archived), we still need to display it as the selected option.
  const showArchivedCurrent =
    !!currentAssigned && !activeIds.has(currentAssigned.id);

  return (
    <div className="space-y-1.5">
      <Label id={labelId}>Portfolio (optional)</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled || loading}>
        <SelectTrigger>
          <SelectValue placeholder={loading ? "Loading…" : "No Portfolio"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No Portfolio</SelectItem>
          {showArchivedCurrent && currentAssigned && (
            <SelectItem value={currentAssigned.id}>
              {formatOption(currentAssigned.name, currentAssigned.code)}
              {currentAssigned.is_archived ? " (archived)" : ""}
            </SelectItem>
          )}
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {formatOption(item.name, item.code)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Portfolio is an organization-level grouping used to connect projects across workspaces. Programs remain workspace-level groupings.
      </p>
    </div>
  );
}
