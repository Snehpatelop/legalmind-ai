import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis, Legend } from "recharts";
import { AlertTriangle, BarChart3, ChevronDown, Database, FlaskConical, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import type { EvalDataset, EvalRow, Evaluation } from "@/api/types";
import { useReadyDocuments, useSystemStatus } from "@/hooks/queries";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, EmptyState, FieldError, Input, Label, Notice, PageHeader, Progress, Textarea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { DocumentPicker } from "@/components/evidence";
import { cn, errorMessage, formatDateTime } from "@/lib/utils";

const METRICS: { key: string; label: string; help: string }[] = [
  { key: "faithfulness", label: "Faithfulness", help: "Are answer claims supported by the retrieved context?" },
  { key: "answer_relevancy", label: "Answer relevancy", help: "Does the answer address the question?" },
  { key: "context_precision", label: "Context precision", help: "Are relevant passages ranked above irrelevant ones?" },
  { key: "context_recall", label: "Context recall", help: "Does the retrieved context cover the reference answer?" },
];

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));
const tone = (v: number | null | undefined) => (v === null || v === undefined ? "text-muted" : v >= 0.75 ? "text-teal" : v >= 0.5 ? "text-risk-med" : "text-risk-high");

const qSchema = z.object({ question: z.string().trim().min(3, "Enter a question"), ground_truth: z.string().trim().min(1, "Enter the reference answer") });
const dsSchema = z.object({ name: z.string().trim().min(1, "Name is required"), description: z.string().optional() });

