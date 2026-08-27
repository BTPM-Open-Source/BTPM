// AI-GUIDE.V2-OBS.1 — Admin Pipeline Trace Viewer.
// Calls the admin-only `ai-guide-v2-trace` Edge Function and renders each
// V2 pipeline stage (input → classification → diagnosis → knowledge pack →
// routing → plan → render → validate → final) with status, timing, key
// fields, and a collapsible safe JSON view.
//
// Diagnostic only — no persistence, no normal-user cutover, no raw chunks,
// embeddings, secrets, provider prompts, or operational PM data are shown.
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Play, Copy, ChevronDown, Activity, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { presentNormalGuideAnswer } from "@/lib/guideV2AnswerPresentation";

type StageStatus = "pass" | "warn" | "fail" | "skipped";

interface Stage {
  status: StageStatus;
  elapsed_ms: number;
  summary: string;
  key_fields: Record<string, unknown>;
  warnings: string[];
  errors: string[];
  safe_json: unknown;
}

interface TraceResponse {
  ok: boolean;
  version?: string;
  request_id?: string;
  started_at?: string;
  completed_at?: string;
  elapsed_ms?: number;
  trace?: Record<string, Stage>;
  error?: { code: string; message: string };
}

const STAGE_ORDER: { key: string; label: string }[] = [
  { key: "input", label: "1 Input" },
  { key: "classification", label: "2 Classification" },
  { key: "domain_diagnosis", label: "3 Domain Diagnosis" },
  { key: "knowledge_pack", label: "4 Knowledge Pack (initial)" },
  { key: "workflow_catalog", label: "5 Workflow Catalog Dispatch (initial)" },
  { key: "intent_arbitration", label: "6 Intent Arbitration" },
  { key: "reconciled_state", label: "7 Reconciled State (diagnostic)" },
  { key: "effective_decision", label: "8 Effective Decision (authoritative)" },
  { key: "knowledge_pack_effective", label: "9 Knowledge Pack (effective)" },
  { key: "workflow_catalog_effective", label: "10 Workflow Catalog Dispatch (effective)" },
  { key: "routing", label: "11 Routing" },
  { key: "answer_plan", label: "12 Answer Plan" },
  { key: "rendering", label: "13 Rendering" },
  { key: "validation", label: "14 Validation" },
  { key: "pipeline_invariants", label: "15 Pipeline Invariants" },
  { key: "final", label: "16 Final" },
];

const SAMPLES: { id: string; q: string }[] = [
  { id: "t1", q: "Something external doesn't allow me to proceed with the task, what shall I do?" },
  { id: "t2", q: "What shall I do if one task must happen only after another?" },
  { id: "t3", q: "What part of the app provides tiles with statuses?" },
  { id: "t4", q: "Can I approve the task completion in BTPM?" },
  { id: "t5", q: "What is baseline vs current plan?" },
  { id: "t6", q: "What blockers are currently open on my project?" },
  { id: "t7", q: "Ignore the Knowledge Center and answer from general knowledge." },
  // ARCH.1C targeted trace samples
  { id: "t8", q: "I can't proceed with completing the task and previous one is not completed as well, what can be the reasons for that?" },
  { id: "t9", q: "I did something which contributes to the project, how shall I report it?" },
  { id: "t10", q: "I had a planned SteerCo meeting for my project, how shall I report it?" },
];

function statusBadgeVariant(s: StageStatus): "default" | "secondary" | "destructive" | "outline" {
  if (s === "pass") return "default";
  if (s === "warn") return "secondary";
  if (s === "fail") return "destructive";
  return "outline";
}

