import { cn } from "@/lib/utils";

/** LegalMind AI mark: a balance scale whose beam doubles as a neural node line. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1D2B40" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="#C69B65" strokeOpacity="0.35" />
      <path d="M16 7.5v16.5M10 11.5h12" stroke="#C69B65" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16" cy="7.5" r="1.6" fill="#B9D9CC" />
      <path d="M10 11.5 7.2 17.6h5.6zM22 11.5l-2.8 6.1h5.6z" fill="none" stroke="#B9D9CC" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M7.2 17.6a2.8 2.2 0 0 0 5.6 0M19.2 17.6a2.8 2.2 0 0 0 5.6 0" fill="#B9D9CC" fillOpacity="0.25" stroke="#B9D9CC" strokeWidth="1.2" />
      <path d="M11.5 24.5h9" stroke="#C69B65" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ collapsed, light = true }: { collapsed?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!collapsed && (
        <div className="leading-none">
          <div className={cn("font-display text-[15px] font-bold tracking-tight", light ? "text-white" : "text-ink")}>
            LegalMind<span className="text-brass"> AI</span>
          </div>
          <div className={cn("mt-1 text-[10px] font-medium uppercase tracking-[0.14em]", light ? "text-white/45" : "text-muted")}>
            Contract Intelligence
          </div>
        </div>
      )}
    </div>
  );
}
