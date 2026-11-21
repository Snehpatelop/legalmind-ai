import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileText,
  ListChecks,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, downloadFile } from "@/api/client";
import type { Analysis, CitedItem, RiskFinding, RiskLevel, RiskResult, SummaryResult } from "@/api/types";
import { useReadyDocuments } from "@/hooks/queries";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Notice, PageHeader, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { PageRefs, QuoteBlock, RiskBadge } from "@/components/evidence";
import { cn, errorMessage, formatDateTime, formatMs } from "@/lib/utils";

const CATEGORY_LABEL: Record<string, string> = {
  termination: "Termination", payment: "Payment terms", liability: "Liability", confidentiality: "Confidentiality",
  indemnification: "Indemnification", dispute_resolution: "Dispute resolution", duration: "Contract duration",
  responsibilities: "Responsibilities", penalties: "Penalty clauses", other: "Other",
};

function FindingCard({ f, documentId }: { f: RiskFinding; documentId: string }) {
  const [open, setOpen] = React.useState(f.risk_level === "HIGH");
  const accent = f.risk_level === "HIGH" ? "bg-risk-high" : f.risk_level === "MEDIUM" ? "bg-risk-med" : "bg-risk-low";
  return (
    <div className="relative overflow-hidden rounded-[12px] border border-line bg-surface shadow-card">
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", accent)} />
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-5 py-4 text-left cursor-pointer" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <RiskBadge level={f.risk_level} />
            <span className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{CATEGORY_LABEL[f.category] ?? f.category}</span>
          </div>
          <div className="font-display text-[15px] font-semibold text-ink">{f.clause_name}</div>
          <div className="mt-0.5 text-[13px] text-muted">{f.potential_risk}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden font-mono text-[11px] text-muted sm:inline">p.{f.page_number}</span>
          <ChevronDown className={cn("size-4 text-muted transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-5 pb-5 pt-4">
          <div>
            <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Original clause text</div>
            <QuoteBlock text={f.extracted_text} />
            {!f.quote_verified && (
              <p className="mt-1.5 text-[11.5px] text-muted">Showing the cited source passage (the model's quotation could not be matched verbatim).</p>
            )}
          </div>
          <div>
            <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Why it matters</div>
            <p className="text-[13.5px] leading-relaxed text-ink/90">{f.explanation}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <FileText className="size-3.5" /> {f.document_name}
            <PageRefs citations={f.citations} documentId={documentId} />
          </div>
        </div>
      )}
    </div>
  );
}

function RiskView({ analysis }: { analysis: Analysis<RiskResult> }) {
  const r = analysis.result;
  const [level, setLevel] = React.useState<RiskLevel | "ALL">("ALL");
  const findings = r.findings.filter((f) => level === "ALL" || f.risk_level === level);
  const tone = r.overall_risk === "HIGH" ? "text-risk-high" : r.overall_risk === "MEDIUM" ? "text-risk-med" : "text-risk-low";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardContent className="pt-5">
            <div className="text-[12.5px] font-medium text-muted">Overall risk profile</div>
            <div className={cn("mt-2 font-display text-3xl font-semibold", tone)}>{r.overall_risk}</div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {(["HIGH", "MEDIUM", "LOW"] as RiskLevel[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(level === l ? "ALL" : l)}
                  className={cn(
                    "rounded-[10px] border px-3 py-2.5 text-left transition-colors cursor-pointer",
                    level === l ? "border-teal bg-sage-soft" : "border-line hover:bg-surface-2",
                  )}
                >
                  <div className="font-display text-xl font-semibold">{r.counts[l]}</div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">{l.toLowerCase()}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-1 font-mono text-[11px] text-muted">
              <div>{r.sources_reviewed} passages reviewed · {formatMs(r.duration_ms)}</div>
              {r.unsupported_findings_removed > 0 && <div>{r.unsupported_findings_removed} unsupported finding(s) discarded</div>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Assessment overview</CardTitle>
            <Button variant="secondary" size="sm" onClick={() => downloadFile(`/api/analysis/${analysis.id}/export.pdf`, `risk-${r.document_name}`).catch((e) => toast.error(errorMessage(e)))}>
              <Download /> Export PDF
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-[14px] leading-relaxed text-ink/90">{r.overview || "No overview provided."}</p>
            {r.missing_clauses.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Not found in reviewed passages</div>
                <div className="flex flex-wrap gap-1.5">
                  {r.missing_clauses.map((m, i) => (
                    <Badge key={i} variant="neutral" title={m.note}>{CATEGORY_LABEL[m.category] ?? m.category}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[15px] font-semibold">Clause findings {level !== "ALL" && <span className="text-muted">· {level.toLowerCase()} only</span>}</h2>
        {level !== "ALL" && <Button variant="link" size="sm" onClick={() => setLevel("ALL")}>Show all</Button>}
      </div>
      {findings.length === 0 ? (
        <Card><EmptyState icon={ShieldCheck} title="No findings at this level" description="No evidence-backed issues were identified for this filter." /></Card>
      ) : (
        <div className="space-y-3">{findings.map((f, i) => <FindingCard key={i} f={f} documentId={r.document_id} />)}</div>
      )}
      <p className="text-[11.5px] text-muted">{r.disclaimer}</p>
    </div>
  );
}

const SUMMARY_SECTIONS: [keyof SummaryResult, string][] = [
  ["key_obligations", "Key obligations"],
  ["financial_obligations", "Financial obligations"],
  ["termination_provisions", "Termination provisions"],
  ["liability_conditions", "Liability conditions"],
  ["confidentiality_provisions", "Confidentiality provisions"],
  ["potential_risks", "Potential risks"],
];

function SummaryView({ analysis }: { analysis: Analysis<SummaryResult> }) {
  const s = analysis.result;
  const list = (items: CitedItem[]) => (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed">
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brass" />
          <span>{it.text} <PageRefs citations={it.citations} documentId={s.document_id} /></span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Executive summary</CardTitle>
            <p className="mt-0.5 text-[12.5px] text-muted capitalize">{s.length} · {s.coverage === "full" ? "full document reviewed" : "key sections reviewed"} · {formatDateTime(analysis.created_at)}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => downloadFile(`/api/analysis/${analysis.id}/export.pdf`, `summary-${s.document_name}`).catch((e) => toast.error(errorMessage(e)))}>
            <Download /> Export PDF
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-[14.5px] leading-relaxed text-ink/90">{s.executive_summary} <PageRefs citations={s.executive_summary_citations} documentId={s.document_id} /></p>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Parties involved</CardTitle></CardHeader>
          <CardContent>
            {s.parties.length === 0 ? <p className="text-[13px] text-muted">None identified.</p> : (
              <div className="space-y-2.5">
                {s.parties.map((p, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 rounded-[10px] border border-line px-3 py-2.5">
                    <div><div className="text-[13.5px] font-medium">{p.name}</div><div className="text-[12.5px] text-muted">{p.role}</div></div>
                    <PageRefs citations={p.citations} documentId={s.document_id} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Important dates</CardTitle></CardHeader>
          <CardContent>
            {s.important_dates.length === 0 ? <p className="text-[13px] text-muted">None identified.</p> : (
              <div className="space-y-2">
                {s.important_dates.map((d, i) => (
                  <div key={i} className="flex items-start gap-3 text-[13.5px]">
                    <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-ink ring-1 ring-line">{d.date}</span>
                    <span className="flex-1">{d.description} <PageRefs citations={d.citations} documentId={s.document_id} /></span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        {SUMMARY_SECTIONS.map(([key, title]) => {
          const items = s[key] as CitedItem[];
          return (
            <Card key={key}>
              <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
              <CardContent>{items.length ? list(items) : <p className="text-[13px] text-muted">Nothing identified in the document.</p>}</CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-[11.5px] text-muted">{s.disclaimer}</p>
    </div>
  );
}

export default function ContractAnalysisPage() {
  const [params, setParams] = useSearchParams();
  const { ready: docs, isLoading } = useReadyDocuments();
  const qc = useQueryClient();
  const docId = params.get("doc") ?? "";
  const tab = params.get("tab") === "summary" ? "summary" : "risk";
  const [length, setLength] = React.useState<"short" | "medium" | "detailed">("medium");

  React.useEffect(() => {
    if (!docId && docs.length) setParams({ doc: docs[0].id, tab }, { replace: true });
  }, [docId, docs, setParams, tab]);

  const latest = useQuery({
    queryKey: ["analyses", docId, tab],
    queryFn: () => api.analyses<RiskResult | SummaryResult>({ document_id: docId, analysis_type: tab === "risk" ? "contract_risk" : "summary" }),
    enabled: !!docId,
  });

  const run = useMutation({
    mutationFn: (): Promise<Analysis<unknown>> => (tab === "risk" ? api.contractRisk(docId) : api.summarize(docId, length)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["analyses", docId, tab] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      toast.success(tab === "risk" ? "Risk analysis complete" : "Summary ready");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const current = latest.data?.[0];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Contract review"
        title="Contract Analysis"
        description="Evidence-backed risk review and structured summaries. Every finding links to the clause text and page it came from."
      />
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : docs.length === 0 ? (
        <Card><EmptyState icon={ShieldAlert} title="No indexed documents" description="Upload a contract to run risk analysis and summaries." action={<Button asChild><Link to="/documents">Upload a document</Link></Button>} /></Card>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setParams({ doc: docId, tab: v })}>
          <Card className="mb-5">
            <CardContent className="flex flex-col gap-3 pt-5 lg:flex-row lg:items-end">
              <div className="flex-1">
                <label className="mb-1.5 block text-[12.5px] font-medium text-muted" htmlFor="doc-select">Document</label>
                <Select id="doc-select" value={docId} onChange={(e) => setParams({ doc: e.target.value, tab })}>
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
                </Select>
              </div>
              <TabsList>
                <TabsTrigger value="risk"><ShieldAlert /> Risk review</TabsTrigger>
                <TabsTrigger value="summary"><ScrollText /> Summary</TabsTrigger>
              </TabsList>
              {tab === "summary" && (
                <Select value={length} onChange={(e) => setLength(e.target.value as typeof length)} className="lg:w-36" aria-label="Summary length">
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="detailed">Detailed</option>
                </Select>
              )}
              <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!docId}>
                <Sparkles /> {current ? "Run again" : tab === "risk" ? "Analyse risks" : "Generate summary"}
              </Button>
            </CardContent>
          </Card>

          {run.isPending && (
            <Notice tone="sage" icon={ListChecks} className="mb-4">
              {tab === "risk"
                ? "Retrieving clauses for 9 risk categories, reranking evidence and asking Gemini for a grounded review… this usually takes 15–40 seconds."
                : "Reading the document and extracting cited facts… this usually takes 10–30 seconds."}
            </Notice>
          )}
          {latest.isError && <ErrorState message={(latest.error as Error).message} />}

          <TabsContent value="risk">
            {latest.isLoading ? <Skeleton className="h-64" /> : current && tab === "risk" ? (
              <RiskView analysis={current as Analysis<RiskResult>} />
            ) : !run.isPending && (
              <Card><EmptyState icon={AlertTriangle} title="No risk analysis yet" description="Run a review to identify termination, payment, liability, confidentiality, indemnification, dispute, duration, responsibility and penalty risks." /></Card>
            )}
          </TabsContent>
          <TabsContent value="summary">
            {latest.isLoading ? <Skeleton className="h-64" /> : current && tab === "summary" ? (
              <SummaryView analysis={current as Analysis<SummaryResult>} />
            ) : !run.isPending && (
              <Card><EmptyState icon={ScrollText} title="No summary yet" description="Generate a short, medium or detailed summary with parties, obligations, dates and risks — each with page citations." /></Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  );
}
