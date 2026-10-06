"use client";

// The four segment tiles from BO · Kunden, with live counts: "who should we win back" is one click,
// not a query (canvas note). Clicking an active tile clears the filter, so there is always a way back
// to the full list without hunting for a reset.
import { SEGMENTS, type Segment } from "@/lib/crm";
import { useI18n, type Key } from "@/lib/i18n";

export function SegmentTiles({
  counts, active, onPick,
}: {
  counts: Record<Segment, number>;
  active: Segment | null;
  onPick: (s: Segment) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="group">
      {SEGMENTS.map((s) => {
        const on = active === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            aria-pressed={on}
            className={`flex flex-col items-start gap-0.5 rounded-[18px] px-4 py-3.5 text-left transition-micro ${
              on ? "bg-ink text-cream" : "card hover:brightness-[0.99]"
            }`}
          >
            <span className="text-[22px] font-extrabold leading-[1.1]">{counts[s]}</span>
            <span className="text-[12px] font-extrabold leading-[1.3]">{t(`seg.${s}` as Key)}</span>
            <span className={`text-[11px] leading-[1.3] ${on ? "text-nav-text" : "text-muted"}`}>
              {t(`seg.${s}Hint` as Key)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
