/**
 * AI.3 — Admin-only Decision Case evidence reading diagnostic.
 *
 * Lives under Admin → AI Settings, below the Decision Cases settings card.
 * Uses the configured Admin Decision Cases AI model (no OPENAI_MODEL
 * fallback). This is a diagnostic tool only — it does not save a brief.
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  extractDecisionCaseRecordId,
  runDecisionCaseEvidenceReadingDiagnostic,
  type DecisionCaseEvidenceDiagnosticResult,
} from "@/lib/openAiEvidenceSummaryTestService";
import {
  getEvidenceHandlingCategory,
  getEvidenceInputHandlingLabel,
  getEvidenceDisplayName,
  isEmailTextResult,
  isImageInputResult,
  formatEvidenceBytes,
} from "@/lib/decisionCaseAiEvidenceLabels";
import type { AiFeatureSettingsRow } from "@/hooks/useAiSettings";

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

interface Props {
  decisionCasesSetting: AiFeatureSettingsRow | undefined;
}

export function DecisionCaseEvidenceDiagnostic({ decisionCasesSetting }: Props) {
  const [input, setInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [result, setResult] = useState<DecisionCaseEvidenceDiagnosticResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = !!decisionCasesSetting?.enabled;
  const requireConfirm = !!decisionCasesSetting?.require_user_confirmation;

  async function executeDiagnostic(recordId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await runDecisionCaseEvidenceReadingDiagnostic(recordId);
      setResult(res);
      toast.success(
        `Evidence reading test complete — ${res.files_sent_count} sent, ${res.files_skipped_count} skipped`,
      );
    } catch (e: any) {
      const msg = String(e?.message ?? "Evidence reading test failed");
      setError(msg);
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  function onRunClick() {
    setValidation(null);
    setError(null);
    const recordId = extractDecisionCaseRecordId(input);
    if (!recordId) {
      setValidation("Enter a Decision Case URL or a valid governance record UUID.");
      return;
    }
    if (requireConfirm) {
      setConfirmOpen(true);
    } else {
      void executeDiagnostic(recordId);
    }
  }

  function onConfirm() {
    setConfirmOpen(false);
    const recordId = extractDecisionCaseRecordId(input);
    if (!recordId) return;
    void executeDiagnostic(recordId);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Decision Case evidence reading diagnostic</CardTitle>
          <Badge variant="outline" className="text-[10px]">Diagnostic</Badge>
        </div>
        <CardDescription>
          Test whether the configured Decision Cases AI model can read
          included SharePoint evidence files for a selected Decision Case.
          This is an admin diagnostic tool and does not save a brief
          version.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Governance note</AlertTitle>
          <AlertDescription>
            Use only for documents approved for AI processing. Included
            SharePoint evidence files are sent to the configured AI provider
            for one-time processing during this test.
          </AlertDescription>
        </Alert>

        {!enabled && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Decision Cases AI is disabled</AlertTitle>
            <AlertDescription>
              Enable Decision Cases AI settings above to run this diagnostic.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="decision-case-id-input">
            Decision Case URL or record ID
          </Label>
          <Input
            id="decision-case-id-input"
            placeholder="Paste a Decision Case URL or governance record ID"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setValidation(null);
            }}
            disabled={!enabled || pending}
          />
          {validation && (
            <p className="text-xs text-destructive">{validation}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onRunClick} disabled={!enabled || pending}>
            {pending ? (
              <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Running…</>
            ) : (
              <>Test evidence reading</>
            )}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Diagnostic failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <div className="mt-3 space-y-2 rounded-md border p-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Model</div>
                <div className="font-mono text-xs truncate" title={result.model}>
                  {result.model}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Model source</div>
                <div className="text-xs">{result.model_source}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Files sent</div>
                <div>{result.files_sent_count}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Files skipped</div>
                <div>{result.files_skipped_count}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total bytes sent</div>
                <div>{formatEvidenceBytes(result.total_bytes_sent)}</div>
              </div>
              <div className="col-span-2 md:col-span-3">
                <div className="text-xs text-muted-foreground">Generated</div>
                <div>{formatDateTime(result.generated_at)}</div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              BTPM sends only evidence files marked as included. Images are
              sent as visual inputs. Email files are read as email text;
              embedded attachments are not extracted unless selected
              separately.
            </p>

            <div>
              <div className="text-xs text-muted-foreground mb-1">Per-file status</div>
              <div className="divide-y rounded-md border text-xs">
                {result.file_results.map((r) => {
                  const category = getEvidenceHandlingCategory(r);
                  return (
                    <div
                      key={r.evidence_file_id}
                      className="flex items-center justify-between gap-2 px-2 py-1"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono" title={getEvidenceDisplayName(r)}>
                          {getEvidenceDisplayName(r)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {(r.file_extension ?? r.mime_type ?? "—")}
                          {r.bytes_sent != null ? ` · ${formatEvidenceBytes(r.bytes_sent)}` : ""}
                          {r.status !== "sent" && (r as any).detail ? ` · ${(r as any).detail}` : ""}
                        </div>
                      </div>
                      <Badge
                        variant={category === "skipped" ? "outline" : "secondary"}
                        className="text-[10px] shrink-0"
                      >
                        {getEvidenceInputHandlingLabel(r)}
                      </Badge>
                    </div>
                  );
                })}
                {result.file_results.some((r) => isEmailTextResult(r)) && (
                  <div className="px-2 py-1 text-[10px] text-muted-foreground">
                    .eml attachments are not extracted. Select important
                    attachments separately as evidence files.
                  </div>
                )}
                {result.file_results.some((r) => isImageInputResult(r) && r.status === "sent") && (
                  <div className="px-2 py-1 text-[10px] text-muted-foreground">
                    Image evidence was attempted as visual input
                    (`input_image`).
                  </div>
                )}
              </div>
            </div>


            <div>
              <div className="text-xs text-muted-foreground mb-1">Summary</div>
              <ScrollArea className="h-[40vh] rounded-md border bg-muted/30">
                <pre className="p-3 text-xs whitespace-pre-wrap font-sans">
                  {result.summary_text}
                </pre>
              </ScrollArea>
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run evidence reading test?</AlertDialogTitle>
            <AlertDialogDescription>
              This diagnostic sends included SharePoint evidence files from
              the selected Decision Case to the configured AI provider for
              one-time processing. BTPM will not upload them as persistent
              provider files and will not store raw file bytes. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
