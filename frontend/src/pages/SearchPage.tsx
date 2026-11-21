import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, FileSearch, FileText, Search, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import type { SearchHit, SearchMode } from "@/api/types";
import { useReadyDocuments } from "@/hooks/queries";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, Select, Switch, Tabs, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { DocumentPicker, usePagePreview } from "@/components/evidence";
import { cn, errorMessage, formatMs, timeAgo } from "@/lib/utils";

function highlight(text: string, query: string) {
  const terms = Array.from(new Set(query.toLowerCase().replace(/"/g, "").split(/\W+/).filter((t) => t.length > 2)));
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) =>
    re.test(part) && terms.includes(part.toLowerCase()) ? <mark key={i} className="rounded-sm bg-brass-soft px-0.5 text-ink">{part}</mark> : part,
  );
}

function ResultCard({ hit, query, rank }: { hit: SearchHit; query: string; rank: number }) {
  const preview = usePagePreview();
  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-muted">#{rank}</span>
        <FileText className="size-3.5 text-teal" />
        <span className="truncate text-[13px] font-medium">{hit.document_name}</span>
        <Badge variant="neutral" className="font-mono">page {hit.page_number}</Badge>
        <div className="ml-auto flex items-center gap-1.5">
          {hit.semantic_rank && <Badge variant="sage" title="Rank in semantic retrieval">sem #{hit.semantic_rank}</Badge>}
          {hit.keyword_rank && <Badge variant="brass" title="Rank in BM25 keyword retrieval">bm25 #{hit.keyword_rank}</Badge>}
          <Badge variant="navy" className="font-mono" title={hit.rerank_score !== null ? "Cross-encoder relevance score" : "Retrieval score"}>
            {hit.rerank_score !== null ? "rerank " : ""}{hit.score.toFixed(3)}
          </Badge>
        </div>
      </div>
      <p className="line-clamp-5 whitespace-pre-line text-[13.5px] leading-relaxed text-ink/85">{highlight(hit.text, query)}</p>
      <div className="mt-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => preview({ documentId: hit.document_id, documentName: hit.document_name, page: hit.page_number, highlight: hit.text })}>
          Open page {hit.page_number}
        </Button>
      </div>
    </Card>
  );
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const { ready: docs } = useReadyDocuments();
  const qc = useQueryClient();
  const [query, setQuery] = React.useState(params.get("q") ?? "");
  const [mode, setMode] = React.useState<SearchMode>("hybrid");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [topK, setTopK] = React.useState(10);
  const [rerank, setRerank] = React.useState(true);

  const history = useQuery({ queryKey: ["search-history"], queryFn: api.searchHistory });
  const search = useMutation({
    mutationFn: (q: string) => api.search({ query: q, mode, document_ids: selected.length ? selected : null, top_k: topK, rerank }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["search-history"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const run = (q = query) => {
    if (!q.trim()) return;
    setParams({ q: q.trim() }, { replace: true });
    search.mutate(q.trim());
  };

  const initialRun = React.useRef(false);
  React.useEffect(() => {
    if (initialRun.current) return;
    initialRun.current = true;
    const q = params.get("q");
    if (q) run(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = async () => {
    await api.clearSearchHistory();
    qc.invalidateQueries({ queryKey: ["search-history"] });
  };

  const data = search.data;

  return (
    <PageContainer>
      <PageHeader eyebrow="Retrieval lab" title="Advanced Search" description='Search across your documents with semantic, BM25 keyword or hybrid retrieval. Use "quotes" for exact phrases.' />
      <Card className="mb-5 p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
          className="flex flex-col gap-3"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='e.g. "limitation of liability" or how can the client terminate?' className="h-11 pl-10 text-[14px]" aria-label="Search query" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={mode} onValueChange={(v) => setMode(v as SearchMode)}>
              <TabsList>
                <TabsTrigger value="hybrid">Hybrid</TabsTrigger>
                <TabsTrigger value="semantic">Semantic</TabsTrigger>
                <TabsTrigger value="keyword">Keyword</TabsTrigger>
              </TabsList>
            </Tabs>
            <DocumentPicker documents={docs} selected={selected} onChange={setSelected} />
            <Select value={topK} onChange={(e) => setTopK(Number(e.target.value))} className="h-9 w-28" aria-label="Number of results">
              {[5, 10, 20, 30].map((n) => <option key={n} value={n}>Top {n}</option>)}
            </Select>
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <Switch checked={rerank} onCheckedChange={setRerank} aria-label="Cross-encoder reranking" /> Rerank
            </label>
            <Button type="submit" className="sm:ml-auto" loading={search.isPending} disabled={!query.trim()}>Search</Button>
          </div>
        </form>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-3">
          {search.isError && <ErrorState message={(search.error as Error).message} />}
          {data && (
            <div className="flex items-center justify-between text-[12.5px] text-muted">
              <span>{data.results.length} results · <span className="capitalize">{data.mode}</span>{data.reranked ? " + cross-encoder" : ""}</span>
              <span className="font-mono">{formatMs(data.latency_ms)}</span>
            </div>
          )}
          {data && data.results.length === 0 && (
            <Card><EmptyState icon={FileSearch} title="No matching passages" description={docs.length ? "Try different wording, switch retrieval mode, or widen the document filter." : "Upload and index documents first."} /></Card>
          )}
          {!data && !search.isPending && (
            <Card><EmptyState icon={FileSearch} title="Search your legal library" description="Results show the matching passage, document, page and how each retriever ranked it." /></Card>
          )}
          {data?.results.map((h, i) => <ResultCard key={h.chunk_id} hit={h} query={data.query} rank={i + 1} />)}
        </div>

        <Card className="h-fit">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold"><Clock className="size-4 text-teal" /> Search history</div>
            {!!history.data?.length && <button onClick={clear} className="text-muted hover:text-risk-high cursor-pointer" aria-label="Clear search history"><Trash2 className="size-3.5" /></button>}
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2 scroll-thin">
            {history.data?.length === 0 && <p className="px-2 py-4 text-center text-[12.5px] text-muted">No searches yet</p>}
            {history.data?.map((h) => (
              <button key={h.id} onClick={() => { setQuery(h.query); if (h.mode) setMode(h.mode); run(h.query); }} className={cn("w-full rounded-lg px-2.5 py-2 text-left hover:bg-surface-2 cursor-pointer")}>
                <div className="truncate text-[13px]">{h.query}</div>
                <div className="text-[11px] text-muted">{h.mode} · {h.result_count} results · {timeAgo(h.created_at)}</div>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
