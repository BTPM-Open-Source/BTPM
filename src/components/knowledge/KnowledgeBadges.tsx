import { Badge } from "@/components/ui/badge";
import {
  articleTypeLabel,
  visibilityLabel,
  type KnowledgeArticleStatus,
  type KnowledgeArticleType,
  type KnowledgeArticleVisibility,
} from "@/hooks/useKnowledgeCenter";

export function StatusBadge({ status }: { status: KnowledgeArticleStatus }) {
  const variant: Record<KnowledgeArticleStatus, "default" | "secondary" | "outline"> = {
    published: "default",
    draft: "secondary",
    archived: "outline",
  };
  const label: Record<KnowledgeArticleStatus, string> = {
    published: "Published",
    draft: "Draft",
    archived: "Archived",
  };
  return <Badge variant={variant[status]}>{label[status]}</Badge>;
}

export function VisibilityBadge({ visibility }: { visibility: KnowledgeArticleVisibility }) {
  return <Badge variant="outline">{visibilityLabel(visibility)}</Badge>;
}

export function TypeBadge({ type }: { type: KnowledgeArticleType }) {
  return <Badge variant="secondary">{articleTypeLabel(type)}</Badge>;
}
