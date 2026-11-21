import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import {
  ArrowRight,
  FileSearch,
  FileText,
  Gauge,
  MessageSquareText,
  MessagesSquare,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { api } from "@/api/client";
import { useAuth } from "@/hooks/auth";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/evidence";
import { cn, formatDate, formatMs, timeAgo } from "@/lib/utils";
import type { DocStatus } from "@/api/types";

const STATUS_STYLE: Record<DocStatus, { label: string; variant: "sage" | "brass" | "neutral" | "high" }> = {
  ready: { label: "Ready", variant: "sage" },
  processing: { label: "Processing", variant: "brass" },
  pending: { label: "Queued", variant: "neutral" },
  failed: { label: "Failed", variant: "high" },
};

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-1 font-medium text-ink">{formatDate(label, { day: "numeric", month: "short" })}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-muted">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-ink">{p.value ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const activity = useQuery({ queryKey: ["activity"], queryFn: () => api.activity(14) });
  const s = stats.data;
  const a = activity.data;
  const isNew = s && s.total_documents === 0 && s.total_queries === 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const tick = { fontSize: 11, fill: "var(--text-2)" };

  return (
    <PageContainer>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brass">
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <h1 className="font-display text-2xl font-semibold text-ink">
            {greeting}, {user?.name.split(" ")[0]}
          </h1>
          <p className="mt-1.5 text-sm text-muted">Here is the state of your legal research workspace.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link to="/documents"><Upload /> Upload documents</Link>
          </Button>
          <Button asChild>
            <Link to="/assistant"><MessageSquareText /> Ask the assistant</Link>
          </Button>
        </div>
      </div>

      {stats.isError && <ErrorState message={(stats.error as Error).message} onRetry={() => stats.refetch()} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {stats.isLoading || !s ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[118px] rounded-[12px]" />)
        ) : (
          <>
            <StatTile label="Documents" icon={FileText} value={s.total_documents} hint={`${s.total_pages} pages · ${s.total_chunks} chunks indexed`} />
            <StatTile label="Queries processed" icon={FileSearch} value={s.total_queries} hint={`${s.chat_queries} assistant · ${s.search_queries} search`} />
            <StatTile label="Conversations" icon={MessagesSquare} value={s.total_conversations} hint={`${(s.analyses.contract_risk ?? 0) + (s.analyses.summary ?? 0) + (s.analyses.comparison ?? 0)} analyses run`} />
            <StatTile label="Avg. retrieval latency" icon={Gauge} value={formatMs(s.avg_retrieval_ms)} hint={s.avg_response_ms ? `End-to-end ${formatMs(s.avg_response_ms)}` : "No queries yet"} />
          </>
        )}
      </div>

      {isNew ? (
        <Card className="mt-6">
          <EmptyState
            icon={Upload}
            title="Your workspace is ready"
            description="Upload your first contract or policy PDF. LegalMind AI will extract it page by page, index it for hybrid search, and make it available to the research assistant."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild><Link to="/documents"><Upload /> Upload a PDF</Link></Button>
                <Button variant="secondary" asChild><Link to="/settings">View setup status</Link></Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Query analytics</CardTitle>
                  <CardDescription>Assistant and search queries over the last 14 days</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="h-[240px]">
                {a ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={a.series} margin={{ left: -24, right: 8, top: 8 }}>
                      <defs>
                        <linearGradient id="gChat" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="var(--teal)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={tick} tickLine={false} axisLine={false} tickFormatter={(d) => formatDate(d, { day: "numeric", month: "short" })} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
                      <RTooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="chat" name="Assistant" stroke="var(--teal)" strokeWidth={2} fill="url(#gChat)" />
                      <Area type="monotone" dataKey="search" name="Search" stroke="var(--brass)" strokeWidth={2} fill="transparent" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <Skeleton className="h-full" />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Document uploads</CardTitle>
                  <CardDescription>Files added per day</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="h-[240px]">
                {a ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={a.series} margin={{ left: -24, right: 4, top: 8 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="date" tick={tick} tickLine={false} axisLine={false} tickFormatter={(d) => formatDate(d, { day: "numeric" })} minTickGap={8} />
                      <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
                      <RTooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
                      <Bar dataKey="uploads" name="Uploads" fill="var(--navy)" radius={[4, 4, 0, 0]} maxBarSize={22} className="dark:[&_path]:fill-[var(--sage)]" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Skeleton className="h-full" />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Processing overview</CardTitle>
                  <CardDescription>Ingestion pipeline status</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {s && (
                  <>
                    <div className="mb-4 flex h-2 overflow-hidden rounded-full bg-surface-2">
                      {(["ready", "processing", "pending", "failed"] as DocStatus[]).map((k) => {
                        const pct = s.total_documents ? (s.documents_by_status[k] / s.total_documents) * 100 : 0;
                        const color = { ready: "bg-teal", processing: "bg-brass", pending: "bg-line-strong", failed: "bg-risk-high" }[k];
                        return <div key={k} className={color} style={{ width: `${pct}%` }} />;
                      })}
                    </div>
                    <dl className="space-y-2.5 text-[13px]">
                      {(["ready", "processing", "pending", "failed"] as DocStatus[]).map((k) => (
                        <div key={k} className="flex items-center justify-between">
                          <dt className="text-muted">{STATUS_STYLE[k].label}</dt>
                          <dd className="font-medium tabular-nums">{s.documents_by_status[k]}</dd>
                        </div>
                      ))}
                      <div className="flex items-center justify-between border-t border-line pt-2.5">
                        <dt className="text-muted">Avg. processing time</dt>
                        <dd className="font-medium">{formatMs(s.avg_processing_ms)}</dd>
                      </div>
                    </dl>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Recent documents</CardTitle>
                  <CardDescription>Latest uploads</CardDescription>
                </div>
                <Link to="/documents" className="text-[12.5px] font-medium text-teal hover:underline">View all</Link>
              </CardHeader>
              <CardContent className="space-y-1">
                {a?.recent_documents.length === 0 && <p className="py-6 text-center text-[13px] text-muted">No documents yet</p>}
                {a?.recent_documents.map((d) => (
                  <Link key={d.id} to={`/documents?open=${d.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2"><FileText className="size-4 text-teal" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{d.filename}</div>
                      <div className="text-[11.5px] text-muted">{d.page_count} pages · {timeAgo(d.created_at)}</div>
                    </div>
                    <Badge variant={STATUS_STYLE[d.status].variant}>{STATUS_STYLE[d.status].label}</Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Recent AI activity</CardTitle>
                  <CardDescription>Queries and analyses</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {a?.recent_activity.length === 0 && <p className="py-6 text-center text-[13px] text-muted">No activity yet</p>}
                <ol className="relative space-y-3.5 border-l border-line pl-4">
                  {a?.recent_activity.map((item, i) => {
                    const Icon = item.type === "analysis" ? ShieldAlert : item.type === "search" ? FileSearch : MessageSquareText;
                    return (
                      <li key={i} className="relative">
                        <span className={cn("absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-surface", item.type === "analysis" ? "bg-brass" : "bg-teal")} />
                        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
                          <Icon className="size-3" /> {item.type === "chat" ? "Assistant" : item.type} · {timeAgo(item.created_at)}
                        </div>
                        <div className="mt-0.5 line-clamp-1 text-[13px] text-ink">{item.label}</div>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          </div>

          {a && a.recent_conversations.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Continue researching</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {a.recent_conversations.map((c) => (
                  <Link key={c.id} to={`/assistant/${c.id}`} className="group flex items-center gap-3 rounded-[10px] border border-line px-3.5 py-3 hover:border-teal/40 hover:bg-surface-2">
                    <MessagesSquare className="size-4 shrink-0 text-teal" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{c.title}</div>
                      <div className="text-[11.5px] text-muted">{timeAgo(c.last_message_at)}</div>
                    </div>
                    <ArrowRight className="size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageContainer>
  );
}