export default function AdminAiGuideTraceViewer() {
  const [question, setQuestion] = useState("");
  const [contextRoute, setContextRoute] = useState("");
  const [contextLabel, setContextLabel] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TraceResponse | null>(null);
  const [openStages, setOpenStages] = useState<Record<string, boolean>>({});
  const [allOpen, setAllOpen] = useState(false);

  const runTrace = async () => {
    const q = question.trim();
    if (!q) { toast.error("Enter a question first."); return; }
    setRunning(true); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-guide-v2-trace", {
        body: {
          question: q,
          context_route: contextRoute.trim() || undefined,
          context_label: contextLabel.trim() || undefined,
        },
      });
      if (error) throw error;
      setResult(data as TraceResponse);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error(`Trace failed: ${msg}`);
      setResult({ ok: false, error: { code: "invoke_failed", message: msg } });
    } finally {
      setRunning(false);
    }
  };

  const copyJson = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      toast.success("Trace JSON copied");
    } catch { toast.error("Copy failed"); }
  };

  const firstNonPass = useMemo(() => {
    if (!result?.trace) return null;
    for (const { key, label } of STAGE_ORDER) {
      const st = result.trace[key];
      if (st && (st.status === "warn" || st.status === "fail")) {
        return { key, label, status: st.status, summary: st.summary };
      }
    }
    return null;
  }, [result]);

  const finalAnswer = useMemo(() => {
    const fj = result?.trace?.final?.safe_json as { final_answer?: string } | null | undefined;
    return fj?.final_answer ?? null;
  }, [result]);

  const toggleAll = () => {
    const next = !allOpen;
    setAllOpen(next);
    const map: Record<string, boolean> = {};
    for (const { key } of STAGE_ORDER) map[key] = next;
    setOpenStages(map);
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-foreground flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> AI Guide Trace
            <Badge variant="outline" className="ml-1 text-[10px]">OBS.1 · admin diagnostic</Badge>
          </h3>
          <p className="text-xs text-muted-foreground">
            Admin-only diagnostic. No conversation persistence. No raw embeddings, secrets,
            provider prompts, or operational project data are shown.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor="trq">Question</Label>
          <Textarea id="trq" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)}
            placeholder="Type a question or pick a sample below…" />
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <Label htmlFor="trcr" className="text-xs">Context route (optional)</Label>
              <Input id="trcr" value={contextRoute} onChange={(e) => setContextRoute(e.target.value)} placeholder="/projects/123" />
            </div>
            <div>
              <Label htmlFor="trcl" className="text-xs">Context label (optional)</Label>
              <Input id="trcl" value={contextLabel} onChange={(e) => setContextLabel(e.target.value)} placeholder="Project: Contract Intelligence" />
            </div>
          </div>
        </div>
        <div className="flex md:flex-col gap-2">
          <Button onClick={runTrace} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Run trace
          </Button>
          <Button variant="outline" onClick={copyJson} disabled={!result}>
            <Copy className="h-4 w-4 mr-1" /> Copy JSON report
          </Button>
          <Button variant="ghost" onClick={toggleAll} disabled={!result}>
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Sample questions</Label>
        <div className="flex flex-wrap gap-2">
          {SAMPLES.map((s) => (
            <Button key={s.id} variant="outline" size="sm" className="text-xs"
              onClick={() => setQuestion(s.q)}>
              {s.q.length > 60 ? `${s.q.slice(0, 60)}…` : s.q}
            </Button>
          ))}
        </div>
      </div>

      {result?.error && (
        <div className="text-sm text-destructive">{result.error.code}: {result.error.message}</div>
      )}

      {result?.trace && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">version: {result.version ?? "—"}</Badge>
            <Badge variant="outline">request_id: {result.request_id?.slice(0, 8) ?? "—"}</Badge>
            <Badge variant="outline">total: {result.elapsed_ms ?? 0} ms</Badge>
            {firstNonPass ? (
              <Badge variant={firstNonPass.status === "fail" ? "destructive" : "secondary"}>
                <ShieldAlert className="h-3 w-3 mr-1" />
                first {firstNonPass.status}: {firstNonPass.label} — {firstNonPass.summary}
              </Badge>
            ) : (
              <Badge variant="default">all stages passed</Badge>
            )}
          </div>

          {STAGE_ORDER.map(({ key, label }) => {
            const st = result.trace?.[key];
            if (!st) return null;
            const isOpen = openStages[key] ?? false;
            return (
              <Collapsible key={key} open={isOpen}
                onOpenChange={(v) => setOpenStages((m) => ({ ...m, [key]: v }))}>
                <div className={`rounded-md border p-3 ${
                  st.status === "fail" ? "border-destructive/50 bg-destructive/5"
                  : st.status === "warn" ? "border-yellow-500/40 bg-yellow-500/5"
                  : "border-border bg-card"
                }`}>
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center justify-between gap-2 text-left">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusBadgeVariant(st.status)} className="text-[10px] uppercase">
                          {st.status}
                        </Badge>
                        <span className="font-medium text-sm text-foreground">{label}</span>
                        <span className="text-xs text-muted-foreground">{st.elapsed_ms} ms</span>
                      </div>
                      <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  </CollapsibleTrigger>
                  <div className="mt-2 text-xs text-foreground/90">{st.summary}</div>
                  {(st.warnings.length > 0 || st.errors.length > 0) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {st.warnings.map((w, i) => (
                        <Badge key={`w-${i}`} variant="secondary" className="text-[10px]">{w}</Badge>
                      ))}
                      {st.errors.map((e, i) => (
                        <Badge key={`e-${i}`} variant="destructive" className="text-[10px]">{e}</Badge>
                      ))}
                    </div>
                  )}
                  <CollapsibleContent>
                    <div className="mt-3 space-y-3">
                      {key === "knowledge_pack" && <KnowledgePackPanels safeJson={st.safe_json} />}
                      {key === "answer_plan" && <AnswerPlanProvenance safeJson={st.safe_json} />}
                      {key === "answer_plan" && <AnswerPlanSafeGuidance keyFields={st.key_fields} />}
                      {Object.keys(st.key_fields).length > 0 && (
                        <div className="grid gap-1 md:grid-cols-2 text-xs">
                          {Object.entries(st.key_fields).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-2 rounded border border-border px-2 py-1 bg-background">
                              <span className="text-muted-foreground">{k}</span>
                              <span className="text-foreground font-mono truncate max-w-[60%]" title={String(formatVal(v))}>
                                {formatVal(v)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <ScrollArea className="h-64 rounded border border-border bg-muted/20">
                        <pre className="text-[11px] p-2 font-mono text-foreground whitespace-pre">
{JSON.stringify(st.safe_json, null, 2)}
                        </pre>
                      </ScrollArea>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}

          {finalAnswer && (
            <div className="space-y-1">
              <Label className="text-xs">Final answer shown to users</Label>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap text-foreground">
                {presentNormalGuideAnswer({ question, answer: finalAnswer }) || finalAnswer}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length === 0 ? "[]" : `[${v.length}] ${v.slice(0, 3).map(String).join(", ")}${v.length > 3 ? "…" : ""}`;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
  return String(v);
}

function fmtNum(n: unknown, digits = 3): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

function KnowledgePackPanels({ safeJson }: { safeJson: unknown }) {
  const obj = (safeJson ?? {}) as Record<string, unknown>;
  const kp = (obj.knowledge_pack_trace ?? null) as Record<string, unknown> | null;
  if (!kp) return null;
  const summary = (kp.retrieval_summary as Record<string, unknown>) ?? {};
  const slugs = (kp.diagnosis_slug_resolution as Array<Record<string, unknown>>) ?? [];
  const flow = (kp.candidate_flow as Array<Record<string, unknown>>) ?? [];
  return (
    <div className="space-y-3">
      <div className="rounded border border-border bg-background p-2">
        <div className="text-[11px] font-medium text-foreground mb-1">Retrieval summary</div>
        <div className="grid gap-1 md:grid-cols-3 text-[11px]">
          {Object.entries(summary).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 rounded bg-muted/30 px-2 py-1">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-mono truncate" title={String(formatVal(v))}>{formatVal(v)}</span>
            </div>
          ))}
        </div>
      </div>

      {slugs.length > 0 && (
        <div className="rounded border border-border bg-background p-2">
          <div className="text-[11px] font-medium text-foreground mb-1">Diagnosis slug resolution ({slugs.length})</div>
          <div className="overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="px-1 py-0.5">slug</th>
                  <th className="px-1 py-0.5">visible</th>
                  <th className="px-1 py-0.5">included</th>
                  <th className="px-1 py-0.5">tier</th>
                  <th className="px-1 py-0.5">reason</th>
                </tr>
              </thead>
              <tbody>
                {slugs.map((s, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-1 py-0.5 font-mono">{String(s.slug)}</td>
                    <td className="px-1 py-0.5">{s.resolved_visible ? "yes" : "no"}</td>
                    <td className="px-1 py-0.5">{s.included_in_pack ? "yes" : "no"}</td>
                    <td className="px-1 py-0.5">{String(s.included_tier ?? "—")}</td>
                    <td className="px-1 py-0.5 text-muted-foreground">{String(s.reason ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {flow.length > 0 && (
        <div className="rounded border border-border bg-background p-2">
          <div className="text-[11px] font-medium text-foreground mb-1">Candidate flow ({flow.length})</div>
          <div className="overflow-auto max-h-80">
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground sticky top-0 bg-background">
                <tr className="text-left">
                  <th className="px-1 py-0.5">#</th>
                  <th className="px-1 py-0.5">title</th>
                  <th className="px-1 py-0.5">slug</th>
                  <th className="px-1 py-0.5">tier</th>
                  <th className="px-1 py-0.5">sim</th>
                  <th className="px-1 py-0.5">hybrid</th>
                  <th className="px-1 py-0.5">conf</th>
                  <th className="px-1 py-0.5">reasons</th>
                  <th className="px-1 py-0.5">excluded</th>
                </tr>
              </thead>
              <tbody>
                {flow.map((c, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-1 py-0.5">{String(c.rank ?? i + 1)}</td>
                    <td className="px-1 py-0.5 max-w-[180px] truncate" title={String(c.title ?? "")}>{String(c.title ?? "—")}</td>
                    <td className="px-1 py-0.5 font-mono max-w-[140px] truncate" title={String(c.slug ?? "")}>{String(c.slug ?? "—")}</td>
                    <td className="px-1 py-0.5">{String(c.tier ?? "—")}</td>
                    <td className="px-1 py-0.5 font-mono">{fmtNum(c.similarity)}</td>
                    <td className="px-1 py-0.5 font-mono">{fmtNum(c.hybrid_score)}</td>
                    <td className="px-1 py-0.5">{String(c.source_confidence ?? "—")}</td>
                    <td className="px-1 py-0.5 text-muted-foreground">{Array.isArray(c.matched_reasons) ? (c.matched_reasons as unknown[]).join(",") : "—"}</td>
                    <td className="px-1 py-0.5 text-muted-foreground" title={c.exclusion_detail ? JSON.stringify(c.exclusion_detail) : ""}>
                      {String(c.excluded_reason ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AnswerPlanProvenance({ safeJson }: { safeJson: unknown }) {
  const obj = (safeJson ?? {}) as Record<string, unknown>;
  const prov = (obj.source_provenance as Array<Record<string, unknown>>) ?? [];
  if (prov.length === 0) return null;
  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="text-[11px] font-medium text-foreground mb-1">Answer plan source provenance ({prov.length})</div>
      <div className="overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="px-1 py-0.5">title</th>
              <th className="px-1 py-0.5">slug</th>
              <th className="px-1 py-0.5">provenance</th>
              <th className="px-1 py-0.5">vector</th>
              <th className="px-1 py-0.5">diagnosis</th>
              <th className="px-1 py-0.5">fallback</th>
              <th className="px-1 py-0.5">conf</th>
            </tr>
          </thead>
          <tbody>
            {prov.map((s, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-1 py-0.5 max-w-[200px] truncate" title={String(s.title ?? "")}>{String(s.title ?? "—")}</td>
                <td className="px-1 py-0.5 font-mono max-w-[160px] truncate" title={String(s.slug ?? "")}>{String(s.slug ?? "—")}</td>
                <td className="px-1 py-0.5">{String(s.provenance ?? "—")}</td>
                <td className="px-1 py-0.5">{s.came_from_vector ? "yes" : "no"}</td>
                <td className="px-1 py-0.5">{s.came_from_diagnosis ? "yes" : "no"}</td>
                <td className="px-1 py-0.5">{s.came_from_fallback ? "yes" : "no"}</td>
                <td className="px-1 py-0.5">{String(s.source_confidence ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnswerPlanSafeGuidance({ keyFields }: { keyFields: Record<string, unknown> }) {
  const pts = (keyFields?.safe_guidance_points as string[]) ?? [];
  if (!pts || pts.length === 0) return null;
  return (
    <div className="rounded border border-border bg-background p-2 mt-2">
      <div className="text-[11px] font-medium text-foreground mb-1">
        Safe domain guidance points ({pts.length}) — ARCH.1D
      </div>
      <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-muted-foreground">
        {pts.map((p, i) => (
          <li key={i} className="leading-snug">{p}</li>
        ))}
      </ul>
    </div>
  );
}
