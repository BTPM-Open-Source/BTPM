import { Link } from "react-router-dom";
import { FolderOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ProjectOverviewQuickLinksCardProps {
  workspaceId: string;
  projectId: string;
}

/**
 * Compact Files entry point on Overview. Replaces the full
 * SharepointDocumentSection so Overview does not surface a file list.
 * Real file management still lives at the dedicated /files route.
 */
export function ProjectOverviewQuickLinksCard({
  workspaceId,
  projectId,
}: ProjectOverviewQuickLinksCardProps) {
  return (
    <Card>
      <CardContent className="py-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-md bg-muted p-2 text-muted-foreground">
            <FolderOpen className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Files</p>
            <p className="text-xs text-muted-foreground">
              Project files are managed in Shared Files.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/workspace/${workspaceId}/project/${projectId}/files`}>
            Open Shared Files
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
