import type { ReactNode } from "react";

// Zustände screen (website section): icon in an inset circle, title, reason, one next action.
export function EmptyState({
  icon,
  title,
  body,
  action,
  secondary,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  secondary?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 rounded-[22px] bg-paper px-6 py-[34px] text-center shadow-(--shadow-chip) ${className}`} role="status">
      <span className="flex h-[62px] w-[62px] items-center justify-center rounded-full bg-field-2 text-[23px] text-muted shadow-(--shadow-inset)" aria-hidden>
        {icon}
      </span>
      <span className="text-[16px] font-extrabold leading-[1.3]">{title}</span>
      <span className="max-w-[300px] text-[13px] leading-[1.55] text-ink-3">{body}</span>
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}{secondary}</div>}
    </div>
  );
}
