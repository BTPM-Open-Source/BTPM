// AI-GUIDE.V2.1C-SMOKE-UI — Admin-only V2 reindex + retrieval smoke panel.
// Diagnostic only. Does NOT wire V2 into the user-facing BTPM Guide.
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useActiveOrgAdminAccess } from "@/hooks/useActiveOrgAdminAccess";
import { useRealIntegrationGate } from "@/hooks/useRealIntegrationGate";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ShieldAlert, Play, RefreshCcw, Search, Copy, Loader2, CheckCircle2, XCircle } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface IndexStatus {
  total_chunks: number;
  vector_ready_count: number;
  stale_count: number;
  last_indexed_at: string | null;
  failed_jobs_24h: number;
  embedding_model: string;
  embedding_dimensions: number;
}

interface ChunkSummaryRow {
  source_type: string;
  source_status: string;
  total_count: number;
  vector_ready_count: number;
}

interface ReindexResult {
  ok: boolean;
  job_id?: string;
  status?: string;
  stats?: Record<string, number>;
  error?: string;
  version?: string;
}

interface SmokeCandidate {
  article_slug: string | null;
  article_title: string | null;
  source_type: string;
  similarity: number;
  hybrid_score: number;
  route_match: boolean;
  feature_match: boolean;
  workflow_match: boolean;
  source_confidence: string | null;
}

interface SmokeResultRow {
  id: string;
  query: string;
  expected_slugs: string[];
  workflow_id?: string | null;
  feature_area?: string[] | null;
  expected_found: boolean;
  matched_expected_slugs: string[];
  top_expected_rank?: number | null;
  best_expected_similarity?: number | null;
  best_expected_hybrid?: number | null;
  confidence?: "high" | "medium" | "low" | "weak";
  raw_text_returned: boolean;
  candidates: SmokeCandidate[];
  error?: string;
}

interface ExpectedSlugDiagnostic {
  expected_slug: string;
  article_exists_in_kc: boolean;
  article_status: string | null;
  article_type: string | null;
  archived_at: string | null;
  article_indexed: boolean;
  indexed_chunk_count: number;
  indexed_source_types: string[];
}

interface SmokeEnumeration {
  total: number;
  published: number;
  draft: number;
  archived: number;
  integration_placeholder: number;
  eligible_for_index: number;
  indexed_chunks_total: number | null;
  indexed_articles_distinct_vector_ready: number;
  gap_eligible_minus_indexed: number;
}

interface SmokeResult {
  ok: boolean;
  timestamp?: string;
  embedding?: { provider: string; model: string; dimensions: number };
  summary?: { total: number; passed: number; failed: number };
  enumeration?: SmokeEnumeration;
  expected_slug_diagnostics?: ExpectedSlugDiagnostic[];
  results?: SmokeResultRow[];
  error?: string;
}

interface KpPackArticle {
  article_id: string;
  slug: string;
  title: string;
  article_type: string | null;
  source_confidence: "high" | "medium" | "low";
  matched_source_types: string[];
  best_similarity: number;
  best_hybrid_score: number;
  route_match: boolean;
  feature_match: boolean;
  workflow_match: boolean;
}
interface KpResultRow {
  id: string;
  query: string;
  expected_intent: string | null;
  expected_slugs: string[];
  classification: {
    intent_type: string;
    feature_area: string | null;
    workflow_id: string | null;
    is_user_asking_assistant_to_act: boolean;
    is_user_asking_for_actual_data: boolean;
    needs_verified_ui_steps: boolean;
    confidence: number;
  };
  pack_summary: {
    retrieval_strategy: string;
    source_confidence: string;
    knowledge_sufficiency: string;
    primary_count: number;
    supporting_count: number;
    excluded_count: number;
  };
  primary_articles: KpPackArticle[];
  supporting_articles: KpPackArticle[];
  excluded_sources: { source_id: string; reason: string }[];
  matched_expected_slugs: string[];
  pass: boolean;
  timings_ms: Record<string, number>;
  notes: string | null;
}
interface KnowledgePackSmokeResult {
  ok: boolean;
  mode?: string;
  version?: string;
  timestamp?: string;
  summary?: { total: number; passed: number; failed: number };
  results?: KpResultRow[];
  error?: string;
}

interface RoutingSmokeRow {
  id: string;
  query: string;
  expected: {
    intent: string;
    workflow_id: string | null;
    answer_mode: string;
    workflow_status: string | null;
    can_generate_procedural_steps: boolean;
    must_refuse_data_access: boolean;
    must_refuse_action_execution: boolean;
  };
  actual: {
    intent: string;
    workflow_id: string | null;
    answer_mode: string;
    workflow_status: string | null;
    can_generate_procedural_steps: boolean;
    must_refuse_data_access: boolean;
    must_refuse_action_execution: boolean;
    requires_safe_limit: boolean;
    next_required_layer: string;
    route_reason: string;
    knowledge_sufficiency: string;
    source_confidence: string;
  };
  failed_checks: string[];
  status: "pass" | "fail";
  pass: boolean;
}
interface RoutingSmokeResult {
  ok: boolean;
  mode?: string;
  version?: string;
  timestamp?: string;
  summary?: { total: number; passed: number; failed: number };
  results?: RoutingSmokeRow[];
  error?: string;
}

