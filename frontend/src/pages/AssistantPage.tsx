import * as React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  ArrowUp,
  BookOpenCheck,
  Check,
  Copy,
  FileText,
  Info,
  Plus,
  RotateCcw,
  Scale,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { api, streamChat } from "@/api/client";
import type { Citation, Message } from "@/api/types";
import { useReadyDocuments, useSystemStatus } from "@/hooks/queries";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice, Skeleton, Textarea, Tooltip } from "@/components/ui/primitives";
import { CitationChip, DocumentPicker, EvidenceCard, usePagePreview } from "@/components/evidence";
import { cn, errorMessage, formatMs, timeAgo } from "@/lib/utils";

const SUGGESTIONS = [
  "What are the termination conditions in this agreement?",
  "Summarise the payment terms and late payment consequences.",
  "Is there a limitation of liability, and what is the cap?",
  "How long do confidentiality obligations last?",
  "How are disputes resolved and which law applies?",
  "What are the renewal and notice requirements?",
];

type UiMessage = Message & { streaming?: boolean; pendingSources?: Citation[] };

/** Render [S1] markers as interactive superscript chips. */
function useCitationMarkdown(citations: Citation[] | null | undefined, onCite: (c: Citation) => void) {
  return React.useMemo(() => {
    const byId = new Map((citations ?? []).map((c) => [c.source_id, c]));
    const renderText = (text: string) => {
      const parts = text.split(/(\[S\d+\])/g);
      return parts.map((p, i) => {
        const m = /^\[S(\d+)\]$/.exec(p);
        if (!m) return p;
        const c = byId.get(Number(m[1]));
        if (!c) return <sup key={i} className="font-mono text-[10px] text-muted">[S{m[1]}]</sup>;
        return (
          <button
            key={i}
            onClick={() => onCite(c)}
            className="mx-0.5 inline-flex -translate-y-[1px] items-center rounded border border-brass/40 bg-brass-soft px-1 font-mono text-[10px] font-semibold leading-[16px] text-[#8a6a3f] hover:border-brass dark:text-brass cursor-pointer"
            title={`${c.document_name}, page ${c.page_number}`}
          >
            S{m[1]}
          </button>
        );
      });
    };
    const walk = (children: React.ReactNode): React.ReactNode =>
      React.Children.map(children, (ch) => (typeof ch === "string" ? renderText(ch) : ch));
    return {
      p: ({ children }: any) => <p>{walk(children)}</p>,
      li: ({ children }: any) => <li>{walk(children)}</li>,
      td: ({ children }: any) => <td>{walk(children)}</td>,
      strong: ({ children }: any) => <strong>{walk(children)}</strong>,
    };
  }, [citations, onCite]);
}

