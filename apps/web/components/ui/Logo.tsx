"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

// Logo lockup (brandbook 02/03). Compact = wordmark + kana + dot (header). Full = three tiers (About).
// Animates once per browser session on first load (brandbook 08: 1.3 s, 4 keyframes), never on
// route changes; disabled under prefers-reduced-motion via globals.css.
const SESSION_KEY = "shosho.logo.played";

function useFirstLoadAnimation() {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    try {
      if (!window.sessionStorage.getItem(SESSION_KEY)) {
        window.sessionStorage.setItem(SESSION_KEY, "1");
        setAnimate(true);
      }
    } catch {
      /* ignore */
    }
  }, []);
  return animate;
}

function Letters({ word, className }: { word: string; className: string }) {
  const mid = (word.length - 1) / 2;
  return (
    <span className={className} aria-label={word}>
      {word.split("").map((ch, i) => (
        <span key={i} aria-hidden className="logo-letter inline-block" style={{ ["--i" as string]: Math.abs(i - mid) }}>
          {ch}
        </span>
      ))}
    </span>
  );
}

export function LogoCompact({ inverted = false, href = "/" }: { inverted?: boolean; href?: string }) {
  const animate = useFirstLoadAnimation();
  return (
    <Link href={href} className={`flex items-baseline gap-[9px] ${animate ? "logo-animate" : ""}`} aria-label="SHOSHO — home">
      <Letters word="SHOSHO" className={`text-[22px] font-extrabold leading-[1.3] tracking-[0.1em] ${inverted ? "text-cream" : "text-ink"}`} />
      <span className={`kana logo-kana text-[13px] leading-[1.3] ${inverted ? "text-sky" : "text-blue"}`}>ショ</span>
      <span className="logo-dot mb-[3px] inline-block h-1.5 w-1.5 bg-orange" />
    </Link>
  );
}

export function LogoFull({ inverted = true }: { inverted?: boolean }) {
  const animate = useFirstLoadAnimation();
  const ink = inverted ? "text-cream" : "text-ink";
  return (
    <div className={`flex flex-col items-center gap-2.5 ${animate ? "logo-animate" : ""}`}>
      <Letters word="SHOSHO" className={`text-[46px] font-extrabold leading-[1.3] tracking-[0.1em] ${ink}`} />
      <div className="flex items-center gap-3.5">
        <span className={`kana logo-kana text-[20px] font-bold leading-[1.3] ${ink}`}>ショ</span>
        <span className="flex items-center">
          <span className="logo-rail-l block h-px w-3 bg-orange/60" />
          <span className="logo-dot block h-[9px] w-[9px] bg-orange" />
          <span className="logo-rail-r block h-px w-3 bg-orange/60" />
        </span>
        <span className={`kana logo-kana text-[20px] font-bold leading-[1.3] ${ink}`}>ショ</span>
      </div>
      <span className="logo-descriptor pl-[.5em] text-[12px] font-medium leading-[1.3] tracking-[0.5em] text-sky">PREMIUM SUSHI · BERLIN</span>
    </div>
  );
}
