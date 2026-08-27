// AI-GUIDE.V2-ARCH.1A — Domain Diagnosis Smoke (admin-only).
// Runs the diagnose_only mode against 7 canonical cases and shows
// expected vs actual. Does NOT generate answers or persist anything.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Play, Copy, Brain } from "lucide-react";
import { toast } from "sonner";

interface DiagCase {
  id: string;
  question: string;
  expected_situation: string;
  expected_strategy: string;
  expected_strategy_alternatives?: string[];
  must_include_canonical?: string[];
  forbid_strategy?: string[];
  must_include_workflow_candidates?: string[];
  must_include_any_kc_slug?: string[];
  require_nonempty_kc_slugs?: boolean;
  must_be_safety?: {
    asks_assistant_to_act?: boolean;
    needs_live_data?: boolean;
  };
}

const CASES: DiagCase[] = [
  {
    id: "d1",
    question: "Something external doesn't allow me to proceed with the task, what shall I do?",
    expected_situation: "blocked_work",
    expected_strategy: "troubleshooting_guidance",
    must_include_canonical: ["task", "blocker"],
    require_nonempty_kc_slugs: true,
    must_include_any_kc_slug: [
      "risk-vs-blocker-rulebook",
      "how-to-manage-risks-and-blockers",
      "using-risks-and-blockers-page",
    ],
  },
  {
    id: "d2",
    question: "What shall I do if I want one task to be strictly executed only after another task?",
    expected_situation: "dependency_sequencing",
    expected_strategy: "unverified_safe_guidance",
    expected_strategy_alternatives: ["verified_workflow_guidance", "concept_explanation"],
    must_include_canonical: ["dependency", "task"],
    must_include_workflow_candidates: ["add_dependency"],
    require_nonempty_kc_slugs: true,
    must_include_any_kc_slug: ["how-to-add-a-dependency", "dependencies-rulebook"],
  },
  {
    id: "d3",
    question: "A vendor delay might affect my go-live next month, how should I track it?",
    expected_situation: "future_risk",
    expected_strategy: "troubleshooting_guidance",
    expected_strategy_alternatives: ["concept_explanation"],
    forbid_strategy: ["verified_workflow_guidance"],
    must_include_canonical: ["risk"],
    require_nonempty_kc_slugs: true,
    must_include_any_kc_slug: [
      "risk-vs-blocker-rulebook",
      "how-to-manage-risks-and-blockers",
    ],
  },
  {
    id: "d4",
    question: "Create a blocker for this task.",
    expected_situation: "action_execution_request",
    expected_strategy: "action_refusal",
    must_be_safety: { asks_assistant_to_act: true },
  },
  {
    id: "d5",
    question: "What blockers are currently open on my project?",
    expected_situation: "live_data_request",
    expected_strategy: "data_refusal",
    must_be_safety: { needs_live_data: true },
  },
  {
    id: "d6",
    question: "Does editing a PowerPoint in SharePoint update BTPM?",
    expected_situation: "sharepoint_boundary",
    expected_strategy: "concept_explanation",
    require_nonempty_kc_slugs: true,
    must_include_any_kc_slug: [
      "sharepoint-output-behavior",
      "where-project-documents-are-stored",
      "generated-documents-in-btpm",
    ],
  },
  {
    id: "d7",
    question: "What should I see in Paris?",
    expected_situation: "out_of_scope",
    expected_strategy: "out_of_scope_refusal",
  },
];

interface DiagRow {
  case: DiagCase;
  status: "pending" | "running" | "done" | "error";
  actual?: {
    domain_situation?: string;
    answer_strategy?: string;
    canonical_objects?: string[];
    possible_objects?: string[];
    not_objects?: string[];
    recommended_kc_slugs?: string[];
    workflow_candidates?: string[];
    confidence?: number;
    asks_assistant_to_act?: boolean;
    needs_live_data?: boolean;
    diagnosis_source?: string;
  };
  verdict?: "pass" | "warn" | "fail";
  reasons?: string[];
  error?: string;
}

function evaluate(c: DiagCase, actual: NonNullable<DiagRow["actual"]>): { verdict: "pass" | "warn" | "fail"; reasons: string[] } {
  const reasons: string[] = [];
  let fail = false;
  let warn = false;
  if (actual.domain_situation !== c.expected_situation) {
    const eq = c.expected_situation === "sharepoint_boundary"
      && actual.domain_situation === "generated_document_boundary";
    if (!eq) { fail = true; reasons.push(`situation expected=${c.expected_situation} got=${actual.domain_situation}`); }
  }
  const allowedStrategies = new Set([c.expected_strategy, ...(c.expected_strategy_alternatives ?? [])]);
  if (!allowedStrategies.has(actual.answer_strategy ?? "")) {
    fail = true; reasons.push(`strategy expected in [${[...allowedStrategies].join("|")}] got=${actual.answer_strategy}`);
  }
  if (c.forbid_strategy?.includes(actual.answer_strategy ?? "")) {
    fail = true; reasons.push(`strategy forbidden=${actual.answer_strategy}`);
  }
  const canonical = new Set(actual.canonical_objects ?? []);
  for (const obj of c.must_include_canonical ?? []) {
    if (!canonical.has(obj)) { fail = true; reasons.push(`canonical missing: ${obj}`); }
  }
  const wfc = new Set(actual.workflow_candidates ?? []);
  for (const w of c.must_include_workflow_candidates ?? []) {
    if (!wfc.has(w)) { warn = true; reasons.push(`workflow_candidate missing: ${w}`); }
  }
  if (c.require_nonempty_kc_slugs && (actual.recommended_kc_slugs ?? []).length === 0) {
    fail = true; reasons.push("recommended_kc_slugs is empty");
  }
  if (c.must_include_any_kc_slug && c.must_include_any_kc_slug.length > 0) {
    const have = new Set(actual.recommended_kc_slugs ?? []);
    const hit = c.must_include_any_kc_slug.some((s) => have.has(s));
    if (!hit) { warn = true; reasons.push(`no expected kc slug present (any of: ${c.must_include_any_kc_slug.join(", ")})`); }
  }
  if (c.must_be_safety) {
    if (c.must_be_safety.asks_assistant_to_act && !actual.asks_assistant_to_act) {
      fail = true; reasons.push("asks_assistant_to_act should be true");
    }
    if (c.must_be_safety.needs_live_data && !actual.needs_live_data) {
      fail = true; reasons.push("needs_live_data should be true");
    }
  }
  if (fail) return { verdict: "fail", reasons };
  if (warn) return { verdict: "warn", reasons };
  return { verdict: "pass", reasons };
}

