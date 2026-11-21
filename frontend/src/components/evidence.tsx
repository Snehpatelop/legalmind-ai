/* Shared evidence UI: citation chips, evidence cards, page preview, document picker, risk badges. */
import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileText, Loader2, Quote, type LucideIcon } from "lucide-react";
import { fetchBlob } from "@/api/client";
import type { Citation, DocumentItem, RiskLevel } from "@/api/types";
import { cn } from "@/lib/utils";
import { Badge, Checkbox, Dialog, DialogContent } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

/* ---------- Page preview (renders the real PDF page image from the backend) ---------- */
type PreviewTarget = { documentId: string; documentName: string; page: number; highlight?: string } | null;
const PreviewContext = React.createContext<(t: PreviewTarget) => void>(() => {});
export const usePagePreview = () => React.useContext(PreviewContext);

export function PagePreviewProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<PreviewTarget>(null);
  return (
    <PreviewContext.Provider value={setTarget}>
      {children}
      <PagePreviewDialog target={target} onClose={() => setTarget(null)} />
    </PreviewContext.Provider>
  );
}

function PagePreviewDialog({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  const [page, setPage] = React.useState(1);
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    if (target) setPage(target.page);
  }, [target]);
  React.useEffect(() => {
    if (!target) return;
    let revoked: string | null = null;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBlob(`/api/documents/${target.documentId}/pages/${page}/image?zoom=1.6`)
      .then((b) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(b);
        setUrl(revoked);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [target, page]);

  const openPdf = async () => {
    if (!target) return;
    const blob = await fetchBlob(`/api/documents/${target.documentId}/file`);
    const u = URL.createObjectURL(blob);
    window.open(`${u}#page=${page}`, "_blank", "noopener");
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      {target && (
        <DialogContent title={target.documentName} description={`Page ${page}`} className="max-w-3xl">
          {target.highlight && (
            <div className="mb-3 rounded-[10px] border border-brass/30 bg-brass-soft px-3 py-2 text-[12.5px] leading-relaxed text-[#6d5230] dark:text-brass">
              <span className="font-semibold">Cited passage: </span>
              {target.highlight.length > 320 ? target.highlight.slice(0, 320) + "…" : target.highlight}
            </div>
          )}
          <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden rounded-[10px] border border-line bg-surface-2">
            {loading && <Loader2 className="absolute size-6 animate-spin text-teal" />}
            {error && <p className="px-6 text-center text-sm text-risk-high">{error}</p>}
            {url && !error && <img src={url} alt={`Page ${page} of ${target.documentName}`} className={cn("max-h-[65vh] w-auto bg-white", loading && "opacity-40")} />}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                <ChevronLeft /> Prev
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)} disabled={!!error}>
                Next <ChevronRight />
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={openPdf}>
              <ExternalLink /> Open full PDF
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

/* ---------- Citation chips & evidence cards ---------- */
export function CitationChip({ c, onClick, active }: { c: Citation; onClick?: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors cursor-pointer",
        active ? "border-teal bg-sage-soft text-teal" : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
      )}
      title={`${c.document_name}, page ${c.page_number}`}
    >
      <span className="font-mono text-[10.5px] text-brass">S{c.source_id}</span>
      <span className="max-w-[160px] truncate">{c.document_name.replace(/\.pdf$/i, "")}</span>
      <span className="text-muted">p.{c.page_number}</span>
    </button>
  );
}

export function EvidenceCard({ c, defaultOpen = false }: { c: Citation; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const preview = usePagePreview();
  return (
    <div className="rounded-[10px] border border-line bg-surface" id={`evidence-${c.chunk_id}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left cursor-pointer" aria-expanded={open}>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brass-soft font-mono text-[10.5px] font-semibold text-[#8a6a3f] dark:text-brass">
          S{c.source_id}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-ink">{c.document_name}</div>
          <div className="font-mono text-[10.5px] text-muted">
            page {c.page_number}
            {typeof c.score === "number" && <> · relevance {c.score.toFixed(2)}</>}
          </div>
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line px-3 pb-3 pt-2.5">
          <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-ink/85">{c.text}</p>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted" title="Chunk identifier">
              {c.chunk_id.slice(0, 8)}
            </span>
            {c.document_id && (
              <button
                onClick={() => preview({ documentId: c.document_id!, documentName: c.document_name, page: c.page_number, highlight: c.text })}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-teal hover:underline cursor-pointer"
              >
                <FileText className="size-3.5" /> View page {c.page_number}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact inline page references for structured analysis items. */
export function PageRefs({ citations, documentId }: { citations: Citation[]; documentId?: string }) {
  const preview = usePagePreview();
  if (!citations?.length) return null;
  const seen = new Set<number>();
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {citations
        .filter((c) => (seen.has(c.page_number) ? false : (seen.add(c.page_number), true)))
        .map((c) => (
          <button
            key={c.chunk_id}
            onClick={() =>
              (c.document_id || documentId) &&
              preview({ documentId: (c.document_id || documentId)!, documentName: c.document_name, page: c.page_number, highlight: c.text })
            }
            className="rounded border border-line bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-muted hover:border-teal hover:text-teal cursor-pointer"
            title={c.text.slice(0, 200)}
          >
            p.{c.page_number}
          </button>
        ))}
    </span>
  );
}

export function QuoteBlock({ text }: { text: string }) {
  return (
    <div className="relative rounded-[10px] border-l-2 border-brass bg-surface-2 py-2.5 pl-4 pr-3">
      <Quote className="absolute right-3 top-2.5 size-3.5 text-brass/50" />
      <p className="pr-5 text-[13px] italic leading-relaxed text-ink/85">{text}</p>
    </div>
  );
}

/* ---------- Risk ---------- */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const v = level === "HIGH" ? "high" : level === "MEDIUM" ? "medium" : "low";
  return (
    <Badge variant={v} className="font-semibold tracking-wide">
      <span className={cn("size-1.5 rounded-full", level === "HIGH" ? "bg-risk-high" : level === "MEDIUM" ? "bg-risk-med" : "bg-risk-low")} />
      {level}
    </Badge>
  );
}

/* ---------- Document picker ---------- */
export function DocumentPicker({
  documents,
  selected,
  onChange,
  emptyLabel = "All documents",
}: {
  documents: DocumentItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const label =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? documents.find((d) => d.id === selected[0])?.filename ?? "1 document"
        : `${selected.length} documents`;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink hover:border-line-strong cursor-pointer sm:w-auto sm:max-w-[280px]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <FileText className="size-4 shrink-0 text-teal" />
        <span className="truncate">{label}</span>
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1.5 w-[300px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[10px] border border-line bg-surface shadow-pop" role="listbox">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] text-muted">
            <span>Scope retrieval to</span>
            {selected.length > 0 && (
              <button onClick={() => onChange([])} className="font-medium text-teal hover:underline cursor-pointer">
                Clear
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto py-1 scroll-thin">
            {documents.length === 0 && <div className="px-3 py-4 text-center text-[12.5px] text-muted">No indexed documents yet</div>}
            {documents.map((d) => {
              const checked = selected.includes(d.id);
              return (
                <label key={d.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-surface-2">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => onChange(checked ? selected.filter((x) => x !== d.id) : [...selected, d.id])}
                  />
                  <span className="truncate">{d.filename}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-[12px] border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        <Icon className="size-4 text-teal" strokeWidth={1.8} />
      </div>
      <div className="mt-3 font-display text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-2 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}
