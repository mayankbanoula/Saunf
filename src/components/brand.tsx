import { cn } from "@/lib/utils";

/** Saunf logo: a stylised fennel seed (saunf) in midnight blue and purple. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path
        d="M16 6.5c4.6 3.4 6.6 7 6.6 10.4 0 3.9-2.9 7.6-6.6 8.6-3.7-1-6.6-4.7-6.6-8.6 0-3.4 2-7 6.6-10.4Z"
        fill="var(--highlight)"
      />
      <path d="M16 9.5v14" stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 14.2l-2.6-2M16 18l2.8-2.3" stroke="var(--primary)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      {collapsed ? null : <span className="text-[17px] font-semibold tracking-tight text-primary">Saunf</span>}
    </span>
  );
}
