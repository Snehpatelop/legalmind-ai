import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, GitCompareArrows, ListChecks, Sparkles, TriangleAlert } from "lucide-react";
import { api } from "@/api/client";
import type { Analysis, CompareAspect, CompareResult } from "@/api/types";
import { useReadyDocuments } from "@/hooks/queries";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Card, CardContent, EmptyState, Notice, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { PageRefs } from "@/components/evidence";
import { cn, errorMessage, formatDateTime, formatMs } from "@/lib/utils";

const STATUS: Record<CompareAspect["status"], { label: string; variant: "sage" | "brass" | "high" | "neutral" }> = {
  common: { label: "Common", variant: "sage" },
  different: { label: "Different", variant: "brass" },
  missing_in_a: { label: "Missing in A", variant: "high" },
  missing_in_b: { label: "Missing in B", variant: "high" },
  missing_in_both: { label: "Not found", variant: "neutral" },
};

function AspectRow({ a, docA, docB }: { a: CompareAspect; docA: string; docB: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2/60 px-5 py-3">
        <h3 className="font-display text-[14.5px] font-semibold">{a.aspect}</h3>
        <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
      </div>
      <div className="grid md:grid-cols-2">
        {([["A", a.document_a, docA], ["B", a.document_b, docB]] as const).map(([k, side, id], i) => (
          <div key={k} className={cn("px-5 py-4", i === 0 && "border-b border-line md:border-b-0 md:border-r")}>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <span className="flex size-5 items-center justify-center rounded bg-navy font-mono text-[10px] text-white dark:bg-surface-2 dark:text-ink">{k}</span>
              Document {k}
            </div>
            <p className={cn("text-[13.5px] leading-relaxed", side.citations.length ? "text-ink/90" : "text-muted italic")}>{side.summary}</p>
            <div className="mt-2"><PageRefs citations={side.citations} documentId={id} /></div>
          </div>
        ))}
      </div>
      {(a.key_differences || a.wording_changes.length > 0 || a.inconsistencies.length > 0) && (
        <div className="space-y-2.5 border-t border-line px-5 py-4 text-[13px]">
          {a.key_differences && <p><span className="font-semibold">Key difference: </span>{a.key_differences}</p>}
          {a.wording_changes.length > 0 && (
            <div>
              <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Significant wording changes</div>
              <ul className="space-y-1">{a.wording_changes.map((w, i) => <li key={i} className="flex gap-2"><ArrowLeftRight className="mt-0.5 size-3.5 shrink-0 text-brass" />{w}</li>)}</ul>
            </div>
          )}
          {a.inconsistencies.length > 0 && (
            <div>
              <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Potential inconsistencies</div>
              <ul className="space-y-1">{a.inconsistencies.map((w, i) => <li key={i} className="flex gap-2 text-risk-med"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{w}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function ComparePage() {
  const { ready: docs, isLoading } = useReadyDocuments();
  const qc = useQueryClient();
  const [a, setA] = React.useState("");
  const [b, setB] = React.useState("");
  const [shown, setShown] = React.useState<Analysis<CompareResult> | null>(null);
  const [filter, setFilter] = React.useState<"all" | "different" | "missing" | "common">("all");

  React.useEffect(() => {
    if (docs.length >= 2 && !a && !b) {
      setA(docs[1].id);
      setB(docs[0].id);
    }
  }, [docs, a, b]);

  const history = useQuery({ queryKey: ["analyses", "comparison"], queryFn: () => api.analyses<CompareResult>({ analysis_type: "comparison" }) });
  React.useEffect(() => {
    if (!shown && history.data?.length) setShown(history.data[0]);
  }, [history.data, shown]);

  const run = useMutation({
    mutationFn: () => api.compare(a, b),
    onSuccess: (res) => {
      setShown(res);
      qc.invalidateQueries({ queryKey: ["analyses", "comparison"] });
      toast.success("Comparison complete");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const r = shown?.result;
  const aspects = (r?.aspects ?? []).filter((x) =>
    filter === "all" ? true : filter === "missing" ? x.status.startsWith("missing") : x.status === filter,
  );

  return (
    <PageContainer>
      <PageHeader eyebrow="Side by side" title="Document Comparison" description="Compare two agreements clause by clause. Each side cites its own document and page." />
      {isLoading ? <Skeleton className="h-24" /> : docs.length < 2 ? (
        <Card><EmptyState icon={GitCompareArrows} title="You need two indexed documents" description="Upload at least two PDFs — for example two versions of a contract — to compare them." action={<Button asChild><Link to="/documents">Upload documents</Link></Button>} /></Card>
      ) : (
        <>
          <Card className="mb-5">
            <CardContent className="grid gap-3 pt-5 md:grid-cols-[1fr_auto_1fr_auto] md:items-end">
              <div>
                <label htmlFor="doc-a" className="mb-1.5 block text-[12.5px] font-medium text-muted">Document A</label>
                <Select id="doc-a" value={a} onChange={(e) => setA(e.target.value)}>
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
                </Select>
              </div>
              <Button variant="ghost" size="icon" aria-label="Swap documents" onClick={() => { setA(b); setB(a); }} className="justify-self-center"><ArrowLeftRight /></Button>
              <div>
                <label htmlFor="doc-b" className="mb-1.5 block text-[12.5px] font-medium text-muted">Document B</label>
                <Select id="doc-b" value={b} onChange={(e) => setB(e.target.value)}>
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
                </Select>
              </div>
              <Button onClick={() => run.mutate()} loading={run.isPending} disabled={!a || !b || a === b}><Sparkles /> Compare</Button>
            </CardContent>
          </Card>
          {a === b && <Notice tone="brass" className="mb-4">Select two different documents.</Notice>}
          {run.isPending && <Notice tone="sage" icon={ListChecks} className="mb-4">Retrieving matching clauses from both documents and building a cited comparison… usually 20–45 seconds.</Notice>}

          {r ? (
            <>
              <Card className="mb-4">
                <CardContent className="pt-5">
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                    <span className="font-medium text-ink">{r.document_a.name}</span> vs <span className="font-medium text-ink">{r.document_b.name}</span>
                    <span>· {formatDateTime(shown!.created_at)} · {formatMs(r.duration_ms)}</span>
                  </div>
                  <p className="text-[14px] leading-relaxed text-ink/90">{r.overview}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {([["all", `All ${r.aspects.length}`], ["different", `${r.counts.different} different`], ["missing", `${r.counts.missing} missing`], ["common", `${r.counts.common} common`]] as const).map(([k, label]) => (
                      <button key={k} onClick={() => setFilter(k)} className={cn("rounded-lg border px-3 py-1.5 text-[12.5px] font-medium cursor-pointer", filter === k ? "border-teal bg-sage-soft text-teal" : "border-line text-muted hover:text-ink")}>
                        {label}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-3">{aspects.map((x, i) => <AspectRow key={i} a={x} docA={r.document_a.id} docB={r.document_b.id} />)}</div>
              <p className="mt-4 text-[11.5px] text-muted">{r.disclaimer}</p>
            </>
          ) : !run.isPending && (
            <Card><EmptyState icon={GitCompareArrows} title="No comparison yet" description="Pick two documents and run a comparison of payment, termination, liability, confidentiality, duration, disputes, responsibilities, penalties and parties." /></Card>
          )}

          {history.data && history.data.length > 1 && (
            <div className="mt-8">
              <h3 className="mb-2 font-display text-[14px] font-semibold">Previous comparisons</h3>
              <div className="flex flex-wrap gap-2">
                {history.data.map((h) => (
                  <button key={h.id} onClick={() => setShown(h)} className={cn("rounded-lg border px-3 py-2 text-left text-[12.5px] cursor-pointer", shown?.id === h.id ? "border-teal bg-sage-soft" : "border-line bg-surface hover:bg-surface-2")}>
                    <div className="max-w-[260px] truncate font-medium">{h.result.document_a.name} ↔ {h.result.document_b.name}</div>
                    <div className="text-muted">{formatDateTime(h.created_at)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </PageContainer>
  );
}
