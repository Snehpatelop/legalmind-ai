import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { api, uploadDocuments } from "@/api/client";
import type { DocumentItem, DocStatus } from "@/api/types";
import { useDocuments, useSystemStatus } from "@/hooks/queries";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Card, Dialog, DialogContent, EmptyState, ErrorState, Input, Notice, PageHeader, Progress, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { usePagePreview } from "@/components/evidence";
import { cn, errorMessage, formatBytes, formatDate, formatMs } from "@/lib/utils";

const STATUS: Record<DocStatus, { label: string; variant: "sage" | "brass" | "neutral" | "high"; icon: typeof CheckCircle2 }> = {
  ready: { label: "Ready", variant: "sage", icon: CheckCircle2 },
  processing: { label: "Processing", variant: "brass", icon: Loader2 },
  pending: { label: "Queued", variant: "neutral", icon: Loader2 },
  failed: { label: "Failed", variant: "high", icon: AlertTriangle },
};

function StatusBadge({ doc }: { doc: DocumentItem }) {
  const s = STATUS[doc.processing_status];
  const spinning = doc.processing_status === "processing" || doc.processing_status === "pending";
  return (
    <Badge variant={s.variant} title={doc.status_message ?? undefined}>
      <s.icon className={cn(spinning && "animate-spin")} /> {s.label}
    </Badge>
  );
}

function UploadZone({ maxMb }: { maxMb: number }) {
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [names, setNames] = React.useState<string[]>([]);

  const handle = async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    const invalid = files.filter((f) => !f.name.toLowerCase().endsWith(".pdf"));
    const tooBig = files.filter((f) => f.size > maxMb * 1024 * 1024);
    invalid.forEach((f) => toast.error(`${f.name}: only PDF files are supported`));
    tooBig.forEach((f) => toast.error(`${f.name}: exceeds the ${maxMb} MB limit`));
    const ok = files.filter((f) => !invalid.includes(f) && !tooBig.includes(f));
    if (!ok.length) return;
    setNames(ok.map((f) => f.name));
    setProgress(0);
    try {
      const res = await uploadDocuments(ok, setProgress);
      if (res.uploaded.length) toast.success(`${res.uploaded.length} document${res.uploaded.length > 1 ? "s" : ""} uploaded`, { description: "Processing has started in the background." });
      res.rejected.forEach((r) => toast.error(r.filename, { description: r.reason }));
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setProgress(null);
      setNames([]);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handle(e.dataTransfer.files);
      }}
      className={cn(
        "relative rounded-[12px] border border-dashed bg-surface px-6 py-8 text-center transition-colors",
        drag ? "border-teal bg-sage-soft" : "border-line-strong",
      )}
      data-testid="upload-zone"
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="sr-only"
        id="file-input"
        aria-label="Choose PDF files"
        onChange={(e) => e.target.files && handle(e.target.files)}
      />
      {progress === null ? (
        <>
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl border border-line bg-surface-2">
            <UploadCloud className="size-5 text-teal" strokeWidth={1.8} />
          </div>
          <p className="text-[14px] font-medium text-ink">
            Drag and drop PDFs here, or{" "}
            <label htmlFor="file-input" className="cursor-pointer text-teal hover:underline">browse files</label>
          </p>
          <p className="mt-1 text-[12.5px] text-muted">Contracts, policies, terms, guidelines · PDF up to {maxMb} MB each · multiple files supported</p>
        </>
      ) : (
        <div className="mx-auto max-w-sm">
          <p className="mb-1 text-[13px] font-medium text-ink">Uploading {names.length} file{names.length > 1 ? "s" : ""}…</p>
          <p className="mb-3 truncate text-[12px] text-muted">{names.join(", ")}</p>
          <Progress value={progress} />
          <p className="mt-2 font-mono text-[11px] text-muted">{progress}%</p>
        </div>
      )}
    </div>
  );
}

