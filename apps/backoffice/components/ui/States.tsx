import type { ReactNode } from "react";

/** Empty state card from BO · Zustände: icon stone, title, body, one CTA. */
export function EmptyState({ icon, title, body, action, tint = false }: { icon: string; title: ReactNode; body: ReactNode; action?: ReactNode; tint?: boolean }) {
  return (
    <div className="card flex flex-col items-center gap-3 rounded-[22px] px-6 py-9 text-center">
      <span className={`flex h-[62px] w-[62px] items-center justify-center rounded-full text-[23px] text-muted shadow-(--shadow-inset) ${tint ? "bg-orange-tint" : "bg-field-2"}`}>{icon}</span>
      <span className="text-[16px] font-extrabold">{title}</span>
      <span className="max-w-[300px] text-[13px] leading-[1.55] text-ink-3">{body}</span>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Error / interruption card from BO · Zustände: left rule, "!" dot, title, body, actions. */
export function ErrorState({ title, body, actions, tone = "alert" }: { title: ReactNode; body: ReactNode; actions?: ReactNode; tone?: "alert" | "warn" }) {
  const c = tone === "alert" ? "border-alert" : "border-orange-ink";
  const dot = tone === "alert" ? "bg-alert" : "bg-orange-ink";
  return (
    <div className={`card flex flex-col gap-3 rounded-[22px] border-l-[5px] p-5 ${c}`} role="alert">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full text-[12px] font-extrabold text-white ${dot}`}>!</span>
        <span className="text-[14px] font-extrabold leading-[1.35]">{title}</span>
      </div>
      <span className="text-[13px] leading-[1.55] text-ink-3">{body}</span>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted" aria-live="polite">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-transparent" />
      {label}
    </div>
  );
}