interface PlanSmokeRow {
  id: string;
  query: string;
  expected: {
    answer_mode: string;
    guided_card_type: string;
    allowed_steps_nonempty: boolean | null;
  };
  actual: {
    intent: string;
    answer_mode: string;
    guided_card_type: string | null;
    allowed_steps_count: number;
    must_say_count: number;
    must_not_say_count: number;
    sources_count: number;
    title: string;
    navigation_guidance: string | null;
    safe_limit_reason: string | null;
  };
  plan: unknown;
  failed_checks: string[];
  status: "pass" | "fail";
  pass: boolean;
}
interface PlanSmokeResult {
  ok: boolean;
  mode?: string;
  version?: string;
  timestamp?: string;
  summary?: { total: number; passed: number; failed: number };
  results?: PlanSmokeRow[];
  error?: string;
}

interface RenderSmokeRow {
  id: string;
  query: string;
  expected_answer_mode: string;
  actual_answer_mode: string;
  rendered_answer: string;
  renderer_ok: boolean;
  renderer_error: { code: string; message: string } | null;
  provider: string;
  // Phase 4D.14A.3C.1 — text-model identifier no longer returned by server.
  render_safety: { status: "pass" | "warn" | "fail"; failed_checks: string[]; notes: string[] };
  failed_checks: string[];
  status: "pass" | "warn" | "fail";
  pass: boolean;
  plan_summary: {
    allowed_steps_count: number;
    must_say_count: number;
    must_not_say_count: number;
    sources_count: number;
  };
}
interface RenderSmokeResult {
  ok: boolean;
  mode?: string;
  version?: string;
  timestamp?: string;
  summary?: { total: number; passed: number; warned?: number; failed: number };
  results?: RenderSmokeRow[];
  error?: string;
}

interface ValidationResult {
  ok: boolean;
  severity: "pass" | "warn" | "fail";
  violations: string[];
  unsupported_claims: string[];
  speculative_ui_claims: string[];
  operational_data_claims: string[];
  action_completion_claims: string[];
  internal_leakage_claims: string[];
  source_mismatch_claims: string[];
  final_action: "return" | "regenerate_once" | "fail_closed";
  safe_fallback_answer?: string;
  diagnostics?: Record<string, unknown>;
}

interface ValidateNormalRow {
  id: string;
  query: string;
  expected_answer_mode: string;
  actual_answer_mode: string;
  rendered_answer: string;
  regenerated: boolean;
  regenerated_answer: string | null;
  fail_closed: boolean;
  final_answer: string;
  validation: ValidationResult;
  status: "pass" | "warn" | "fail";
  pass: boolean;
}
interface ValidateAdversarialRow {
  id: string;
  query: string;
  injected_answer: string;
  expected_fail_bucket: string;
  validation: ValidationResult;
  fail_closed: boolean;
  safe_fallback_answer: string | null;
  status: "pass" | "fail";
  pass: boolean;
}
interface ValidateSmokeResult {
  ok: boolean;
  mode?: string;
  version?: string;
  timestamp?: string;
  summary?: {
    normal: { total: number; passed: number; warned: number; failed: number };
    adversarial: { total: number; passed: number; failed: number };
  };
  normal_results?: ValidateNormalRow[];
  adversarial_results?: ValidateAdversarialRow[];
  error?: string;
}


function fmtNum(n: number | undefined | null) {
  if (n == null) return "—";
  return n.toLocaleString();
}