function DocumentDetail({ doc, onClose }: { doc: DocumentItem | null; onClose: () => void }) {
  const preview = usePagePreview();
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      {doc && (
        <DialogContent title={doc.filename} description="Document details and indexing metadata">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            {[
              ["Status", <StatusBadge key="s" doc={doc} />],
              ["Pages", doc.page_count],
              ["Chunks indexed", doc.chunk_count],
              ["File size", formatBytes(doc.file_size)],
              ["OCR pages", doc.ocr_pages],
              ["Processing time", formatMs(doc.processing_ms)],
              ["Uploaded", formatDate(doc.created_at)],
              ["Document ID", <span key="id" className="font-mono text-[11px]">{doc.id.slice(0, 13)}…</span>],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="mt-0.5 font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {doc.status_message && (
            <Notice tone={doc.processing_status === "failed" ? "high" : "brass"} icon={AlertTriangle} className="mt-4">
              {doc.status_message}
            </Notice>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => preview({ documentId: doc.id, documentName: doc.filename, page: 1 })}>
              <Eye /> Preview pages
            </Button>
            {doc.processing_status === "ready" && (
              <>
                <Button variant="secondary" size="sm" asChild>
                  <Link to={`/assistant?doc=${doc.id}`}><MessageSquareText /> Ask about it</Link>
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <Link to={`/contract-analysis?doc=${doc.id}`}><ShieldAlert /> Analyse risk</Link>
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

export default function DocumentsPage() {
  const docs = useDocuments();
  const status = useSystemStatus();
  const qc = useQueryClient();
  const preview = usePagePreview();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = React.useState("");
  const [confirm, setConfirm] = React.useState<DocumentItem | null>(null);
  const openId = params.get("open");
  const detail = docs.data?.find((d) => d.id === openId) ?? null;

  const del = useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => {
      toast.success("Document deleted");
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      setConfirm(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reindex = useMutation({
    mutationFn: (id: string) => api.reindexDocument(id),
    onSuccess: () => {
      toast.success("Re-indexing started");
      qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = (docs.data ?? []).filter((d) => d.filename.toLowerCase().includes(filter.toLowerCase()));

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Library"
        title="My Documents"
        description="Upload agreements, policies and guidelines. Each PDF is extracted page by page, chunked, embedded and indexed for hybrid retrieval."
      />
      <UploadZone maxMb={status.data?.max_upload_mb ?? 25} />
      {status.data && !status.data.ocr_available && (
        <Notice tone="brass" icon={ScanLine} className="mt-3">
          OCR is not available on this machine, so scanned (image-only) pages are skipped. Install Tesseract or run with Docker to enable OCR.
        </Notice>
      )}

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-[15px] font-semibold">Library</h3>
            <p className="text-[12.5px] text-muted">{docs.data?.length ?? 0} documents</p>
          </div>
          <Input placeholder="Filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 sm:w-64" aria-label="Filter documents" />
        </div>
        {docs.isLoading ? (
          <div className="space-y-2 p-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : docs.isError ? (
          <div className="p-5"><ErrorState message={(docs.error as Error).message} onRetry={() => docs.refetch()} /></div>
        ) : list.length === 0 ? (
          <EmptyState icon={FileText} title={filter ? "No matching documents" : "No documents yet"} description={filter ? "Try a different name." : "Upload a PDF above to build your research library."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="px-5 py-2.5 font-medium">Document</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Pages</th>
                  <th className="px-3 py-2.5 font-medium">Chunks</th>
                  <th className="px-3 py-2.5 font-medium">Size</th>
                  <th className="px-3 py-2.5 font-medium">Uploaded</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                    <td className="max-w-[320px] px-5 py-3">
                      <button onClick={() => setParams({ open: d.id })} className="flex min-w-0 items-center gap-3 text-left cursor-pointer">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-line">
                          <FileText className="size-4 text-teal" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink hover:text-teal">{d.filename}</div>
                          {d.processing_status !== "ready" && d.status_message && (
                            <div className={cn("truncate text-[11.5px]", d.processing_status === "failed" ? "text-risk-high" : "text-muted")}>{d.status_message}</div>
                          )}
                        </div>
                      </button>
                    </td>
                    <td className="px-3 py-3"><StatusBadge doc={d} /></td>
                    <td className="px-3 py-3 tabular-nums text-muted">{d.page_count || "—"}</td>
                    <td className="px-3 py-3 tabular-nums text-muted">{d.chunk_count || "—"}</td>
                    <td className="px-3 py-3 tabular-nums text-muted">{formatBytes(d.file_size)}</td>
                    <td className="px-3 py-3 text-muted">{formatDate(d.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="iconSm" aria-label={`Preview ${d.filename}`} onClick={() => preview({ documentId: d.id, documentName: d.filename, page: 1 })}>
                          <Eye />
                        </Button>
                        <Button variant="ghost" size="iconSm" aria-label={`Re-index ${d.filename}`} disabled={d.processing_status === "processing" || d.processing_status === "pending"} onClick={() => reindex.mutate(d.id)}>
                          <RefreshCw />
                        </Button>
                        <Button variant="ghost" size="iconSm" aria-label={`Delete ${d.filename}`} className="hover:text-risk-high" onClick={() => setConfirm(d)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DocumentDetail doc={detail} onClose={() => setParams({})} />

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        {confirm && (
          <DialogContent title="Delete document?" description={`“${confirm.filename}” and its search index, embeddings and analyses will be permanently removed.`}>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="danger" loading={del.isPending} onClick={() => del.mutate(confirm.id)}>
                <Trash2 /> Delete
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </PageContainer>
  );
}
