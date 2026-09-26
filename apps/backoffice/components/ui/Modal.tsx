"use client";

import { useEffect, type ReactNode } from "react";

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="presentation">
      <div role="dialog" aria-modal="true" className={`screen-in max-h-[92dvh] w-full overflow-auto rounded-t-[22px] bg-paper p-5 shadow-(--shadow-modal) sm:rounded-[22px] ${wide ? "sm:max-w-[720px]" : "sm:max-w-[440px]"}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[16px] font-extrabold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="close" className="flex h-8 w-8 items-center justify-center rounded-full bg-field text-[13px] text-ink-2">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
