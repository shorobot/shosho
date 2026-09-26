"use client";

import { useT, type Key } from "@/lib/i18n";
import { FILTERS, type Filter } from "@/lib/orders";

const KEYS: Record<Filter, Key> = {
  all: "filter.all",
  delivery: "filter.delivery",
  pickup: "filter.pickup",
  paid: "filter.paid",
  open: "filter.open",
  scheduled: "filter.scheduled",
};

export function Filters({ query, onQuery, filter, onFilter }: { query: string; onQuery: (v: string) => void; filter: Filter; onFilter: (f: Filter) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex min-w-[240px] max-w-[340px] flex-1 items-center gap-2.5 rounded-full bg-field px-4 py-2.5 shadow-(--shadow-inset)">
        <span className="text-[13px] text-muted-2" aria-hidden>
          ⌕
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          className="w-full border-0 bg-transparent text-[13px] outline-none placeholder:text-muted-2"
        />
      </div>
      {FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onFilter(f)}
          aria-pressed={filter === f}
          className={`whitespace-nowrap rounded-full px-4 py-2.5 text-[12px] transition-micro ${filter === f ? "bg-ink font-extrabold text-cream" : "bg-paper font-medium text-ink-2 shadow-(--shadow-pill) hover:text-ink"}`}
        >
          {t(KEYS[f])}
        </button>
      ))}
    </div>
  );
}