export default function AdminAiGuideV2Smoke() {
  const { isOrgAdmin: adminIsAdmin, organizationId: adminOrgId, isLoading: adminLoading } = useActiveOrgAdminAccess();
  const { isNonProd, blockedMessage, assertAllowed } = useRealIntegrationGate();
  const adminData = adminIsAdmin ? { organizationId: adminOrgId } : null;

  async function guardedInvoke(name: string, opts?: Parameters<typeof supabase.functions.invoke>[1]) {
    await assertAllowed(`ai-guide-v2-smoke:${name}`);
    return supabase.functions.invoke(name, opts as any);
  }

  const [reindexRunning, setReindexRunning] = useState(false);
  const [reindexResult, setReindexResult] = useState<ReindexResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [chunkSummary, setChunkSummary] = useState<ChunkSummaryRow[] | null>(null);
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [smokeResult, setSmokeResult] = useState<SmokeResult | null>(null);
  const [kpRunning, setKpRunning] = useState(false);
  const [kpResult, setKpResult] = useState<KnowledgePackSmokeResult | null>(null);
  const [routeRunning, setRouteRunning] = useState(false);
  const [routeResult, setRouteResult] = useState<RoutingSmokeResult | null>(null);
  const [planRunning, setPlanRunning] = useState(false);
  const [planResult, setPlanResult] = useState<PlanSmokeResult | null>(null);
  const [renderRunning, setRenderRunning] = useState(false);
  const [renderResult, setRenderResult] = useState<RenderSmokeResult | null>(null);
  const [validateRunning, setValidateRunning] = useState(false);
  const [validateResult, setValidateResult] = useState<ValidateSmokeResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);


  function pushError(msg: string) {
    setErrors((prev) => [...prev, `${new Date().toISOString()} — ${msg}`]);
  }

  async function runReindex() {
    setReindexRunning(true);
    setReindexResult(null);
    try {
      const { data, error } = await guardedInvoke("ai-guide-v2-reindex", {
        body: { scope: "full", force: false },
      });
      if (error) {
        const fallback = (data as { error?: string } | null)?.error;
        const msg = fallback || error.message;
        setReindexResult({ ok: false, error: msg });
        pushError(`reindex: ${msg}`);
      } else {
        setReindexResult(data as ReindexResult);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      setReindexResult({ ok: false, error: msg });
      pushError(`reindex: ${msg}`);
    } finally {
      setReindexRunning(false);
    }
    void refreshStatus();
  }

  async function refreshStatus() {
    if (!adminData?.organizationId) return;
    setStatusLoading(true);
    try {
      const [statusRes, summaryRes] = await Promise.all([
        supabase.rpc("ai_guide_v2_list_index_status", { p_organization_id: adminData.organizationId }),
        supabase.rpc("ai_guide_v2_admin_get_chunk_summary", { p_organization_id: adminData.organizationId }),
      ]);
      if (statusRes.error) pushError(`status: ${statusRes.error.message}`);
      else setIndexStatus((statusRes.data?.[0] ?? null) as IndexStatus | null);
      if (summaryRes.error) pushError(`summary: ${summaryRes.error.message}`);
      else setChunkSummary((summaryRes.data ?? []) as ChunkSummaryRow[]);
    } finally {
      setStatusLoading(false);
    }
  }

  async function runSmoke() {
    setSmokeRunning(true);
    setSmokeResult(null);
    try {
      const { data, error } = await guardedInvoke("ai-guide-v2-smoke", { body: {} });
      if (error) {
        const fallback = (data as { error?: string } | null)?.error;
        const msg = fallback || error.message;
        setSmokeResult({ ok: false, error: msg });
        pushError(`smoke: ${msg}`);
      } else {
        setSmokeResult(data as SmokeResult);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      setSmokeResult({ ok: false, error: msg });
      pushError(`smoke: ${msg}`);
    } finally {
      setSmokeRunning(false);
    }
  }

  async function runKnowledgePackSmoke() {
    setKpRunning(true);
    setKpResult(null);
    try {
      const { data, error } = await guardedInvoke("ai-guide-v2-smoke", {
        body: { mode: "knowledge_pack" },
      });
      if (error) {
        const fallback = (data as { error?: string } | null)?.error;
        const msg = fallback || error.message;
        setKpResult({ ok: false, error: msg });
        pushError(`kp_smoke: ${msg}`);
      } else {
        setKpResult(data as KnowledgePackSmokeResult);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      setKpResult({ ok: false, error: msg });
      pushError(`kp_smoke: ${msg}`);
    } finally {
      setKpRunning(false);
    }
  }

  async function runRoutingSmoke() {
    setRouteRunning(true);
    setRouteResult(null);
    try {
      const { data, error } = await guardedInvoke("ai-guide-v2-smoke", {
        body: { mode: "routing" },
      });
      if (error) {
        const fallback = (data as { error?: string } | null)?.error;
        const msg = fallback || error.message;
        setRouteResult({ ok: false, error: msg });
        pushError(`routing_smoke: ${msg}`);
      } else {
        setRouteResult(data as RoutingSmokeResult);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      setRouteResult({ ok: false, error: msg });
      pushError(`routing_smoke: ${msg}`);
    } finally {
      setRouteRunning(false);
    }
  }

  async function runPlanSmoke() {
    setPlanRunning(true);
    setPlanResult(null);
    try {
      const { data, error } = await guardedInvoke("ai-guide-v2-smoke", {
        body: { mode: "plan" },
      });
      if (error) {
        const fallback = (data as { error?: string } | null)?.error;
        const msg = fallback || error.message;
        setPlanResult({ ok: false, error: msg });
        pushError(`plan_smoke: ${msg}`);
      } else {
        setPlanResult(data as PlanSmokeResult);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      setPlanResult({ ok: false, error: msg });
      pushError(`plan_smoke: ${msg}`);
    } finally {
      setPlanRunning(false);
    }
  }

  async function runRenderSmoke() {
    setRenderRunning(true);
    setRenderResult(null);
    try {
      const { data, error } = await guardedInvoke("ai-guide-v2-smoke", {
        body: { mode: "render" },
      });
      if (error) {
        const fallback = (data as { error?: string } | null)?.error;
        const msg = fallback || error.message;
        setRenderResult({ ok: false, error: msg });
        pushError(`render_smoke: ${msg}`);
      } else {
        setRenderResult(data as RenderSmokeResult);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      setRenderResult({ ok: false, error: msg });
      pushError(`render_smoke: ${msg}`);
    } finally {
      setRenderRunning(false);
    }
  }

  async function runValidateSmoke() {
    setValidateRunning(true);
    setValidateResult(null);
    try {
      const { data, error } = await guardedInvoke("ai-guide-v2-smoke", {
        body: { mode: "validate" },
      });
      if (error) {
        const fallback = (data as { error?: string } | null)?.error;
        const msg = fallback || error.message;
        setValidateResult({ ok: false, error: msg });
        pushError(`validate_smoke: ${msg}`);
      } else {
        setValidateResult(data as ValidateSmokeResult);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      setValidateResult({ ok: false, error: msg });
      pushError(`validate_smoke: ${msg}`);
    } finally {
      setValidateRunning(false);
    }
  }

  function buildReport() {
    return {
      timestamp: new Date().toISOString(),
      version: "AI-GUIDE.V2.6-SMOKE-UI",
      organization_id: adminData?.organizationId ?? null,
      reindex_job: reindexResult,
      index_status: indexStatus,
      chunk_summary: chunkSummary,
      retrieval_smoke: smokeResult,
      knowledge_pack_smoke: kpResult,
      routing_smoke: routeResult,
      answer_plan_smoke: planResult,
      renderer_smoke: renderResult,
      validator_smoke: validateResult,
    };
  }


  async function copyReport() {
    const text = JSON.stringify(buildReport(), null, 2);
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      toast.success("JSON report copied to clipboard");
    } else {
      // Last-resort fallback: open report in a new window so the user can copy manually
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(
          `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;padding:16px">${text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</pre>`,
        );
        w.document.title = "AI Guide V2 Smoke Report";
        toast.message("Clipboard blocked — opened report in a new tab to copy manually");
      } else {
        toast.error("Could not copy. Please allow clipboard or popups for this site.");
      }
    }
  }


  if (adminLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!adminData) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex flex-col items-center py-16 space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold text-foreground">Access Denied</h1>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Only organization admins can access the AI Guide V2 smoke test panel.
          </p>
          <Button variant="outline" asChild>
            <Link to="/"><ArrowLeft className="h-4 w-4 mr-1" /> Back to Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Guide V2 — Smoke Test</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Admin-only diagnostic. This tool does not enable AI Guide V2 for users and does not
            change the current BTPM Guide runtime. It exercises the V2 reindex processor and the
            pgvector retrieval RPC. No raw chunk text, embeddings, or provider secrets are returned.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/admin"><ArrowLeft className="h-4 w-4 mr-1" /> Admin</Link>
        </Button>
      </div>

      {isNonProd && (
        <div className="flex items-start gap-2 p-3 rounded-md border bg-amber-50 border-amber-200 text-amber-900 text-sm">
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
          <span>{blockedMessage}</span>
        </div>
      )}

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-lg font-semibold">Actions</h2>
          <div className="flex flex-wrap gap-2">
            <Button onClick={runReindex} disabled={reindexRunning} size="sm">
              {reindexRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
              Run full reindex
            </Button>
            <Button onClick={refreshStatus} disabled={statusLoading} variant="outline" size="sm">
              {statusLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-1" />}
              Refresh index status
            </Button>
            <Button onClick={runSmoke} disabled={smokeRunning} variant="outline" size="sm">
              {smokeRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
              Run retrieval smoke
            </Button>
            <Button onClick={runKnowledgePackSmoke} disabled={kpRunning} variant="outline" size="sm">
              {kpRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
              Run Knowledge Pack smoke
            </Button>
            <Button onClick={runRoutingSmoke} disabled={routeRunning} variant="outline" size="sm">
              {routeRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
              Run routing smoke
            </Button>
            <Button onClick={runPlanSmoke} disabled={planRunning} variant="outline" size="sm">
              {planRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
              Run answer plan smoke
            </Button>
            <Button onClick={runRenderSmoke} disabled={renderRunning} variant="outline" size="sm">
              {renderRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
              Run renderer smoke
            </Button>
            <Button onClick={runValidateSmoke} disabled={validateRunning} variant="outline" size="sm">
              {validateRunning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
              Run validator smoke
            </Button>
            <Button onClick={copyReport} variant="secondary" size="sm">
              <Copy className="h-4 w-4 mr-1" /> Copy JSON report
            </Button>

          </div>
        </div>
      </Card>

      {reindexResult && (
        <Card className="p-4 space-y-2">
          <h2 className="text-lg font-semibold">Reindex result</h2>
          {reindexResult.ok ? (
            <div className="text-sm space-y-1">
              <div><span className="text-muted-foreground">Job:</span> {reindexResult.job_id} — <Badge variant="secondary">{reindexResult.status}</Badge></div>
              {reindexResult.stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                  {Object.entries(reindexResult.stats).map(([k, v]) => (
                    <div key={k} className="text-xs border rounded p-2">
                      <div className="text-muted-foreground">{k}</div>
                      <div className="font-mono">{String(v)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-destructive">Error: {reindexResult.error ?? "unknown"}</div>
          )}
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Index status</h2>
        {!indexStatus ? (
          <p className="text-sm text-muted-foreground">No status loaded. Click "Refresh index status".</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="text-xs border rounded p-2"><div className="text-muted-foreground">total_chunks</div><div className="font-mono">{fmtNum(indexStatus.total_chunks)}</div></div>
            <div className="text-xs border rounded p-2"><div className="text-muted-foreground">vector_ready_count</div><div className="font-mono">{fmtNum(indexStatus.vector_ready_count)}</div></div>
            <div className="text-xs border rounded p-2"><div className="text-muted-foreground">stale_count</div><div className="font-mono">{fmtNum(indexStatus.stale_count)}</div></div>
            <div className="text-xs border rounded p-2"><div className="text-muted-foreground">failed_jobs_24h</div><div className="font-mono">{fmtNum(indexStatus.failed_jobs_24h)}</div></div>
            <div className="text-xs border rounded p-2 col-span-2"><div className="text-muted-foreground">last_indexed_at</div><div className="font-mono">{indexStatus.last_indexed_at ?? "—"}</div></div>
            <div className="text-xs border rounded p-2"><div className="text-muted-foreground">embedding_model</div><div className="font-mono">{indexStatus.embedding_model}</div></div>
            <div className="text-xs border rounded p-2"><div className="text-muted-foreground">embedding_dimensions</div><div className="font-mono">{indexStatus.embedding_dimensions}</div></div>
          </div>
        )}
        {chunkSummary && chunkSummary.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mt-3 mb-1">Chunks by source_type / source_status</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>source_type</TableHead>
                  <TableHead>source_status</TableHead>
                  <TableHead className="text-right">total</TableHead>
                  <TableHead className="text-right">vector_ready</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chunkSummary.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.source_type}</TableCell>
                    <TableCell className="font-mono text-xs">{r.source_status}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmtNum(r.total_count)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmtNum(r.vector_ready_count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {smokeResult?.enumeration && (
        <Card className="p-4 space-y-2">
          <h2 className="text-lg font-semibold">Article enumeration</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(smokeResult.enumeration).map(([k, v]) => (
              <div key={k} className="text-xs border rounded p-2">
                <div className="text-muted-foreground">{k}</div>
                <div className="font-mono">{v == null ? "—" : String(v)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {smokeResult?.expected_slug_diagnostics && smokeResult.expected_slug_diagnostics.length > 0 && (
        <Card className="p-4 space-y-2">
          <h2 className="text-lg font-semibold">Expected slug index presence</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>slug</TableHead>
                <TableHead>in KC</TableHead>
                <TableHead>status</TableHead>
                <TableHead>type</TableHead>
                <TableHead>indexed</TableHead>
                <TableHead className="text-right">chunks</TableHead>
                <TableHead>sources</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {smokeResult.expected_slug_diagnostics.map((d) => (
                <TableRow key={d.expected_slug}>
                  <TableCell className="font-mono text-xs">{d.expected_slug}</TableCell>
                  <TableCell className="text-xs">{d.article_exists_in_kc ? "yes" : <span className="text-destructive">no</span>}</TableCell>
                  <TableCell className="text-xs">{d.article_status ?? "—"}</TableCell>
                  <TableCell className="text-xs">{d.article_type ?? "—"}</TableCell>
                  <TableCell className="text-xs">{d.article_indexed ? "yes" : <span className="text-destructive">no</span>}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{d.indexed_chunk_count}</TableCell>
                  <TableCell className="text-xs font-mono">{d.indexed_source_types.join(", ") || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {smokeResult && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Retrieval smoke results</h2>
            {smokeResult.summary && (
              <div className="text-sm">
                <Badge variant={smokeResult.summary.failed === 0 ? "default" : "destructive"}>
                  {smokeResult.summary.passed}/{smokeResult.summary.total} passed
                </Badge>
              </div>
            )}
          </div>
          {!smokeResult.ok && (
            <div className="text-sm text-destructive">Error: {smokeResult.error}</div>
          )}
          {smokeResult.results?.map((r) => (
            <div key={r.id} className="border rounded p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium">{r.query}</div>
                <div className="flex items-center gap-2">
                  {r.expected_found
                    ? <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> pass</Badge>
                    : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> fail</Badge>}
                  {r.raw_text_returned && <Badge variant="destructive">raw text leaked</Badge>}
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Expected: {r.expected_slugs.join(", ") || "—"} · Matched: {r.matched_expected_slugs.join(", ") || "—"}</div>
                <div>
                  top_expected_rank: <span className="font-mono">{r.top_expected_rank ?? "—"}</span>
                  {" · "}best_sim: <span className="font-mono">{r.best_expected_similarity?.toFixed(3) ?? "—"}</span>
                  {" · "}best_hybrid: <span className="font-mono">{r.best_expected_hybrid?.toFixed(3) ?? "—"}</span>
                  {" · "}confidence: <Badge variant="outline" className="ml-1">{r.confidence ?? "—"}</Badge>
                  {r.workflow_id && <> · wf: <span className="font-mono">{r.workflow_id}</span></>}
                  {r.feature_area?.length ? <> · feat: <span className="font-mono">{r.feature_area.join(",")}</span></> : null}
                </div>
                {r.error && <div className="text-destructive">{r.error}</div>}
              </div>
              {r.candidates.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>slug</TableHead>
                      <TableHead>title</TableHead>
                      <TableHead>type</TableHead>
                      <TableHead className="text-right">sim</TableHead>
                      <TableHead className="text-right">hybrid</TableHead>
                      <TableHead>matches</TableHead>
                      <TableHead>conf</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.candidates.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{c.article_slug ?? "—"}</TableCell>
                        <TableCell className="text-xs">{c.article_title ?? "—"}</TableCell>
                        <TableCell className="text-xs">{c.source_type}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{c.similarity.toFixed(3)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{c.hybrid_score.toFixed(3)}</TableCell>
                        <TableCell className="text-xs">
                          {[c.route_match && "route", c.feature_match && "feat", c.workflow_match && "wf"]
                            .filter(Boolean).join(", ") || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{c.source_confidence ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ))}
        </Card>
      )}

      {kpResult && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Knowledge Pack smoke (V2.2)</h2>
            {kpResult.summary && (
              <Badge variant={kpResult.summary.failed === 0 ? "default" : "destructive"}>
                {kpResult.summary.passed}/{kpResult.summary.total} passed
              </Badge>
            )}
          </div>
          {!kpResult.ok && <div className="text-sm text-destructive">Error: {kpResult.error}</div>}
          {kpResult.results?.map((r) => (
            <div key={r.id} className="border rounded p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium">{r.query}</div>
                <Badge variant={r.pass ? "default" : "destructive"} className="gap-1">
                  {r.pass ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {r.pass ? "pass" : "fail"}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>
                  intent: <span className="font-mono">{r.classification.intent_type}</span>
                  {" · "}wf: <span className="font-mono">{r.classification.workflow_id ?? "—"}</span>
                  {" · "}feat: <span className="font-mono">{r.classification.feature_area ?? "—"}</span>
                  {" · "}expected_intent: <span className="font-mono">{r.expected_intent ?? "—"}</span>
                </div>
                <div>
                  strategy: <span className="font-mono">{r.pack_summary.retrieval_strategy}</span>
                  {" · "}confidence: <Badge variant="outline" className="ml-1">{r.pack_summary.source_confidence}</Badge>
                  {" · "}sufficiency: <Badge variant="outline" className="ml-1">{r.pack_summary.knowledge_sufficiency}</Badge>
                  {" · "}primary: {r.pack_summary.primary_count}
                  {" · "}supporting: {r.pack_summary.supporting_count}
                  {" · "}excluded: {r.pack_summary.excluded_count}
                </div>
                <div>
                  Expected slugs: {r.expected_slugs.join(", ") || "—"} · Matched: {r.matched_expected_slugs.join(", ") || "—"}
                </div>
                {r.notes && <div className="italic">{r.notes}</div>}
              </div>
              {(r.primary_articles.length > 0 || r.supporting_articles.length > 0) && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>tier</TableHead>
                      <TableHead>slug</TableHead>
                      <TableHead>title</TableHead>
                      <TableHead>conf</TableHead>
                      <TableHead className="text-right">sim</TableHead>
                      <TableHead className="text-right">hybrid</TableHead>
                      <TableHead>matches</TableHead>
                      <TableHead>sources</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.primary_articles.map((a) => (
                      <TableRow key={`p-${a.article_id}`}>
                        <TableCell className="text-xs"><Badge>primary</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{a.slug}</TableCell>
                        <TableCell className="text-xs">{a.title}</TableCell>
                        <TableCell className="text-xs">{a.source_confidence}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.best_similarity.toFixed(3)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.best_hybrid_score.toFixed(3)}</TableCell>
                        <TableCell className="text-xs">{[a.route_match && "route", a.feature_match && "feat", a.workflow_match && "wf"].filter(Boolean).join(", ") || "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{a.matched_source_types.join(", ")}</TableCell>
                      </TableRow>
                    ))}
                    {r.supporting_articles.map((a) => (
                      <TableRow key={`s-${a.article_id}`}>
                        <TableCell className="text-xs"><Badge variant="outline">support</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{a.slug}</TableCell>
                        <TableCell className="text-xs">{a.title}</TableCell>
                        <TableCell className="text-xs">{a.source_confidence}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.best_similarity.toFixed(3)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.best_hybrid_score.toFixed(3)}</TableCell>
                        <TableCell className="text-xs">{[a.route_match && "route", a.feature_match && "feat", a.workflow_match && "wf"].filter(Boolean).join(", ") || "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{a.matched_source_types.join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ))}
        </Card>
      )}

      {routeResult && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Routing smoke (V2.3)</h2>
            {routeResult.summary && (
              <Badge variant={routeResult.summary.failed === 0 ? "default" : "destructive"}>
                {routeResult.summary.passed}/{routeResult.summary.total} passed
              </Badge>
            )}
          </div>
          {!routeResult.ok && <div className="text-sm text-destructive">Error: {routeResult.error}</div>}
          {routeResult.results?.map((r) => (
            <div key={r.id} className="border rounded p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium">{r.query}</div>
                <Badge variant={r.pass ? "default" : "destructive"} className="gap-1">
                  {r.pass ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {r.pass ? "pass" : "fail"}
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <div className="border rounded p-2">
                  <div className="text-muted-foreground mb-1">expected</div>
                  <div>intent: <span className="font-mono">{r.expected.intent}</span></div>
                  <div>workflow_id: <span className="font-mono">{r.expected.workflow_id ?? "—"}</span></div>
                  <div>answer_mode: <span className="font-mono">{r.expected.answer_mode}</span></div>
                  <div>workflow_status: <span className="font-mono">{r.expected.workflow_status ?? "—"}</span></div>
                  <div>can_generate_steps: <span className="font-mono">{String(r.expected.can_generate_procedural_steps)}</span></div>
                </div>
                <div className="border rounded p-2">
                  <div className="text-muted-foreground mb-1">actual</div>
                  <div>intent: <span className="font-mono">{r.actual.intent}</span></div>
                  <div>workflow_id: <span className="font-mono">{r.actual.workflow_id ?? "—"}</span></div>
                  <div>answer_mode: <span className="font-mono">{r.actual.answer_mode}</span></div>
                  <div>workflow_status: <span className="font-mono">{r.actual.workflow_status ?? "—"}</span></div>
                  <div>can_generate_steps: <span className="font-mono">{String(r.actual.can_generate_procedural_steps)}</span></div>
                  <div>refuse_data: <span className="font-mono">{String(r.actual.must_refuse_data_access)}</span> · refuse_action: <span className="font-mono">{String(r.actual.must_refuse_action_execution)}</span></div>
                  <div>next_layer: <span className="font-mono">{r.actual.next_required_layer}</span></div>
                  <div className="italic text-muted-foreground mt-1">{r.actual.route_reason}</div>
                </div>
              </div>
              {r.failed_checks.length > 0 && (
                <div className="text-xs text-destructive">Failed checks: {r.failed_checks.join(", ")}</div>
              )}
            </div>
          ))}
        </Card>
      )}

      {planResult && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Answer plan smoke (V2.4)</h2>
            {planResult.summary && (
              <Badge variant={planResult.summary.failed === 0 ? "default" : "destructive"}>
                {planResult.summary.passed}/{planResult.summary.total} passed
              </Badge>
            )}
          </div>
          {!planResult.ok && <div className="text-sm text-destructive">Error: {planResult.error}</div>}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>id</TableHead>
                <TableHead>query</TableHead>
                <TableHead>expected_mode</TableHead>
                <TableHead>actual_mode</TableHead>
                <TableHead>card</TableHead>
                <TableHead className="text-right">steps</TableHead>
                <TableHead className="text-right">must_say</TableHead>
                <TableHead className="text-right">must_not_say</TableHead>
                <TableHead>status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {planResult.results?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.id}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate">{r.query}</TableCell>
                  <TableCell className="font-mono text-xs">{r.expected.answer_mode}</TableCell>
                  <TableCell className="font-mono text-xs">{r.actual.answer_mode}</TableCell>
                  <TableCell className="font-mono text-xs">{r.actual.guided_card_type ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.actual.allowed_steps_count}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.actual.must_say_count}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.actual.must_not_say_count}</TableCell>
                  <TableCell>
                    <Badge variant={r.pass ? "default" : "destructive"} className="gap-1">
                      {r.pass ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {r.pass ? "pass" : "fail"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {planResult.results?.some((r) => r.failed_checks.length > 0) && (
            <div className="text-xs text-destructive space-y-1">
              {planResult.results.filter((r) => r.failed_checks.length > 0).map((r) => (
                <div key={r.id}>{r.id}: {r.failed_checks.join(", ")}</div>
              ))}
            </div>
          )}
        </Card>
      )}

      {renderResult && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Renderer smoke (V2.5)</h2>
            {renderResult.summary && (
              <Badge variant={renderResult.summary.failed === 0 ? "default" : "destructive"}>
                {renderResult.summary.passed}/{renderResult.summary.total} passed
                {renderResult.summary.warned ? ` · ${renderResult.summary.warned} warn` : ""}
              </Badge>
            )}
          </div>
          {!renderResult.ok && <div className="text-sm text-destructive">Error: {renderResult.error}</div>}
          {renderResult.results?.map((r) => (
            <div key={r.id} className="border rounded p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium">{r.query}</div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">{r.actual_answer_mode}</Badge>
                  <Badge
                    variant={r.status === "pass" ? "default" : r.status === "warn" ? "secondary" : "destructive"}
                    className="gap-1"
                  >
                    {r.status === "pass"
                      ? <CheckCircle2 className="h-3 w-3" />
                      : <XCircle className="h-3 w-3" />}
                    {r.status}
                  </Badge>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                provider: <span className="font-mono">{r.provider}</span>
                {" · "}safety: <span className="font-mono">{r.render_safety.status}</span>
                {" · "}steps: {r.plan_summary.allowed_steps_count}
                {" · "}sources: {r.plan_summary.sources_count}
              </div>
              {r.renderer_error && (
                <div className="text-xs text-destructive">renderer_error: {r.renderer_error.code} — {r.renderer_error.message}</div>
              )}
              <pre className="text-xs whitespace-pre-wrap bg-muted rounded p-2 max-h-72 overflow-auto">{r.rendered_answer || "—"}</pre>
              {r.failed_checks.length > 0 && (
                <div className="text-xs text-destructive">Failed checks: {r.failed_checks.join(", ")}</div>
              )}
              {r.render_safety.failed_checks.length > 0 && (
                <div className="text-xs text-destructive">Safety fails: {r.render_safety.failed_checks.join(", ")}</div>
              )}
            </div>
          ))}
        </Card>
      )}

      {validateResult && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Validator smoke (V2.6)</h2>
            {validateResult.summary && (
              <div className="flex gap-2">
                <Badge variant={validateResult.summary.normal.failed === 0 ? "default" : "destructive"}>
                  normal {validateResult.summary.normal.passed}/{validateResult.summary.normal.total}
                  {validateResult.summary.normal.warned ? ` · ${validateResult.summary.normal.warned} warn` : ""}
                </Badge>
                <Badge variant={validateResult.summary.adversarial.failed === 0 ? "default" : "destructive"}>
                  adversarial {validateResult.summary.adversarial.passed}/{validateResult.summary.adversarial.total}
                </Badge>
              </div>
            )}
          </div>
          {!validateResult.ok && <div className="text-sm text-destructive">Error: {validateResult.error}</div>}
          {validateResult.normal_results && validateResult.normal_results.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Normal cases</h3>
              {validateResult.normal_results.map((r) => (
                <div key={r.id} className="border rounded p-3 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-medium">{r.query}</div>
                    <div className="flex gap-1">
                      <Badge variant="outline" className="font-mono">{r.actual_answer_mode}</Badge>
                      <Badge variant="outline" className="font-mono">final:{r.validation.final_action}</Badge>
                      {r.regenerated && <Badge variant="secondary">regen</Badge>}
                      {r.fail_closed && <Badge variant="destructive">fail_closed</Badge>}
                      <Badge variant={r.status === "pass" ? "default" : r.status === "warn" ? "secondary" : "destructive"}>
                        {r.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-muted-foreground">severity: <span className="font-mono">{r.validation.severity}</span></div>
                  <pre className="whitespace-pre-wrap bg-muted rounded p-2 max-h-40 overflow-auto">{r.final_answer || "—"}</pre>
                  {r.validation.severity !== "pass" && (
                    <div className="text-destructive">
                      {[
                        ...r.validation.violations,
                        ...r.validation.unsupported_claims.map((c) => `unsupported:${c}`),
                        ...r.validation.operational_data_claims.map((c) => `live_data:${c}`),
                        ...r.validation.action_completion_claims.map((c) => `action:${c}`),
                        ...r.validation.internal_leakage_claims.map((c) => `leak:${c}`),
                        ...r.validation.speculative_ui_claims.map((c) => `spec:${c}`),
                      ].join(" · ") || "—"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {validateResult.adversarial_results && validateResult.adversarial_results.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Adversarial injected-answer cases</h3>
              {validateResult.adversarial_results.map((r) => (
                <div key={r.id} className="border rounded p-3 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-medium">{r.query}</div>
                    <div className="flex gap-1">
                      <Badge variant="outline" className="font-mono">{r.expected_fail_bucket}</Badge>
                      <Badge variant="outline" className="font-mono">final:{r.validation.final_action}</Badge>
                      <Badge variant={r.pass ? "default" : "destructive"}>{r.status}</Badge>
                    </div>
                  </div>
                  <div className="text-muted-foreground">injected:</div>
                  <pre className="whitespace-pre-wrap bg-muted rounded p-2 max-h-24 overflow-auto">{r.injected_answer}</pre>
                  {r.safe_fallback_answer && (
                    <>
                      <div className="text-muted-foreground">safe fallback:</div>
                      <pre className="whitespace-pre-wrap bg-muted rounded p-2 max-h-20 overflow-auto">{r.safe_fallback_answer}</pre>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}


      <Card className="p-4">
        <details>
          <summary className="text-sm font-semibold cursor-pointer">Raw JSON report</summary>
          <pre className="text-xs mt-2 p-2 bg-muted rounded overflow-auto max-h-96">{JSON.stringify(buildReport(), null, 2)}</pre>
        </details>
      </Card>

      {errors.length > 0 && (
        <Card className="p-4 border-destructive/40">
          <h2 className="text-sm font-semibold text-destructive mb-1">Errors</h2>
          <ul className="text-xs font-mono space-y-1">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
