import { CheckCircle2, Cpu, Database, KeyRound, LogOut, Moon, ScanLine, Server, Sun, User, XCircle } from "lucide-react";
import { useAuth, useTheme } from "@/hooks/auth";
import { useSystemStatus } from "@/hooks/queries";
import { PageContainer } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Notice, PageHeader, Skeleton, Switch } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatDate, initials } from "@/lib/utils";

function Row({ label, value, ok }: { label: string; value: React.ReactNode; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-0">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="flex items-center gap-1.5 text-right text-[13px] font-medium text-ink">
        {ok === true && <CheckCircle2 className="size-4 text-teal" />}
        {ok === false && <XCircle className="size-4 text-risk-high" />}
        {value}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const status = useSystemStatus();
  const s = status.data;
  return (
    <PageContainer className="max-w-[960px]">
      <PageHeader eyebrow="Workspace" title="Settings" description="Your profile, appearance and the live configuration of the RAG engine." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><div><CardTitle className="flex items-center gap-2"><User className="size-4 text-teal" /> Profile</CardTitle></div></CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-full bg-navy font-semibold text-sage dark:bg-sage dark:text-navy">{initials(user?.name ?? "")}</div>
              <div><div className="font-medium">{user?.name}</div><div className="text-[13px] text-muted">{user?.email}</div></div>
            </div>
            <Row label="Member since" value={user ? formatDate(user.created_at) : "—"} />
            <Row label="Data isolation" value="Per-user (enforced server-side)" ok />
            <Button variant="outlineDanger" size="sm" className="mt-4" onClick={logout}><LogOut /> Sign out</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div><CardTitle className="flex items-center gap-2">{theme === "dark" ? <Moon className="size-4 text-teal" /> : <Sun className="size-4 text-teal" />} Appearance</CardTitle><CardDescription>Stored in this browser</CardDescription></div></CardHeader>
          <CardContent>
            <label className="flex items-center justify-between py-2">
              <span className="text-[13.5px]">Dark mode</span>
              <Switch checked={theme === "dark"} onCheckedChange={toggle} aria-label="Dark mode" />
            </label>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader><div><CardTitle className="flex items-center gap-2"><Server className="size-4 text-teal" /> System status</CardTitle><CardDescription>Read from the backend. Change values in the <code className="font-mono">.env</code> file and restart.</CardDescription></div></CardHeader>
          <CardContent>
            {status.isLoading ? <Skeleton className="h-48" /> : status.isError ? <ErrorState message={(status.error as Error).message} onRetry={() => status.refetch()} /> : s && (
              <>
                {!s.gemini_configured && (
                  <Notice tone="brass" icon={KeyRound} className="mb-4">
                    Gemini is not configured. Retrieval and search work, but AI answers, analysis and evaluation need a key. Get a free key at aistudio.google.com/apikey, set <code className="font-mono">GEMINI_API_KEY</code> in <code className="font-mono">.env</code>, and restart.
                  </Notice>
                )}
                <div className="grid gap-x-10 md:grid-cols-2">
                  <div>
                    <div className="mb-1 mt-2 flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted"><KeyRound className="size-3.5" /> Generation</div>
                    <Row label="Gemini API" value={s.gemini_configured ? "Configured" : "Not configured"} ok={s.gemini_configured} />
                    <Row label="Model" value={<span className="font-mono text-[12px]">{s.gemini_model}</span>} />
                    <div className="mb-1 mt-4 flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted"><Cpu className="size-3.5" /> Models</div>
                    <Row label="Embeddings" value={<span className="font-mono text-[12px]">{s.embedding_model}</span>} />
                    <Row label="Reranker" value={<span className="font-mono text-[12px]">{s.reranker_enabled ? s.reranker_model : "disabled"}</span>} ok={s.reranker_enabled} />
                    <Row label="OCR (Tesseract)" value={s.ocr_available ? "Available" : "Unavailable"} ok={s.ocr_available} />
                  </div>
                  <div>
                    <div className="mb-1 mt-2 flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted"><Database className="size-3.5" /> Storage</div>
                    <Row label="Database" value={s.database === "postgresql" ? "PostgreSQL" : "SQLite (local mode)"} ok />
                    <Row label="Vector store" value={s.vector_store === "qdrant-server" ? "Qdrant server" : "Qdrant embedded"} ok={s.qdrant_healthy} />
                    <div className="mb-1 mt-4 flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted"><ScanLine className="size-3.5" /> Retrieval</div>
                    <Row label="Chunk size / overlap" value={<span className="font-mono text-[12px]">{s.chunk_size} / {s.chunk_overlap}</span>} />
                    <Row label="Candidates (top-K) → reranked" value={<span className="font-mono text-[12px]">{s.retrieval_top_k} → {s.rerank_top_n}</span>} />
                    <Row label="RRF k" value={<span className="font-mono text-[12px]">{s.rrf_k}</span>} />
                    <Row label="Max upload" value={`${s.max_upload_mb} MB`} />
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
