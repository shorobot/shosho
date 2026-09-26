"use client";

import { useI18n, type Lang } from "@/lib/i18n";

/** DE / EN switch as on the canvas: dark pill with two segments. `dark` for the nav rail, light for pages. */
export function LangToggle({ dark = true }: { dark?: boolean }) {
  const { lang, setLang } = useI18n();
  const seg = (l: Lang) =>
    `flex-1 rounded-full py-1.5 text-center text-[11px] font-extrabold tracking-[0.08em] transition-micro ${
      lang === l ? (dark ? "bg-orange text-white" : "bg-ink text-cream") : dark ? "text-nav-text hover:text-cream" : "text-muted hover:text-ink"
    }`;
  return (
    <div className={`flex rounded-full p-[3px] ${dark ? "bg-nav" : "bg-field shadow-(--shadow-inset)"}`} role="group" aria-label="Language">
      <button type="button" className={seg("de")} onClick={() => setLang("de")} aria-pressed={lang === "de"}>
        DE
      </button>
      <button type="button" className={seg("en")} onClick={() => setLang("en")} aria-pressed={lang === "en"}>
        EN
      </button>
    </div>
  );
}