export default function AdminAiGuideDomainDiagnosisSmoke() {
  const [rows, setRows] = useState<DiagRow[]>(CASES.map((c) => ({ case: c, status: "pending" })));
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const next: DiagRow[] = CASES.map((c) => ({ case: c, status: "running" }));
    setRows(next);
    for (let i = 0; i < CASES.length; i++) {
      const c = CASES[i];
      try {
        const { data, error } = await supabase.functions.invoke("ai-guide-v2-chat", {
          body: { question: c.question, mode: "diagnose_only", debug: false },
        });
        if (error) throw error;
        const dx = (data as { domain_diagnosis?: Record<string, unknown> })?.domain_diagnosis ?? {};
        const actual: NonNullable<DiagRow["actual"]> = {
          domain_situation: dx.domain_situation as string,
          answer_strategy: dx.answer_strategy as string,
          canonical_objects: (dx.canonical_objects as string[]) ?? [],
          possible_objects: (dx.possible_objects as string[]) ?? [],
          not_objects: (dx.not_objects as string[]) ?? [],
          recommended_kc_slugs: (dx.recommended_kc_slugs as string[]) ?? [],
          workflow_candidates: (dx.workflow_candidates as string[]) ?? [],
          confidence: dx.confidence as number,
          asks_assistant_to_act: dx.asks_assistant_to_act as boolean,
          needs_live_data: dx.needs_live_data as boolean,
          diagnosis_source: dx.diagnosis_source as string,
        };
        const { verdict, reasons } = evaluate(c, actual);
        next[i] = { case: c, status: "done", actual, verdict, reasons };
      } catch (e) {
        next[i] = { case: c, status: "error", error: e instanceof Error ? e.message : "Unknown" };
      }
      setRows([...next]);
    }
    setRunning(false);
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
      toast.success("Diagnosis report copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const counts = rows.reduce(
    (acc, r) => {
      if (r.verdict === "pass") acc.pass++;
      else if (r.verdict === "warn") acc.warn++;
      else if (r.verdict === "fail") acc.fail++;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0 },
  );

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-foreground flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" /> Domain Diagnosis Smoke
            <Badge variant="outline" className="ml-2">V2-ARCH.1A · diagnose_only</Badge>
          </h3>
          <p className="text-xs text-muted-foreground">
            Runs the new domain diagnosis layer against canonical BTPM business situations.
            No retrieval, no answer generation, no persistence.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            Run 7 cases
          </Button>
          <Button variant="outline" onClick={copyReport} disabled={running}>
            <Copy className="h-4 w-4 mr-1" /> Copy JSON
          </Button>
        </div>
      </div>

      <div className="flex gap-3 text-xs">
        <Badge variant="secondary">Pass: {counts.pass}</Badge>
        <Badge variant="secondary">Warn: {counts.warn}</Badge>
        <Badge variant="secondary">Fail: {counts.fail}</Badge>
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.case.id} className="border rounded-md p-3 space-y-1 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-foreground">{r.case.question}</div>
              <Badge
                variant={
                  r.verdict === "pass"
                    ? "default"
                    : r.verdict === "warn"
                    ? "outline"
                    : r.verdict === "fail"
                    ? "destructive"
                    : "secondary"
                }
              >
                {r.status === "running"
                  ? "running…"
                  : r.status === "error"
                  ? "error"
                  : r.verdict ?? r.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              expected: <span className="font-mono">{r.case.expected_situation}</span> /{" "}
              <span className="font-mono">{r.case.expected_strategy}</span>
            </div>
            {r.actual && (
              <div className="text-xs">
                actual: <span className="font-mono">{r.actual.domain_situation}</span> /{" "}
                <span className="font-mono">{r.actual.answer_strategy}</span>
                {" · conf "}{(r.actual.confidence ?? 0).toFixed(2)}
                {" · "}{r.actual.diagnosis_source}
              </div>
            )}
            {r.actual && (
              <div className="text-xs text-muted-foreground">
                canonical: [{(r.actual.canonical_objects ?? []).join(", ")}]
                {(r.actual.possible_objects ?? []).length > 0 && (
                  <> · possible: [{r.actual.possible_objects!.join(", ")}]</>
                )}
                {(r.actual.recommended_kc_slugs ?? []).length > 0 && (
                  <> · kc: [{r.actual.recommended_kc_slugs!.slice(0, 4).join(", ")}]</>
                )}
              </div>
            )}
            {r.reasons && r.reasons.length > 0 && (
              <div className="text-xs text-destructive">{r.reasons.join("; ")}</div>
            )}
            {r.error && <div className="text-xs text-destructive">{r.error}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}
