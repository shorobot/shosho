"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Pill } from "@/components/ui/Pill";

const KEY = "shosho.cookies.v1";

// Simple consent bar, switched by settings.site.cookie_banner. v1 sets no analytics — only the
// technically necessary storage (cart, tracking token) — so the choice is informational.
export function CookieBanner({ enabled }: { enabled: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    try {
      if (!window.localStorage.getItem(KEY)) setShow(true);
    } catch {
      setShow(true);
    }
  }, [enabled]);
  if (!show) return null;
  const choose = (v: "necessary" | "all") => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ choice: v, at: new Date().toISOString() }));
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <div className="fixed inset-x-3 bottom-[86px] z-40 mx-auto flex max-w-[720px] flex-wrap items-center gap-3 rounded-[20px] bg-ink px-4 py-3.5 text-cream shadow-(--shadow-card-lg) md:bottom-4" role="dialog" aria-label="Cookies" lang="de">
      <span className="flex-1 text-[12px] leading-[1.45] text-ink-cream">
        Wir nutzen nur technisch notwendige Speicherung (Warenkorb, Bestellstatus). Keine Analyse, kein Tracking.{" "}
        <Link href="/datenschutz#cookies" className="text-sky underline-offset-2 hover:underline">Details</Link>
      </span>
      <Pill size="xs" variant="soft" onClick={() => choose("necessary")} className="bg-[#22263d] text-cream shadow-none">Nur notwendige</Pill>
      <Pill size="xs" onClick={() => choose("all")}>OK</Pill>
    </div>
  );
}
