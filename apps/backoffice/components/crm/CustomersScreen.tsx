"use client";

// BO · Kunden. Search is the largest control on the screen because during a phone call it is the only
// one that matters (canvas note); the segment tiles carry live counts so "who should we win back" is
// one click rather than a query. Every stat column sorts, spend descending by default.
import Link from "next/link";
import { useMemo, useState } from "react";
import { CrmBulkBar, CrmUndoBar, type CrmUndoPlan } from "@/components/crm/CrmBulkBar";
import { SegmentTiles } from "@/components/crm/SegmentTiles";
import { Badge } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import {
  effectiveDaysSilent, inSegment, isAnonymised, matchesCustomerSearch, segmentCounts, sortCustomers,
  TAGS, type Segment, type SortKey, type Tag,
} from "@/lib/crm";
import { useCrm, type CrmRow } from "@/lib/crmStore";
import { useI18n, type Key } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { ddmm } from "@/lib/time";
import { Toasts } from "@/lib/toast";

const SORT_LABEL: Record<SortKey, Key> = {
  spent: "ct.spend",
  orders: "ct.orders",
  avg: "ct.avg",
  last_order: "ct.last",
  days_silent: "ct.silent",
  name: "ct.customer",
};

export function CustomersScreen() {
  const { t, lang } = useI18n();
  const { rows, loading, error, now, canWrite } = useCrm();
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<Segment | null>(null);
  const [tag, setTag] = useState<Tag | null>(null);
  const [sort, setSort] = useState<SortKey>("spent");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ plan: CrmUndoPlan; message: string } | null>(null);

  const counts = useMemo(() => segmentCounts(rows, now), [rows, now]);

  const visible = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        matchesCustomerSearch(r.customer, query) &&
        (!segment || inSegment(segment, r.customer, r.stats, now)) &&
        (!tag || r.customer.tags.includes(tag)),
    );
    return sortCustomers(filtered, sort, dir, now);
  }, [rows, query, segment, tag, sort, dir, now]);

  const selection = useMemo(() => visible.filter((r) => selected.includes(r.customer.id)), [visible, selected]);
  const filtersActive = Boolean(query || segment || tag);

  function toggleSort(key: SortKey) {
    if (key === sort) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setDir(key === "name" ? "asc" : "desc");
    }
  }

  function resetFilters() {
    setQuery("");
    setSegment(null);
    setTag(null);
  }

  return (
    <div className="screen-in flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[24px] font-extrabold">{t("crm.title")}</h1>
        <span className="text-[13px] font-medium text-muted">{t("crm.profiles", { n: rows.length })}</span>
      </header>

      <label className="relative block">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-muted">⌕</span>
        <input
          className="field h-[52px] pl-11 text-[14px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("crm.search")}
          aria-label={t("crm.search")}
          autoFocus
        />
      </label>

      <SegmentTiles counts={counts} active={segment} onPick={(s) => setSegment((prev) => (prev === s ? null : s))} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="label-caps">{t("ct.sortBy")}</span>
        {(["spent", "orders", "avg", "last_order", "days_silent", "name"] as SortKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => toggleSort(k)}
            aria-pressed={sort === k}
            className={`rounded-full px-3 py-1.5 text-[11px] leading-[1.3] transition-micro ${sort === k ? "bg-ink font-extrabold text-cream" : "bg-field font-medium text-ink-2 hover:text-ink"}`}
          >
            {t(SORT_LABEL[k])} {sort === k ? (dir === "desc" ? "↓" : "↑") : ""}
          </button>
        ))}
        <span className="label-caps ml-2">{t("ct.tagFilter")}</span>
        {TAGS.map((tg) => (
          <button
            key={tg}
            type="button"
            onClick={() => setTag((prev) => (prev === tg ? null : tg))}
            aria-pressed={tag === tg}
            className={`rounded-full px-3 py-1.5 text-[11px] leading-[1.3] transition-micro ${tag === tg ? "bg-ink font-extrabold text-cream" : "bg-field font-medium text-ink-2 hover:text-ink"}`}
          >
            {tg}
          </button>
        ))}
        {filtersActive && (
          <Pill variant="ghost" size="xs" onClick={resetFilters} className="ml-auto">
            {t("ce.reset")}
          </Pill>
        )}
      </div>

      {undo && <CrmUndoBar plan={undo.plan} message={undo.message} onClear={() => setUndo(null)} />}
      {canWrite && (
        <CrmBulkBar
          selection={selection}
          onClear={() => setSelected([])}
          onUndoPlan={(plan, message) => setUndo({ plan, message })}
        />
      )}

      {error && <ErrorState title={t("crm.loadError")} body={error} />}
      {loading && <Spinner label={t("crm.loading")} />}

      {!loading && !error && rows.length === 0 && (
        // BO · Zustände: "Noch kein Kundenprofil". No import UI exists yet, so the design's
        // "Importieren" CTA is not rendered as a button that would do nothing.
        <EmptyState icon="☻" title={t("ce.noneTitle")} body={t("ce.noneBody")} />
      )}

      {!loading && !error && rows.length > 0 && visible.length === 0 && (
        <EmptyState
          icon="⌕"
          title={t("ce.noHitsTitle")}
          body={t("ce.noHitsBody", { q: query || (segment ? t(`seg.${segment}` as Key) : (tag ?? "")) })}
          action={<Pill size="sm" onClick={resetFilters}>{t("ce.reset")}</Pill>}
        />
      )}

      {visible.length > 0 && (
        <div className="card overflow-x-auto rounded-[18px] p-4">
          <table className="w-full min-w-[920px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line-2 text-left">
                {canWrite && (
                  <th className="w-[28px] pb-2.5">
                    <input
                      type="checkbox"
                      aria-label={t("crm.allCustomers")}
                      checked={selection.length > 0 && selection.length === visible.length}
                      onChange={(e) => setSelected(e.target.checked ? visible.map((r) => r.customer.id) : [])}
                    />
                  </th>
                )}
                <Th>{t("ct.customer")}</Th>
                <Th>{t("ct.contact")}</Th>
                <Th sortable onClick={() => toggleSort("orders")}>{t("ct.orders")}</Th>
                <Th sortable onClick={() => toggleSort("spent")}>{t("ct.spend")}</Th>
                <Th sortable onClick={() => toggleSort("avg")}>{t("ct.avg")}</Th>
                <Th sortable onClick={() => toggleSort("last_order")}>{t("ct.last")}</Th>
                <Th>{t("ct.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <Row
                  key={r.customer.id}
                  row={r}
                  now={now}
                  lang={lang}
                  selectable={canWrite}
                  checked={selected.includes(r.customer.id)}
                  onCheck={(on) =>
                    setSelected((prev) => (on ? [...prev, r.customer.id] : prev.filter((id) => id !== r.customer.id)))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Toasts />
    </div>
  );
}

function Th({ children, sortable = false, onClick }: { children: React.ReactNode; sortable?: boolean; onClick?: () => void }) {
  return (
    <th className="pb-2.5 pr-3 text-[9px] font-extrabold tracking-[0.09em] text-muted">
      {sortable ? (
        <button type="button" onClick={onClick} className="tracking-[0.09em] transition-micro hover:text-ink">
          {children}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, "")[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Row({
  row, now, lang, selectable, checked, onCheck,
}: {
  row: CrmRow; now: Date; lang: "de" | "en"; selectable: boolean; checked: boolean; onCheck: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const { customer: c, stats } = row;
  const silent = effectiveDaysSilent(stats, now);
  const anon = isAnonymised(c);

  return (
    <tr className="border-b border-line-2 last:border-0 hover:bg-field-2">
      {selectable && (
        <td className="py-3">
          <input type="checkbox" aria-label={c.name} checked={checked} onChange={(e) => onCheck(e.target.checked)} />
        </td>
      )}
      <td className="py-3 pr-3">
        <Link href={`/customers/${c.id}`} className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-field text-[11px] font-extrabold text-ink-2">
            {anon ? "–" : initials(c.name)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-extrabold">{c.name}</span>
            <span className="flex flex-wrap gap-1 pt-0.5">
              {anon && <Badge tone="muted">{t("ct.anonymised")}</Badge>}
              {c.tags.map((tg) => (
                <Badge key={tg} tone={tg === "PROBLEM" ? "alert" : tg === "ALLERGIE" ? "amber" : tg === "VIP" ? "orange" : "sky"}>
                  {tg}
                </Badge>
              ))}
              {stats.cancelled_count > 0 && <Badge tone="muted">{t("ct.cancelled", { n: stats.cancelled_count })}</Badge>}
            </span>
          </span>
        </Link>
      </td>
      <td className="py-3 pr-3 text-[12px] text-ink-3">
        <span className="block truncate">{c.phone}</span>
        {c.email && <span className="block truncate text-muted">{c.email}</span>}
      </td>
      <td className="py-3 pr-3 font-extrabold">{stats.orders_count}</td>
      <td className="py-3 pr-3 font-extrabold">{euro(stats.spent_cents, lang)}</td>
      <td className="py-3 pr-3">{stats.orders_count > 0 ? euro(stats.avg_cents, lang) : "—"}</td>
      <td className="py-3 pr-3 text-[12px]">
        {stats.last_order_at ? (
          <span className="flex flex-col">
            <span>{ddmm(stats.last_order_at)}</span>
            <span className="text-muted">
              {silent === 0 ? t("ct.today") : silent === 1 ? t("ct.yesterday") : t("ct.daysAgo", { n: silent ?? 0 })}
            </span>
          </span>
        ) : (
          <span className="text-muted">{t("ct.never")}</span>
        )}
      </td>
      <td className="py-3">
        <div className="flex gap-1.5">
          <a
            href={`tel:${c.phone}`}
            aria-label={t("ct.call")}
            title={t("ct.call")}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-field text-[12px] text-ink-2 transition-micro hover:text-ink"
          >
            ☏
          </a>
          <Link
            href={`/customers/${c.id}`}
            aria-label={t("ct.openProfile")}
            title={t("ct.openProfile")}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-field text-[12px] text-ink-2 transition-micro hover:text-ink"
          >
            →
          </Link>
        </div>
      </td>
    </tr>
  );
}