function AssistantMessage({
  msg,
  isLast,
  onRegenerate,
  busy,
}: {
  msg: UiMessage;
  isLast: boolean;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const [showEvidence, setShowEvidence] = React.useState(false);
  const preview = usePagePreview();
  const citations = msg.citations ?? [];
  const onCite = React.useCallback(
    (c: Citation) => c.document_id && preview({ documentId: c.document_id, documentName: c.document_name, page: c.page_number, highlight: c.text }),
    [preview],
  );
  const components = useCitationMarkdown(citations, onCite);
  const meta = msg.meta;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <div className="group flex gap-3 sm:gap-4">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-navy dark:bg-surface-2">
        <Scale className="size-4 text-brass" strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] text-muted">
          <span className="font-semibold text-ink">LegalMind AI</span>
          {msg.streaming ? (
            <span>composing grounded answer…</span>
          ) : (
            meta?.total_ms !== undefined && <span className="font-mono text-[11px]">{formatMs(meta.total_ms)}</span>
          )}
        </div>
        {meta?.llm_error && (
          <Notice tone="brass" icon={Info} className="mb-3">
            Showing retrieved evidence only. <Link to="/settings" className="font-medium underline">Check setup</Link>
          </Notice>
        )}
        <div className="prose-legal">
          {msg.content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {msg.content}
            </ReactMarkdown>
          ) : (
            <div className="flex gap-1 py-2">
              <span className="typing-dot size-1.5 rounded-full bg-teal" />
              <span className="typing-dot size-1.5 rounded-full bg-teal" />
              <span className="typing-dot size-1.5 rounded-full bg-teal" />
            </div>
          )}
        </div>

        {!msg.streaming && citations.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <BookOpenCheck className="size-3.5 text-teal" />
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                {meta?.llm_error ? "Retrieved evidence" : "Sources cited"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {citations.map((c) => (
                <CitationChip key={c.chunk_id} c={c} onClick={() => onCite(c)} />
              ))}
              <button onClick={() => setShowEvidence((s) => !s)} className="px-1 text-[12px] font-medium text-teal hover:underline cursor-pointer">
                {showEvidence ? "Hide passages" : "Show supporting passages"}
              </button>
            </div>
            {showEvidence && (
              <div className="mt-3 grid gap-2">
                {citations.map((c) => (
                  <EvidenceCard key={c.chunk_id} c={c} defaultOpen={citations.length <= 2} />
                ))}
              </div>
            )}
          </div>
        )}

        {!msg.streaming && (
          <div className="mt-3 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
            <Tooltip content={copied ? "Copied" : "Copy response"}>
              <Button variant="ghost" size="iconSm" onClick={copy} aria-label="Copy response">
                {copied ? <Check /> : <Copy />}
              </Button>
            </Tooltip>
            {isLast && (
              <Tooltip content="Regenerate response">
                <Button variant="ghost" size="iconSm" onClick={onRegenerate} disabled={busy} aria-label="Regenerate response">
                  <RotateCcw />
                </Button>
              </Tooltip>
            )}
            {meta?.rewritten_query && meta.rewrite_method !== "none" && (
              <span className="ml-1 truncate text-[11.5px] text-muted" title={meta.rewritten_query}>
                Searched for: “{meta.rewritten_query}”
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationRail({ activeId, onNew }: { activeId?: string; onNew: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const convs = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });
  const remove = async (id: string) => {
    try {
      await api.deleteConversation(id);
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (id === activeId) navigate("/assistant");
      toast.success("Conversation deleted");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-line bg-surface xl:flex">
      <div className="p-3">
        <Button variant="secondary" className="w-full justify-start" onClick={onNew}>
          <Plus /> New conversation
        </Button>
      </div>
      <div className="px-4 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Recent</div>
      <div className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {convs.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="mx-1 h-10" />)}
        {convs.data?.length === 0 && <p className="px-3 py-4 text-[12.5px] text-muted">No conversations yet.</p>}
        {convs.data?.map((c) => (
          <div key={c.id} className={cn("group flex items-center rounded-lg", c.id === activeId ? "bg-surface-2" : "hover:bg-surface-2/70")}>
            <Link to={`/assistant/${c.id}`} className="min-w-0 flex-1 px-3 py-2">
              <div className={cn("truncate text-[13px]", c.id === activeId ? "font-medium text-ink" : "text-ink/80")}>{c.title}</div>
              <div className="text-[11px] text-muted">{timeAgo(c.updated_at)}</div>
            </Link>
            <button onClick={() => remove(c.id)} className="mr-1.5 rounded p-1 text-muted opacity-0 hover:text-risk-high group-hover:opacity-100 cursor-pointer" aria-label={`Delete ${c.title}`}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

export default function AssistantPage() {
  const { conversationId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { ready: docs } = useReadyDocuments();
  const status = useSystemStatus();
  const [selected, setSelected] = React.useState<string[]>(() => (params.get("doc") ? [params.get("doc")!] : []));
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const skipLoadRef = React.useRef<string | null>(null);

  const conv = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api.conversation(conversationId!),
    enabled: !!conversationId,
  });

  React.useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    if (skipLoadRef.current === conversationId) return;
    if (conv.data) {
      setMessages(conv.data.messages);
      if (conv.data.document_ids) setSelected(conv.data.document_ids);
    }
  }, [conversationId, conv.data]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (question: string, regenerate = false) => {
    if (busy || (!question.trim() && !regenerate)) return;
    setBusy(true);
    const now = new Date().toISOString();
    const tempId = `tmp-${Date.now()}`;
    setMessages((m) => {
      let base = m;
      if (regenerate) {
        const lastUser = [...m].reverse().findIndex((x) => x.role === "user");
        base = lastUser === -1 ? m : m.slice(0, m.length - lastUser);
      } else {
        base = [...m, { id: `u-${tempId}`, role: "user", content: question.trim(), citations: null, meta: null, created_at: now }];
      }
      return [...base, { id: tempId, role: "assistant", content: "", citations: null, meta: null, created_at: now, streaming: true }];
    });
    setInput("");
    const controller = new AbortController();
    abortRef.current = controller;
    let convId = conversationId ?? null;
    try {
      await streamChat(
        { question: question.trim() || "regenerate", conversation_id: convId, document_ids: selected.length ? selected : null, regenerate },
        (e) => {
          if (e.type === "meta") {
            if (!convId) {
              convId = e.conversation_id;
              skipLoadRef.current = e.conversation_id;
              navigate(`/assistant/${e.conversation_id}`, { replace: true });
            }
          } else if (e.type === "token") {
            setMessages((m) => m.map((x) => (x.id === tempId ? { ...x, content: x.content + e.text } : x)));
          } else if (e.type === "final") {
            setMessages((m) => m.map((x) => (x.id === tempId ? { ...e.message } : x)));
          } else if (e.type === "error") {
            toast.error(e.detail);
          }
        },
        controller.signal,
      );
    } catch (e) {
      toast.error(errorMessage(e));
      setMessages((m) => m.filter((x) => x.id !== tempId));
    } finally {
      setBusy(false);
      abortRef.current = null;
      setMessages((m) => m.map((x) => (x.id === tempId ? { ...x, streaming: false } : x)));
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      if (convId) {
        skipLoadRef.current = convId;
        qc.invalidateQueries({ queryKey: ["conversation", convId] });
      }
    }
  };

  const newConversation = () => {
    abortRef.current?.abort();
    skipLoadRef.current = null;
    setMessages([]);
    navigate("/assistant");
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <ConversationRail activeId={conversationId} onNew={newConversation} />
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5 sm:px-6">
          <DocumentPicker documents={docs} selected={selected} onChange={setSelected} emptyLabel="All ready documents" />
          <span className="hidden text-[12px] text-muted sm:inline">
            Hybrid retrieval · RRF · cross-encoder rerank
          </span>
          <Button variant="ghost" size="sm" className="ml-auto xl:hidden" onClick={newConversation}>
            <Plus /> New
          </Button>
        </div>

        <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[820px] px-4 py-8 sm:px-6">
            {status.data && !status.data.gemini_configured && (
              <Notice tone="brass" icon={Info} className="mb-6">
                Gemini is not configured, so answers will show retrieved evidence only. Add <code className="font-mono">GEMINI_API_KEY</code> to
                your <code className="font-mono">.env</code> and restart the backend to enable AI answers.
              </Notice>
            )}
            {conversationId && conv.isLoading && messages.length === 0 ? (
              <div className="space-y-4"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-32" /></div>
            ) : messages.length === 0 ? (
              docs.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Upload a document to start researching"
                  description="The assistant only answers from your indexed documents, with page-level citations for every factual claim."
                  action={<Button asChild><Link to="/documents">Go to My Documents</Link></Button>}
                />
              ) : (
                <div className="pt-6 sm:pt-12">
                  <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-navy dark:bg-surface-2">
                      <Sparkles className="size-5 text-brass" strokeWidth={1.8} />
                    </div>
                    <h1 className="font-display text-xl font-semibold text-ink">What would you like to research?</h1>
                    <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-muted">
                      Ask in plain language. Answers are grounded in {selected.length ? `${selected.length} selected` : docs.length} document
                      {(selected.length || docs.length) === 1 ? "" : "s"} and cite the exact page.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="rounded-[10px] border border-line bg-surface px-4 py-3 text-left text-[13px] text-ink/85 transition-colors hover:border-teal/40 hover:bg-surface-2 cursor-pointer"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-8">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-[12px] rounded-tr-sm bg-navy px-4 py-2.5 text-[14px] leading-relaxed text-white dark:bg-surface-2 dark:text-ink">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <AssistantMessage key={m.id} msg={m} isLast={m.id === lastAssistant?.id} busy={busy} onRegenerate={() => send("", true)} />
                  ),
                )}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-line bg-surface px-4 py-3 sm:px-6">
          <form
            className="mx-auto flex w-full max-w-[820px] items-end gap-2 rounded-[12px] border border-line bg-surface-2 p-2 focus-within:border-teal focus-within:ring-2 focus-within:ring-[var(--ring)]"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Ask about clauses, obligations, dates, risks…"
              aria-label="Ask a question"
              className="max-h-40 min-h-[40px] resize-none border-0 bg-transparent focus:ring-0"
              disabled={docs.length === 0}
            />
            {busy ? (
              <Button type="button" size="icon" variant="navy" onClick={() => abortRef.current?.abort()} aria-label="Stop generating">
                <Square className="!size-3.5" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim() || docs.length === 0} aria-label="Send question">
                <ArrowUp />
              </Button>
            )}
          </form>
          <p className="mx-auto mt-2 max-w-[820px] text-center text-[11px] text-muted">
            LegalMind AI provides informational assistance grounded in your documents and is not a substitute for professional legal advice.
          </p>
        </div>
      </section>
    </div>
  );
}
