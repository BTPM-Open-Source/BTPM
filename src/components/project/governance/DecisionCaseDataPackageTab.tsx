/**
 * DC.14 + DC.16 — Decision Case Data Package tab.
 *
 * Generates a ZIP bundle (DC.16) or legacy JSON-only package (DC.14),
 * lists past package versions, previews/copies/downloads the JSON, and
 * downloads the immutable ZIP via a protected signed-URL flow.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Copy, Check, Download, FileJson, Eye, RefreshCw, Package, AlertTriangle,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  mapCopilotDataPackageError,
  useGenerateGovernanceRecordCopilotDataPackageBundle,
  useGetGovernanceRecordCopilotDataPackageBundleDownloadUrl,
  useGovernanceRecordCopilotDataPackages,
  useMarkGovernanceRecordCopilotDataPackageDownloaded,
  useSetCurrentGovernanceRecordCopilotDataPackage,
  type GovernanceRecordCopilotDataPackage,
} from "@/hooks/useGovernanceCopilotDataPackages";
import { useGovernanceRecordEvidenceFiles } from "@/hooks/useGovernanceEvidenceFiles";
import { useGovernanceRecordEvidenceReferences } from "@/hooks/useGovernanceEvidenceReferences";

type Props = {
  recordId: string;
  canEdit: boolean;
};

function formatDateTime(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function shortHash(h: string | null | undefined) {
  if (!h) return "—";
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;
}

function formatBytes(n: number | null | undefined) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function bundleStatusVariant(s: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  switch (s) {
    case "generated": return "default";
    case "partial": return "secondary";
    case "failed": return "destructive";
    default: return "outline";
  }
}

export function DecisionCaseDataPackageTab({ recordId, canEdit }: Props) {
  const listQ = useGovernanceRecordCopilotDataPackages(recordId);
  const generateBundle = useGenerateGovernanceRecordCopilotDataPackageBundle(recordId);
  const getBundleUrl = useGetGovernanceRecordCopilotDataPackageBundleDownloadUrl(recordId);
  const markDownloaded = useMarkGovernanceRecordCopilotDataPackageDownloaded(recordId);
  const setCurrent = useSetCurrentGovernanceRecordCopilotDataPackage(recordId);

  // Warnings need current evidence-file selection + manual references
  const evidenceFilesQ = useGovernanceRecordEvidenceFiles(recordId, false);
  const manualRefsQ = useGovernanceRecordEvidenceReferences(recordId, false);

  const packages = (listQ.data ?? []) as GovernanceRecordCopilotDataPackage[];
  const current = useMemo(
    () => packages.find((p) => p.is_current) ?? packages[0] ?? null,
    [packages],
  );

  const [previewOf, setPreviewOf] = useState<GovernanceRecordCopilotDataPackage | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selectedEvidenceFilesForPackage = (evidenceFilesQ.data ?? []).filter(
    (f) => f.included_in_package && !f.archived_at,
  );
  const manualReferencesIncluded = (manualRefsQ.data ?? []).filter(
    (r: any) => r.included_in_package && !r.archived_at,
  );

  async function copyJson(p: GovernanceRecordCopilotDataPackage) {
    try {
      await navigator.clipboard.writeText(p.package_json);
      setCopiedId(p.id);
      setTimeout(() => setCopiedId((c) => (c === p.id ? null : c)), 1500);
      toast.success(`Copied v${p.version_number} JSON to clipboard`);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function downloadJson(p: GovernanceRecordCopilotDataPackage) {
    try {
      const blob = new Blob([p.package_json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = p.package_filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      markDownloaded.mutateAsync(p.id).catch(() => {});
      toast.success(`Downloaded ${p.package_filename}`);
    } catch (e) {
      toast.error(mapCopilotDataPackageError(e, "Could not download JSON"));
    }
  }

  async function downloadZip(p: GovernanceRecordCopilotDataPackage) {
    try {
      const res = await getBundleUrl.mutateAsync(p.id);
      const a = document.createElement("a");
      a.href = res.signed_url;
      a.download = res.bundle_filename ?? "decision-data-bundle.zip";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(`Downloading ${res.bundle_filename ?? "case-package.zip"}`);
    } catch (e) {
      toast.error(mapCopilotDataPackageError(e, "Could not download Case Package"));
    }
  }

  async function handleGenerateBundle() {
    if (!canEdit) return;
    try {
      const res = await generateBundle.mutateAsync();
      const note =
        res.bundle_status === "partial"
          ? `Generated Case Package v${res.version_number} (partial — ${res.bundle_failed_file_count} file(s) failed)`
          : `Generated Case Package v${res.version_number}`;
      toast.success(note);
    } catch (e) {
      toast.error(mapCopilotDataPackageError(e, "Could not generate Case Package"));
    }
  }

  async function handleMakeCurrent(id: string) {
    try {
      await setCurrent.mutateAsync(id);
      toast.success("Package set as current");
    } catch (e) {
      toast.error(mapCopilotDataPackageError(e, "Could not change current version"));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Case Package</h2>
            <Badge variant="outline">Optional export</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Generate a downloadable package containing the available Decision
            Case inputs, evidence metadata, BTPM context, AI-generated outputs,
            stakeholder package, decision outcome, and closure information.
            This is optional and does not control the lifecycle.
          </p>
          <p className="text-xs text-muted-foreground">
            Use this for audit, handover, offline review, or archiving. You
            can generate it at any point; missing sections are marked as not
            available yet. You may also use the package for external review
            where allowed by your organization.
          </p>

          {/* Pre-generation warnings */}
          {canEdit && selectedEvidenceFilesForPackage.length === 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>No SharePoint evidence files selected</AlertTitle>
              <AlertDescription>
                The package will contain the manifest and BTPM / manual
                reference metadata only. Source binaries remain in SharePoint.
              </AlertDescription>
            </Alert>
          )}
          {canEdit && manualReferencesIncluded.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Manual references are metadata-only</AlertTitle>
              <AlertDescription>
                Manual references are included as metadata only unless the
                source document is also selected as a SharePoint evidence
                file.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {canEdit ? (
              <Button onClick={handleGenerateBundle} disabled={generateBundle.isPending}>
                {generateBundle.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Package className="h-4 w-4 mr-1" />
                    Generate Case Package
                  </>
                )}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                You have view-only access. You can preview, copy, or download
                existing Case Packages but cannot generate new ones.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Current package card */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Current Case Package</h3>
              {current ? (
                <Badge variant="default">v{current.version_number}</Badge>
              ) : (
                <Badge variant="outline">None yet</Badge>
              )}
              {current && (
                <>
                  <Badge variant="outline">
                    {current.package_format === "zip_bundle" ? "Case package bundle" : "JSON only"}
                  </Badge>
                  {current.package_format === "zip_bundle" && (
                    <Badge variant={bundleStatusVariant(current.bundle_status)}>
                      {current.bundle_status}
                    </Badge>
                  )}
                  <Badge variant="secondary">{current.package_status}</Badge>
                </>
              )}
            </div>
            {current && (
              <div className="text-xs text-muted-foreground">
                Generated {formatDateTime(current.created_at)}
              </div>
            )}
          </div>

          {listQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !current ? (
            <p className="text-sm text-muted-foreground">
              No Case Package generated yet. Use “Generate Case Package” above
              to create the first version.
            </p>
          ) : (
            <>
              {current.package_format === "zip_bundle" && current.bundle_status === "partial" && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Partial bundle</AlertTitle>
                  <AlertDescription>
                    {current.bundle_failed_file_count ?? 0} evidence file(s)
                    could not be packaged. Preview the JSON or open
                    evidence-index.json inside the ZIP for details.
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">JSON filename</div>
                  <div className="truncate font-mono text-xs" title={current.package_filename}>
                    {current.package_filename}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">JSON hash</div>
                  <div className="font-mono text-xs">{shortHash(current.package_hash)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">ZIP filename</div>
                  <div className="truncate font-mono text-xs" title={current.bundle_filename ?? "—"}>
                    {current.bundle_filename ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">ZIP hash</div>
                  <div className="font-mono text-xs">{shortHash(current.bundle_hash)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">ZIP size</div>
                  <div>{formatBytes(current.bundle_size_bytes)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Packaged files</div>
                  <div>{current.bundle_packaged_file_count ?? 0} / {current.bundle_file_count ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Failed files</div>
                  <div>{current.bundle_failed_file_count ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Metadata-only refs</div>
                  <div>{current.bundle_metadata_only_count ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Source projects</div>
                  <div>{current.source_project_ids?.length ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Bundle generated</div>
                  <div>{formatDateTime(current.bundle_generated_at)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">ZIP downloaded</div>
                  <div>{formatDateTime(current.bundle_downloaded_at)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">JSON downloaded</div>
                  <div>{formatDateTime(current.downloaded_at)}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="ghost" onClick={() => setPreviewOf(current)}>
                  <Eye className="h-3.5 w-3.5 mr-1" /> Preview JSON
                </Button>
                <Button size="sm" variant="outline" onClick={() => copyJson(current)}>
                  {copiedId === current.id ? (
                    <><Check className="h-3.5 w-3.5 mr-1" /> Copied</>
                  ) : (
                    <><Copy className="h-3.5 w-3.5 mr-1" /> Copy JSON</>
                  )}
                </Button>
                <Button size="sm" variant="outline" onClick={() => downloadJson(current)}>
                  <FileJson className="h-3.5 w-3.5 mr-1" /> Download JSON
                </Button>
                {current.package_format === "zip_bundle" &&
                 ["generated", "partial"].includes(current.bundle_status) && (
                  <Button
                    size="sm"
                    onClick={() => downloadZip(current)}
                    disabled={getBundleUrl.isPending}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" />
                    {getBundleUrl.isPending ? "Preparing…" : "Download Case Package"}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <h3 className="text-sm font-semibold">Package history</h3>
          {listQ.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Case Packages yet.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {packages.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm flex-wrap"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <Badge variant={p.is_current ? "default" : "outline"}>v{p.version_number}</Badge>
                    {p.is_current && <Badge variant="secondary">Current</Badge>}
                    <Badge variant="outline" className="text-[10px]">
                      {p.package_format === "zip_bundle" ? "Case package bundle" : "JSON only"}
                    </Badge>
                    {p.package_format === "zip_bundle" && (
                      <Badge variant={bundleStatusVariant(p.bundle_status)} className="text-[10px]">
                        {p.bundle_status}
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">{p.package_status}</Badge>
                    <span className="text-muted-foreground font-mono text-xs truncate max-w-[260px]" title={p.package_filename}>
                      {p.package_filename}
                    </span>
                    <span className="text-muted-foreground text-xs">·</span>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(p.created_at)}
                    </span>
                    <span className="text-muted-foreground text-xs font-mono">
                      {shortHash(p.package_hash)}
                    </span>
                    {p.package_format === "zip_bundle" && (
                      <span className="text-muted-foreground text-xs">
                        · {formatBytes(p.bundle_size_bytes)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setPreviewOf(p)}>
                      <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => copyJson(p)}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => downloadJson(p)}>
                      <FileJson className="h-3.5 w-3.5 mr-1" /> JSON
                    </Button>
                    {p.package_format === "zip_bundle" &&
                     ["generated", "partial"].includes(p.bundle_status) && (
                      <Button size="sm" variant="ghost" onClick={() => downloadZip(p)}>
                        <Download className="h-3.5 w-3.5 mr-1" /> ZIP
                      </Button>
                    )}
                    {canEdit && !p.is_current && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleMakeCurrent(p.id)}
                        disabled={setCurrent.isPending}
                      >
                        Make current
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>




      <Dialog open={!!previewOf} onOpenChange={(o) => !o && setPreviewOf(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Case Package preview {previewOf && `· v${previewOf.version_number}`}
            </DialogTitle>
          </DialogHeader>
          {previewOf && (
            <ScrollArea className="h-[60vh] rounded-md border bg-muted/30">
              <pre className="p-3 text-xs font-mono whitespace-pre">
                {previewOf.package_json}
              </pre>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