function QuestionForm({ datasetId }: { datasetId: string }) {
  const qc = useQueryClient();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<z.infer<typeof qSchema>>({ resolver: zodResolver(qSchema) });
  const submit = async (v: z.infer<typeof qSchema>) => {
    try {
      await api.addQuestion(datasetId, v);
      reset();
      qc.invalidateQueries({ queryKey: ["datasets"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-2 rounded-[10px] border border-dashed border-line-strong p-3">
      <Input placeholder="Test question" {...register("question")} aria-label="Test question" />
      <FieldError>{errors.question?.message}</FieldError>
      <Textarea rows={2} placeholder="Reference (ground-truth) answer" {...register("ground_truth")} aria-label="Reference answer" />
      <FieldError>{errors.ground_truth?.message}</FieldError>
      <Button type="submit" size="sm" variant="secondary" loading={isSubmitting}><Plus /> Add question</Button>
    </form>
  );
}

function DatasetCard({ ds, selected, onSelect }: { ds: EvalDataset; selected: boolean; onSelect: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const remove = async () => {
    try {
      await api.deleteDataset(ds.id);
      qc.invalidateQueries({ queryKey: ["datasets"] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className={cn("rounded-[12px] border bg-surface", selected ? "border-teal ring-2 ring-[var(--ring)]" : "border-line")}>
      <div className="flex items-start gap-3 px-4 py-3">
        <input type="radio" checked={selected} onChange={onSelect} className="mt-1 accent-[var(--teal)]" aria-label={`Select ${ds.name}`} />
        <button onClick={onSelect} className="min-w-0 flex-1 text-left cursor-pointer">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[13.5px] font-medium">{ds.name}</span>
            {ds.is_sample ? <Badge variant="brass">Sample dataset</Badge> : <Badge variant="sage">Custom</Badge>}
          </div>
          <div className="text-[12px] text-muted">{ds.questions.length} questions</div>
        </button>
        <button onClick={() => setOpen((o) => !o)} className="rounded p-1 text-muted hover:text-ink cursor-pointer" aria-label="Manage questions">
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          {ds.description && <p className="text-[12px] text-muted">{ds.description}</p>}
          {ds.questions.map((q) => (
            <div key={q.id} className="group flex gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px]">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{q.question}</div>
                <div className="text-muted">{q.ground_truth}</div>
              </div>
              <button onClick={async () => { await api.deleteQuestion(ds.id, q.id); qc.invalidateQueries({ queryKey: ["datasets"] }); }} className="text-muted opacity-0 hover:text-risk-high group-hover:opacity-100 cursor-pointer" aria-label="Delete question">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          <QuestionForm datasetId={ds.id} />
          <Button variant="outlineDanger" size="sm" onClick={remove}><Trash2 /> Delete dataset</Button>
        </div>
      )}
    </div>
  );
}

function RowDetail({ row, i }: { row: EvalRow; i: number }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-2/60 cursor-pointer" aria-expanded={open}>
        <span className="font-mono text-[11px] text-muted">Q{i + 1}</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{row.question}</span>
        <div className="hidden gap-3 font-mono text-[12px] md:flex">
          {METRICS.map((m) => <span key={m.key} className={cn("w-9 text-right", tone(row.scores[m.key]))}>{fmt(row.scores[m.key])}</span>)}
        </div>
        {row.failed ? <Badge variant="high">Review</Badge> : <Badge variant="sage">Pass</Badge>}
        <ChevronDown className={cn("size-4 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid gap-4 bg-surface-2/40 px-5 pb-5 pt-2 lg:grid-cols-2">
          <div className="space-y-3 text-[13px]">
            <div className="grid grid-cols-2 gap-2 md:hidden">
              {METRICS.map((m) => <div key={m.key} className="text-[12px]"><span className="text-muted">{m.label}: </span><span className={tone(row.scores[m.key])}>{fmt(row.scores[m.key])}</span></div>)}
            </div>
            {row.failure_reasons.length > 0 && <Notice tone="high" icon={AlertTriangle}>{row.failure_reasons.join(" · ")}</Notice>}
            <div><div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Reference answer</div><p>{row.ground_truth}</p></div>
            <div><div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Generated answer</div><p className="whitespace-pre-line">{row.answer}</p></div>
          </div>
          <div>
            <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Retrieved context ({row.contexts.length})</div>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1 scroll-thin">
              {row.contexts.map((c, j) => (
                <div key={j} className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px]">
                  <div className="mb-1 font-mono text-[10.5px] text-muted">{c.document_name} · p.{c.page_number}</div>
                  <p className="line-clamp-4 text-ink/80">{c.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RunView({ ev }: { ev: Evaluation }) {
  const mr = ev.metric_results;
  if (ev.status === "running") {
    const p = mr?.progress;
    return (
      <Card><CardContent className="pt-6">
        <div className="mb-3 flex items-center gap-2 text-[13.5px] font-medium"><Loader2 className="size-4 animate-spin text-teal" /> Running “{ev.dataset_name}” — {p?.stage ?? "starting"}</div>
        <Progress value={p ? ((p.done + (p.stage === "scoring with Ragas" ? 0.5 : 0)) / Math.max(p.total, 1)) * 100 : 5} />
        <p className="mt-2 text-[12px] text-muted">{p ? `${p.done}/${p.total} answers generated` : ""} · Ragas judge calls can take a few minutes on the free Gemini tier.</p>
      </CardContent></Card>
    );
  }
  if (ev.status === "failed") {
    return <Notice tone="high" icon={AlertTriangle}><span className="font-semibold">Evaluation could not run:</span> {ev.error}</Notice>;
  }
  const rows = mr?.rows ?? [];
  const chart = rows.map((r, i) => ({ name: `Q${i + 1}`, ...Object.fromEntries(METRICS.map((m) => [m.label, r.scores[m.key] ?? 0])) }));
  const colors = ["var(--teal)", "var(--brass)", "var(--navy)", "var(--sage)"];
  const failed = rows.filter((r) => r.failed).length;
  return (
    <div className="space-y-4">
      {ev.is_sample && (
        <Notice tone="brass" icon={Database}>
          These are real Ragas scores computed on the <span className="font-semibold">sample dataset</span> for the bundled sample contracts — they describe system behaviour on demo data, not on your own documents.
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {METRICS.map((m) => (
          <div key={m.key} className="rounded-[12px] border border-line bg-surface p-4 shadow-card" title={m.help}>
            <div className="text-[12.5px] font-medium text-muted">{m.label}</div>
            <div className={cn("mt-2 font-display text-[28px] font-semibold leading-none", tone(mr?.aggregate?.[m.key]))}>{fmt(mr?.aggregate?.[m.key])}</div>
            <div className="mt-2 text-[11.5px] leading-snug text-muted">{m.help}</div>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Per-question scores</CardTitle>
            <CardDescription>{rows.length} questions · {failed} flagged for review (any metric below {String(mr?.config?.fail_threshold ?? 0.5)}) · Ragas {mr?.ragas_version}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ left: -20, right: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-2)" }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: "var(--text-2)" }} tickLine={false} axisLine={false} />
              <RTooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => v.toFixed(2)} cursor={{ fill: "var(--surface-2)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
              {METRICS.map((m, i) => <Bar key={m.key} dataKey={m.label} fill={colors[i]} radius={[3, 3, 0, 0]} maxBarSize={14} />)}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="font-display text-[14.5px] font-semibold">Query inspection</h3>
          <div className="hidden gap-3 font-mono text-[10.5px] uppercase text-muted md:flex">{METRICS.map((m) => <span key={m.key} className="w-9 text-right">{m.label.split(" ").map((w) => w[0]).join("")}</span>)}<span className="w-[92px]" /></div>
        </div>
        {rows.map((r, i) => <RowDetail key={i} row={r} i={i} />)}
      </Card>
      {mr?.config && <p className="font-mono text-[11px] text-muted">judge: {String(mr.config.judge_llm)} · embeddings: {String(mr.config.embedding_model)} · retrieval: {String(mr.config.retrieval)}</p>}
    </div>
  );
}

export default function EvaluationPage() {
  const qc = useQueryClient();
  const status = useSystemStatus();
  const { ready: docs } = useReadyDocuments();
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: api.datasets });
  const evals = useQuery({
    queryKey: ["evaluations"],
    queryFn: api.evaluations,
    refetchInterval: (q) => (q.state.data?.some((e) => e.status === "running") ? 2500 : false),
  });
  const [dsId, setDsId] = React.useState<string>("");
  const [scope, setScope] = React.useState<string[]>([]);
  const [runId, setRunId] = React.useState<string>("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const form = useForm<z.infer<typeof dsSchema>>({ resolver: zodResolver(dsSchema) });

  React.useEffect(() => {
    if (!dsId && datasets.data?.length) setDsId(datasets.data[0].id);
  }, [datasets.data, dsId]);
  React.useEffect(() => {
    if (!runId && evals.data?.length) setRunId(evals.data[0].id);
  }, [evals.data, runId]);

  const sample = useMutation({
    mutationFn: api.createSampleDataset,
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ["datasets"] }); setDsId(d.id); toast.success("Sample dataset added"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = useMutation({
    mutationFn: () => api.runEvaluation(dsId, scope.length ? scope : null),
    onSuccess: (ev) => { setRunId(ev.id); qc.invalidateQueries({ queryKey: ["evaluations"] }); toast.success("Evaluation started"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const createDs = async (v: z.infer<typeof dsSchema>) => {
    try {
      const d = await api.createDataset(v);
      qc.invalidateQueries({ queryKey: ["datasets"] });
      setDsId(d.id);
      setCreateOpen(false);
      form.reset();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const current = evals.data?.find((e) => e.id === runId);
  const selectedDs = datasets.data?.find((d) => d.id === dsId);

  return (
    <PageContainer>
      <PageHeader eyebrow="Quality" title="RAG Evaluation" description="Measure retrieval and generation quality with Ragas: faithfulness, answer relevancy, context precision and context recall." />
      {status.data && !status.data.gemini_configured && (
        <Notice tone="brass" icon={AlertTriangle} className="mb-5">Ragas uses Gemini as its judge model. Add GEMINI_API_KEY to your .env to run evaluations — without it runs fail with that reason, and no scores are shown.</Notice>
      )}
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div><CardTitle>Test datasets</CardTitle><CardDescription>Questions with reference answers</CardDescription></div>
              <Button size="iconSm" variant="secondary" onClick={() => setCreateOpen(true)} aria-label="Create dataset"><Plus /></Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {datasets.data?.length === 0 && (
                <EmptyState className="py-6" icon={FlaskConical} title="No datasets" description="Create your own, or load the sample dataset that matches the bundled sample contract."
                  action={<Button size="sm" variant="secondary" loading={sample.isPending} onClick={() => sample.mutate()}><Database /> Load sample dataset</Button>} />
              )}
              {datasets.data?.map((d) => <DatasetCard key={d.id} ds={d} selected={d.id === dsId} onSelect={() => setDsId(d.id)} />)}
              {!!datasets.data?.length && !datasets.data.some((d) => d.is_sample) && (
                <Button size="sm" variant="ghost" onClick={() => sample.mutate()} loading={sample.isPending}><Database /> Add sample dataset</Button>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 pt-5">
              <div className="text-[12.5px] font-medium text-muted">Retrieval scope</div>
              <DocumentPicker documents={docs} selected={scope} onChange={setScope} emptyLabel="All ready documents" />
              <Button className="w-full" onClick={() => run.mutate()} loading={run.isPending} disabled={!selectedDs || !selectedDs.questions.length || evals.data?.some((e) => e.status === "running")}>
                <Play /> Run evaluation
              </Button>
              {selectedDs && !selectedDs.questions.length && <p className="text-[12px] text-muted">Add questions to this dataset first.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Run history</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {evals.data?.length === 0 && <p className="text-[12.5px] text-muted">No runs yet.</p>}
              {evals.data?.map((e) => (
                <div key={e.id} className={cn("group flex items-center gap-2 rounded-lg px-2.5 py-2", e.id === runId ? "bg-surface-2" : "hover:bg-surface-2/60")}>
                  <button onClick={() => setRunId(e.id)} className="min-w-0 flex-1 text-left cursor-pointer">
                    <div className="truncate text-[13px]">{e.dataset_name}</div>
                    <div className="text-[11px] text-muted">{formatDateTime(e.created_at)}</div>
                  </button>
                  <Badge variant={e.status === "completed" ? "sage" : e.status === "failed" ? "high" : "brass"}>{e.status}</Badge>
                  {e.status !== "running" && (
                    <button onClick={async () => { await api.deleteEvaluation(e.id); if (runId === e.id) setRunId(""); qc.invalidateQueries({ queryKey: ["evaluations"] }); }} className="text-muted opacity-0 hover:text-risk-high group-hover:opacity-100 cursor-pointer" aria-label="Delete run">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="min-w-0">
          {current ? <RunView ev={current} /> : (
            <Card><EmptyState icon={BarChart3} title="No evaluation results yet" description="Select a dataset and run an evaluation. Each question goes through the full RAG pipeline, then Ragas scores the answer and retrieved context." /></Card>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent title="New evaluation dataset" description="Add questions and reference answers after creating it.">
          <form onSubmit={form.handleSubmit(createDs)} className="space-y-3">
            <div><Label htmlFor="ds-name">Name</Label><Input id="ds-name" {...form.register("name")} /><FieldError>{form.formState.errors.name?.message}</FieldError></div>
            <div><Label htmlFor="ds-desc">Description</Label><Textarea id="ds-desc" rows={2} {...form.register("description")} /></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" loading={form.formState.isSubmitting}>Create</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
