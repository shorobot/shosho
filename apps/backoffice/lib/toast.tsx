"use client";

import { useEffect, useState } from "react";

// Minimal toast bus: `toast(msg, tone)` from anywhere, <Toasts/> once in the shell.
type Toast = { id: number; text: string; tone: "ok" | "alert" };
type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();
let seq = 0;

export function toast(text: string, tone: Toast["tone"] = "alert") {
  const t = { id: ++seq, text, tone };
  listeners.forEach((l) => l(t));
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l: Listener = (t) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 5000);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`screen-in pointer-events-auto max-w-[520px] rounded-full px-4 py-2.5 text-[12px] font-extrabold shadow-(--shadow-modal) ${t.tone === "ok" ? "bg-ink text-cream" : "bg-alert text-white"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
