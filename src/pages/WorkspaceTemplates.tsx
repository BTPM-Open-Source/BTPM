import { useState } from "react";
import { useParams } from "react-router-dom";
import { useWorkspaceTemplates } from "@/hooks/useProjectTemplates";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Archive, FileStack, ShieldAlert } from "lucide-react";
import { TemplateDetailSheet } from "@/components/templates/TemplateDetailSheet";
import { format } from "date-fns";
import { usePersistedViewState, codecs } from "@/hooks/usePersistedViewState";

export default function WorkspaceTemplates({ workspaceId: workspaceIdProp }: { workspaceId?: string } = {}) {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = workspaceIdProp ?? params.workspaceId;
  const { state: vs, setField } = usePersistedViewState({
    viewId: "workspace-templates",
    scopeKey: workspaceId ?? "none",
    schema: {
      showArchived: { mode: "local", default: false, codec: codecs.boolean },
    },
  });
  const showArchived = vs.showArchived;
  const setShowArchived = (v: boolean) => setField("showArchived", v);
  const { data: templates, isLoading, error } = useWorkspaceTemplates(workspaceId, showArchived);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openTemplate = (id: string) => {
    setSelectedId(id);
    setSheetOpen(true);
  };

  const isUnauthorized = error && /access|permission|denied|unauthor/i.test((error as Error).message);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Reusable project blueprints saved in this workspace.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)}>
            <Archive className="h-4 w-4 mr-1" />
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {error && isUnauthorized && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center text-center space-y-2">
            <ShieldAlert className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">You do not have permission to view templates in this workspace.</p>
          </CardContent>
        </Card>
      )}

      {error && !isUnauthorized && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Failed to load templates: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && templates && templates.length === 0 && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center text-center space-y-2">
            <FileStack className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {showArchived ? "No archived templates." : "This workspace has no templates yet."}
            </p>
            <p className="text-xs text-muted-foreground">
              Templates are reusable project blueprints. Create one from any existing project using <span className="font-medium">Save as template</span>.
            </p>
          </CardContent>
        </Card>
      )}

      {templates && templates.length > 0 && (
        <div className="space-y-2">
          {templates.map((t) => (
            <Card
              key={t.template_id}
              className={`hover:bg-accent/50 transition-colors cursor-pointer ${t.is_archived ? "opacity-60" : ""}`}
              onClick={() => openTemplate(t.template_id)}
            >
              <CardContent className="py-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{t.name || "Untitled template"}</p>
                    {t.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 shrink-0">
                    {t.is_archived && <Badge variant="secondary">Archived</Badge>}
                    {t.agile_enabled && <Badge variant="outline">Agile</Badge>}
                    {t.schedule_mode && <Badge variant="outline">{t.schedule_mode}</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{t.summary_counts?.phases ?? 0} phases</span>
                  <span>{t.summary_counts?.tasks ?? 0} tasks</span>
                  <span>{t.summary_counts?.dependencies ?? 0} deps</span>
                  <span>{t.summary_counts?.kpi_definitions ?? 0} KPIs</span>
                  <span>{t.summary_counts?.workflow_states ?? 0} states</span>
                  <span>{t.summary_counts?.sprints ?? 0} sprints</span>
                  <span>{t.summary_counts?.backlog_items ?? 0} backlog</span>
                  <span className="ml-auto">v{t.blueprint_version} · updated {format(new Date(t.updated_at), "PP")}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TemplateDetailSheet
        workspaceId={workspaceId}
        templateId={selectedId}
        open={sheetOpen}
        onOpenChange={(o) => {
          setSheetOpen(o);
          if (!o) setSelectedId(null);
        }}
      />
    </div>
  );
}
