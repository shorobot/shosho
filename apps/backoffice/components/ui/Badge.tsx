import type { ReactNode } from "react";

export type Tone = "alert" | "orange" | "amber" | "blue" | "ok" | "ink" | "muted" | "sky";

const tones: Record<Tone, string> = {
  alert: "bg-alert text-white",
  orange: "bg-orange text-white",
  amber: "bg-amber text-white",
  blue: "bg-blue text-white",
  ok: "bg-ok text-white",
  ink: "bg-ink text-cream",
  muted: "bg-field text-ink-2",
  sky: "bg-sky-tint text-ink-2",
};

/** Small square-ish status label: "NEU", "ABHOLUNG". */
export function Badge({ tone = "ink", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-block rounded-md px-2 py-1 text-[9px] font-extrabold tracking-[0.09em] leading-[1.3] ${tones[tone]} ${className}`}>{children}</span>;
}

/** Round counter next to a column title. */
export function Count({ tone = "muted", children }: { tone?: "orange" | "sky" | "muted" | "alert"; children: ReactNode }) {
  const t = { orange: "bg-amber-tint", sky: "bg-sky-tint", muted: "bg-field", alert: "bg-alert-tint text-alert" }[tone];
  return <span className={`rounded-full px-2.5 py-[3px] text-[11px] font-extrabold text-ink-2 ${t}`}>{children}</span>;
}
