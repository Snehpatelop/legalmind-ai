import * as React from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  ChevronsLeft,
  ChevronsRight,
  FileSearch,
  FileText,
  GitCompareArrows,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  X,
  CheckCircle2,
  AlertCircle,
  FlaskConical,
} from "lucide-react";
import { Logo } from "./Logo";
import { useAuth, useTheme } from "@/hooks/auth";
import { useDocuments } from "@/hooks/queries";
import { api } from "@/api/client";
import { cn, initials, parseDate, timeAgo } from "@/lib/utils";
import { Tooltip } from "@/components/ui/primitives";

export const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/assistant", label: "AI Research Assistant", icon: MessageSquareText },
  { to: "/documents", label: "My Documents", icon: FileText },
  { to: "/contract-analysis", label: "Contract Analysis", icon: ShieldAlert },
  { to: "/compare", label: "Document Comparison", icon: GitCompareArrows },
  { to: "/search", label: "Advanced Search", icon: FileSearch },
  { to: "/history", label: "Conversation History", icon: History },
  { to: "/evaluation", label: "RAG Evaluation", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Sidebar({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-full flex-col bg-navy text-white">
      <div className={cn("flex h-16 items-center border-b border-white/[0.06]", collapsed ? "justify-center px-2" : "px-5")}>
        <Link to="/" onClick={onNavigate} aria-label="LegalMind AI home">
          <Logo collapsed={collapsed} />
        </Link>
      </div>
      <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        {!collapsed && (
          <div className="mb-2 px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/35">Workspace</div>
        )}
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const link = (
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    "group relative flex h-9 items-center gap-3 rounded-lg text-[13.5px] font-medium transition-colors",
                    collapsed ? "justify-center px-0" : "px-3",
                    isActive ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.04] hover:text-white",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-brass" />}
                    <item.icon className={cn("size-[17px] shrink-0", isActive ? "text-sage" : "")} strokeWidth={1.8} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            );
            return <li key={item.to}>{collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link}</li>;
          })}
        </ul>
      </nav>
      {onToggle && (
        <button
          onClick={onToggle}
          className={cn(
            "mx-3 mb-2 flex h-8 items-center gap-2 rounded-lg text-[12.5px] text-white/45 hover:bg-white/[0.04] hover:text-white cursor-pointer",
            collapsed ? "justify-center" : "px-3",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
        </button>
      )}
      <div className={cn("border-t border-white/[0.06] p-3", collapsed && "flex justify-center")}>
        <div className={cn("flex items-center gap-3 rounded-lg", !collapsed && "px-2 py-1.5")}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sage text-[12px] font-semibold text-navy">
            {initials(user?.name ?? "")}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[13px] font-medium">{user?.name}</div>
                <div className="truncate text-[11.5px] text-white/45">{user?.email}</div>
              </div>
              <Tooltip content="Sign out">
                <button onClick={logout} className="rounded-md p-1.5 text-white/45 hover:bg-white/[0.06] hover:text-white cursor-pointer" aria-label="Sign out">
                  <LogOut className="size-4" />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const { data: docs } = useDocuments();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const matches = q.trim()
    ? (docs ?? []).filter((d) => d.filename.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : [];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
    setOpen(false);
    setQ("");
  };
  return (
    <form onSubmit={submit} className="relative hidden w-full max-w-sm md:block" role="search">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search documents and clauses…"
        aria-label="Global document search"
        className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-14 text-[13px] text-ink placeholder:text-muted focus:border-teal focus:bg-surface focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-surface px-1.5 font-mono text-[10px] text-muted">
        Enter
      </kbd>
      {open && q.trim() && (
        <div className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-[10px] border border-line bg-surface shadow-pop">
          {matches.map((d) => (
            <button
              type="button"
              key={d.id}
              onMouseDown={() => navigate(`/documents?open=${d.id}`)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-surface-2 cursor-pointer"
            >
              <FileText className="size-4 text-teal" />
              <span className="truncate">{d.filename}</span>
            </button>
          ))}
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 border-t border-line px-3 py-2 text-left text-[13px] text-teal hover:bg-surface-2 cursor-pointer"
          >
            <Search className="size-4" /> Search clauses for “{q.trim()}”
          </button>
        </div>
      )}
    </form>
  );
}

const SEEN_KEY = "lm-notifications-seen";

function Notifications() {
  const { data: docs } = useDocuments();
  const { data: evals } = useQuery({ queryKey: ["evaluations"], queryFn: api.evaluations, staleTime: 30_000 });
  const [seen, setSeen] = React.useState<number>(() => {
    try {
      return Number(localStorage.getItem(SEEN_KEY) || 0);
    } catch {
      return 0;
    }
  });
  const items = React.useMemo(() => {
    const out: { id: string; icon: typeof Bell; tone: string; title: string; body: string; at: string; to: string }[] = [];
    (docs ?? []).forEach((d) => {
      if (d.processing_status === "ready" && d.processed_at)
        out.push({ id: `d${d.id}`, icon: CheckCircle2, tone: "text-teal", title: "Document indexed", body: `${d.filename} · ${d.chunk_count} chunks`, at: d.processed_at, to: "/documents" });
      if (d.processing_status === "failed")
        out.push({ id: `f${d.id}`, icon: AlertCircle, tone: "text-risk-high", title: "Processing failed", body: `${d.filename}: ${d.status_message ?? ""}`, at: d.created_at, to: "/documents" });
    });
    (evals ?? []).forEach((e) => {
      if (e.status !== "running" && e.completed_at)
        out.push({ id: `e${e.id}`, icon: FlaskConical, tone: e.status === "failed" ? "text-risk-high" : "text-teal", title: e.status === "failed" ? "Evaluation failed" : "Evaluation completed", body: e.dataset_name, at: e.completed_at, to: "/evaluation" });
    });
    return out.sort((a, b) => parseDate(b.at).getTime() - parseDate(a.at).getTime()).slice(0, 8);
  }, [docs, evals]);
  const unread = items.filter((i) => parseDate(i.at).getTime() > seen).length;
  const navigate = useNavigate();

  return (
    <DropdownMenu.Root
      onOpenChange={(o) => {
        if (!o) return;
        const now = Date.now();
        setTimeout(() => {
          setSeen(now);
          try {
            localStorage.setItem(SEEN_KEY, String(now));
          } catch {
            /* ignore */
          }
        }, 1500);
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink cursor-pointer" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          <Bell className="size-[18px]" strokeWidth={1.8} />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brass ring-2 ring-surface" />}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-80 overflow-hidden rounded-[12px] border border-line bg-surface shadow-pop">
          <div className="border-b border-line px-4 py-3 text-[13px] font-semibold">Notifications</div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-muted">You're all caught up.</div>
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-thin">
              {items.map((i) => (
                <DropdownMenu.Item
                  key={i.id}
                  onSelect={() => navigate(i.to)}
                  className="flex cursor-pointer gap-3 px-4 py-3 outline-none hover:bg-surface-2 data-[highlighted]:bg-surface-2"
                >
                  <i.icon className={cn("mt-0.5 size-4 shrink-0", i.tone)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-ink">{i.title}</div>
                    <div className="truncate text-[12px] text-muted">{i.body}</div>
                  </div>
                  <div className="shrink-0 text-[11px] text-muted">{timeAgo(i.at)}</div>
                </DropdownMenu.Item>
              ))}
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const current = NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)));
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden cursor-pointer" aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-[13px] sm:flex">
        <Link to="/" className="text-muted hover:text-ink">Workspace</Link>
        <span className="text-line-strong">/</span>
        <span className="truncate font-medium text-ink">{current?.label ?? "Page"}</span>
      </nav>
      <div className="ml-auto flex flex-1 items-center justify-end gap-1.5">
        <GlobalSearch />
        <button onClick={() => navigate("/search")} className="rounded-lg p-2 text-muted hover:bg-surface-2 md:hidden cursor-pointer" aria-label="Search">
          <Search className="size-[18px]" />
        </button>
        <Tooltip content={theme === "dark" ? "Light mode" : "Dark mode"}>
          <button onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink cursor-pointer" aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="size-[18px]" strokeWidth={1.8} /> : <Moon className="size-[18px]" strokeWidth={1.8} />}
          </button>
        </Tooltip>
        <Notifications />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="ml-1 flex size-8 items-center justify-center rounded-full bg-navy text-[12px] font-semibold text-sage ring-2 ring-transparent hover:ring-sage/60 cursor-pointer dark:bg-sage dark:text-navy" aria-label="Account menu">
              {initials(user?.name ?? "")}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-56 rounded-[12px] border border-line bg-surface p-1.5 shadow-pop">
              <div className="px-2.5 py-2">
                <div className="text-[13px] font-medium">{user?.name}</div>
                <div className="truncate text-[12px] text-muted">{user?.email}</div>
              </div>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item onSelect={() => navigate("/settings")} className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-surface-2">
                <Settings className="size-4 text-muted" /> Settings
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={logout} className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-risk-high outline-none data-[highlighted]:bg-risk-high-bg">
                <LogOut className="size-4" /> Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem("lm-sidebar") === "collapsed";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const location = useLocation();
  React.useEffect(() => setMobileOpen(false), [location.pathname]);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("lm-sidebar", c ? "expanded" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });

  return (
    <div className="flex h-full">
      <aside className={cn("hidden shrink-0 transition-[width] duration-200 lg:block", collapsed ? "w-[72px]" : "w-[260px]")}>
        <div className={cn("fixed inset-y-0 left-0 transition-[width] duration-200", collapsed ? "w-[72px]" : "w-[260px]")}>
          <Sidebar collapsed={collapsed} onToggle={toggle} />
        </div>
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-pop">
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-5 rounded-md p-1 text-white/60 hover:text-white cursor-pointer" aria-label="Close navigation">
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8", className)}>{children}</div>;
}
