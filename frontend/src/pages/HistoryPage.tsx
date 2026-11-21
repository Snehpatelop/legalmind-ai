import * as React from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, MessagesSquare, Plus, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import type { Conversation } from "@/api/types";
import { PageContainer } from "@/components/layout/AppShell";
import { Card, Dialog, DialogContent, EmptyState, ErrorState, Input, PageHeader, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { errorMessage, formatDateTime, parseDate, timeAgo } from "@/lib/utils";

function groupLabel(d: string) {
  const days = (Date.now() - parseDate(d).getTime()) / 86400000;
  if (days < 1) return "Today";
  if (days < 7) return "This week";
  if (days < 31) return "This month";
  return "Older";
}

export default function HistoryPage() {
  const qc = useQueryClient();
  const convs = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });
  const [q, setQ] = React.useState("");
  const [confirm, setConfirm] = React.useState<Conversation | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.deleteConversation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("Conversation deleted");
      setConfirm(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = (convs.data ?? []).filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  const groups = list.reduce<Record<string, Conversation[]>>((acc, c) => {
    (acc[groupLabel(c.updated_at)] ||= []).push(c);
    return acc;
  }, {});

  return (
    <PageContainer className="max-w-[960px]">
      <PageHeader
        eyebrow="Archive"
        title="Conversation History"
        description="Every research conversation is saved with its messages and citations."
        actions={<Button asChild><Link to="/assistant"><Plus /> New conversation</Link></Button>}
      />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter conversations…" className="mb-5" aria-label="Filter conversations" />
      {convs.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : convs.isError ? (
        <ErrorState message={(convs.error as Error).message} onRetry={() => convs.refetch()} />
      ) : list.length === 0 ? (
        <Card><EmptyState icon={History} title={q ? "No matches" : "No conversations yet"} description="Questions you ask the AI Research Assistant appear here." /></Card>
      ) : (
        <div className="space-y-6">
          {["Today", "This week", "This month", "Older"].filter((g) => groups[g]).map((g) => (
            <section key={g}>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{g}</h2>
              <Card className="divide-y divide-line">
                {groups[g].map((c) => (
                  <div key={c.id} className="group flex items-center gap-4 px-5 py-3.5 hover:bg-surface-2/60">
                    <MessagesSquare className="size-4 shrink-0 text-teal" />
                    <Link to={`/assistant/${c.id}`} className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-ink">{c.title}</div>
                      <div className="text-[12px] text-muted">{c.message_count} messages · started {formatDateTime(c.created_at)}</div>
                    </Link>
                    <span className="hidden text-[12px] text-muted sm:block">{timeAgo(c.updated_at)}</span>
                    <Button variant="ghost" size="iconSm" aria-label={`Delete ${c.title}`} onClick={() => setConfirm(c)} className="hover:text-risk-high">
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        {confirm && (
          <DialogContent title="Delete conversation?" description={`“${confirm.title}” and all its messages will be permanently deleted.`}>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="danger" loading={del.isPending} onClick={() => del.mutate(confirm.id)}><Trash2 /> Delete</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </PageContainer>
  );
}
