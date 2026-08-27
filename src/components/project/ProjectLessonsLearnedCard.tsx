// Phase 6C — Step 6C.7 — Lessons Learned document card.
//
// UI-only card for the Project Overview → Documents & Reports section.
// Reads decrypted metadata via the Step 6C.6 hook (protected RPC) and
// invokes protected edge functions for create/reuse and refresh. Content
// stays in SharePoint — this card never fetches or previews the document
// body.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileDown, FilePlus, Lightbulb, Loader2, RefreshCw } from "lucide-react";
import {
  useCreateProjectLessonsLearnedDocument,
  useProjectLessonsLearnedDocument,
  useRefreshProjectLessonsLearnedDocumentMetadata,
  type ProjectLessonsLearnedStatus,
} from "@/hooks/useProjectLessonsLearnedDocument";

interface Props {
  projectId: string;
  canEdit: boolean;
}

type EffectiveStatus = ProjectLessonsLearnedStatus;

function statusBadge(status: EffectiveStatus) {
  switch (status) {
    case "available":
      return <Badge variant="secondary">Available</Badge>;
    case "missing_folder":
      return <Badge variant="outline">Project folder missing</Badge>;
    case "creation_failed":
      return <Badge variant="destructive">Creation failed</Badge>;
    case "link_broken":
      return <Badge variant="destructive">Link broken</Badge>;
    case "not_created":
    default:
      return <Badge variant="outline">Not created</Badge>;
  }
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

export function ProjectLessonsLearnedCard({ projectId, canEdit }: Props) {
  const { data, isLoading, isError, refetch, isFetching } =
    useProjectLessonsLearnedDocument(projectId);
  const createMut = useCreateProjectLessonsLearnedDocument(projectId);
  const refreshMut = useRefreshProjectLessonsLearnedDocumentMetadata(projectId);

  const status: EffectiveStatus = data?.status ?? "not_created";
  const busy = createMut.isPending || refreshMut.isPending;

  const onCreate = () => {
    if (busy) return;
    createMut.mutate();
  };
  const onRefresh = () => {
    if (busy) return;
    refreshMut.mutate();
  };

  const openUrl =
    status === "available" && data?.sharepoint_web_url
      ? data.sharepoint_web_url
      : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-muted-foreground" />
          Lessons Learned
          <span className="ml-auto">{statusBadge(status)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
          </div>
        ) : isError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              Could not load Lessons Learned metadata.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Retry
            </Button>
          </div>
        ) : (
          <>
            <BodyForStatus status={status} data={data} canEdit={canEdit} />

            <div className="flex flex-wrap gap-2 pt-1">
              {/* Available — Open in SharePoint */}
              {status === "available" && openUrl && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() =>
                    window.open(openUrl, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Open in SharePoint
                </Button>
              )}

              {/* Available but URL missing → editors can refresh */}
              {status === "available" && !openUrl && canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRefresh}
                  disabled={busy}
                >
                  {refreshMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Refresh metadata
                </Button>
              )}

              {/* Editor-only actions */}
              {canEdit && (status === "not_created") && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={onCreate}
                  disabled={busy}
                >
                  {createMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <FileDown className="h-4 w-4 mr-1" />
                  )}
                  Create in SharePoint
                </Button>
              )}

              {canEdit && status === "missing_folder" && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={onCreate}
                  disabled={busy}
                >
                  {createMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Try again
                </Button>
              )}

              {canEdit && status === "creation_failed" && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={onCreate}
                    disabled={busy}
                  >
                    {createMut.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    Try again
                  </Button>
                  {data?.sharepoint_drive_id && data?.sharepoint_item_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onRefresh}
                      disabled={busy}
                    >
                      {refreshMut.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-1" />
                      )}
                      Refresh metadata
                    </Button>
                  )}
                </>
              )}

              {canEdit && status === "link_broken" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRefresh}
                    disabled={busy}
                  >
                    {refreshMut.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1" />
                    )}
                    Refresh metadata
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={onCreate}
                    disabled={busy}
                  >
                    {createMut.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <FilePlus className="h-4 w-4 mr-1" />
                    )}
                    Create / reuse in SharePoint
                  </Button>
                </>
              )}

              {/* Available + editor: refresh metadata secondary action */}
              {canEdit && status === "available" && openUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRefresh}
                  disabled={busy}
                >
                  {refreshMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Refresh metadata
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface BodyProps {
  status: EffectiveStatus;
  data: ReturnType<typeof useProjectLessonsLearnedDocument>["data"];
  canEdit: boolean;
}

function BodyForStatus({ status, data, canEdit }: BodyProps) {
  const modified = formatDate(data?.last_modified_at);
  const refreshed = formatDate(data?.metadata_refreshed_at);

  if (status === "not_created") {
    return (
      <p className="text-sm text-muted-foreground">
        {canEdit
          ? "Create a SharePoint Lessons Learned document from BTPM's built-in starter template. The document content will remain in SharePoint."
          : "No Lessons Learned document has been linked yet."}
      </p>
    );
  }

  if (status === "missing_folder") {
    return (
      <p className="text-sm text-muted-foreground">
        This project is not linked to a validated SharePoint folder yet. Link
        or validate the project folder before creating Lessons Learned.
      </p>
    );
  }

  if (status === "creation_failed") {
    return (
      <p className="text-sm text-muted-foreground">
        BTPM could not create the Lessons Learned document in SharePoint. Check
        the project SharePoint folder and access, then try again.
      </p>
    );
  }

  if (status === "link_broken") {
    return (
      <div className="space-y-1 text-sm">
        <p className="text-muted-foreground">
          The linked SharePoint document could not be found. Refresh metadata
          or recreate/reuse the document from the project folder.
        </p>
        {data?.document_name && (
          <div className="text-xs text-muted-foreground">
            Last known name:{" "}
            <span className="text-foreground break-all">
              {data.document_name}
            </span>
          </div>
        )}
      </div>
    );
  }

  // available
  const url = data?.sharepoint_web_url ?? null;
  return (
    <div className="space-y-1 text-sm">
      {data?.document_name && (
        <div className="font-medium text-foreground break-all">
          {data.document_name}
        </div>
      )}
      {modified && (
        <div className="text-xs text-muted-foreground">
          Last modified: {modified}
        </div>
      )}
      {refreshed && (
        <div className="text-xs text-muted-foreground">
          Metadata refreshed: {refreshed}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Content is edited in SharePoint.
      </p>
      {!url && (
        <p className="text-xs text-destructive">
          Document metadata is incomplete. Refresh metadata.
        </p>
      )}
    </div>
  );
}
