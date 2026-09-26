"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Pill, PillLink } from "@/components/ui/Pill";
import { EmptyState, Spinner } from "@/components/ui/States";
import { useI18n, type Key } from "@/lib/i18n";
import { payMethodKey, payStatusKey, statusLongKey } from "@/lib/labels";
import { euro } from "@/lib/money";
import { addressLine } from "@/lib/orders";
import { useOrders } from "@/lib/store";
import { addDays, dayKey, ddmmHHmm, startOfDayKey } from "@/lib/time";
import { downloadText, toCsv } from "@/lib/csv";
import type { OrderRow, OrderStatus, OrderType, PaymentStatus } from "@/lib/types";

type Row = OrderRow & { order_items: { count: number }[] };
type Sort = "date" | "total_desc" | "total_asc";

const STATUSES: OrderStatus[] = ["new", "accepted", "preparing", "ready", "out_for_delivery", "delivered", "picked_up", "cancelled", "refunded"];
const PAY: PaymentStatus[] = ["pending", "authorized", "paid", "failed", "refunded"];

/** Historie (api-contracts §6.3): range + status/payment/type/driver filters, sum row, client-side CSV. */
export function History() {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { staff } = useOrders();
  const today = dayKey(new Date());
  const [from, setFrom] = useState(dayKey(addDays(new Date(), -13)));
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [pay, setPay] = useState<PaymentStatus | "">("");
  const [type, setType] = useState<OrderType | "">("");
  const [driverId, setDriverId] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("date");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const drivers = staff.filter((s) => s.role === "driver");

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("orders")
      .select("*, order_items(count)")
      .gte("created_at", startOfDayKey(from).toISOString())
      .lt("created_at", startOfDayKey(dayKey(addDays(startOfDayKey(to), 1))).toISOString())
      .limit(2000);
    if (status) q = q.eq("status", status);
    if (pay) q = q.eq("payment_status", pay);
    if (type) q = q.eq("type", type);
    if (driverId) q = q.eq("driver_id", driverId);
    if (sort === "date") q = q.order("created_at", { ascending: false });
    else q = q.order("total_cents", { ascending: sort === "total_asc" });
    const { data, error } = await q;
    setError(error?.message ?? null);
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [supabase, from, to, status, pay, type, driverId, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = query.trim().toLowerCase().replace(/^#/, "");
    if (!s) return rows;
    return rows.filter((r) => [String(r.number), r.contact_name, r.contact_phone, addressLine(r)].join(" ").toLowerCase().includes(s));
  }, [rows, query]);

  const sum = filtered.reduce((acc, r) => acc + r.total_cents, 0);
  const items = filtered.reduce((acc, r) => acc + (r.order_items[0]?.count ?? 0), 0);

  function exportCsv() {
    const head = [t("th.no"), t("th.date"), t("th.customer"), t("th.phone"), t("th.type"), t("th.items"), t("th.total"), t("th.payment"), t("th.status"), t("th.driver"), t("th.address")];
    const body = filtered.map((r) => [
      r.number,
      ddmmHHmm(r.created_at),
      r.contact_name,
      r.contact_phone,
      t(r.type === "pickup" ? "type.pickup" : "type.delivery"),
      r.order_items[0]?.count ?? 0,
      (r.total_cents / 100).toFixed(2).replace(".", lang === "de" ? "," : "."),
      t(payMethodKey(r.payment_method)),
      t(statusLongKey(r.status)),
      staff.find((s) => s.id === r.driver_id)?.name ?? "",
      addressLine(r),
    ]);
    downloadText(`shosho-bestellungen-${from}_${to}.csv`, toCsv([head, ...body]));
  }

  function reset() {
    setFrom(dayKey(addDays(new Date(), -13)));
    setTo(today);
    setStatus("");
    setPay("");
    setType("");
    setDriverId("");
    setQuery("");
    setSort("date");
  }

  return (
    <div className="screen-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1>{t("board.title")}</h1>
        <div className="flex gap-1.5">
          <PillLink href="/orders" variant="ghost" size="sm">
            {t("board.tabToday")}
          </PillLink>
          <span className="rounded-full bg-ink px-3.5 py-2 text-[12px] font-extrabold text-cream">{t("history.title")}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <Pill variant="ghost" size="sm" onClick={exportCsv} disabled={!filtered.length}>
            {t("history.csv")}
          </Pill>
          <span className="rounded-full bg-field px-3.5 py-2 text-[12px] font-medium text-muted">{t("history.xlsx")}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2.5 rounded-full bg-field px-4 py-2.5 shadow-(--shadow-inset)">
          <span aria-hidden className="text-muted-2">⌕</span>
          <input className="w-full border-0 bg-transparent text-[13px] outline-none" placeholder={t("search.placeholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Field label={t("history.from")}>
          <input type="date" className="field py-2" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("history.to")}>
          <input type="date" className="field py-2" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t("history.status")}>
          <select className="field py-2" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | "")}>
            <option value="">{t("history.any")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(statusLongKey(s))}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("history.payment")}>
          <select className="field py-2" value={pay} onChange={(e) => setPay(e.target.value as PaymentStatus | "")}>
            <option value="">{t("history.any")}</option>
            {PAY.map((p) => (
              <option key={p} value={p}>
                {t(payStatusKey(p))}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("history.type")}>
          <select className="field py-2" value={type} onChange={(e) => setType(e.target.value as OrderType | "")}>
            <option value="">{t("history.any")}</option>
            <option value="delivery">{t("type.delivery")}</option>
            <option value="pickup">{t("type.pickup")}</option>
          </select>
        </Field>
        <Field label={t("history.driver")}>
          <select className="field py-2" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">{t("history.any")}</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("history.amount")}>
          <select className="field py-2" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="date">{t("history.sortDate")}</option>
            <option value="total_desc">{t("history.sortDesc")}</option>
            <option value="total_asc">{t("history.sortAsc")}</option>
          </select>
        </Field>
        <button type="button" onClick={reset} className="rounded-full px-3 py-2.5 text-[12px] font-extrabold text-orange">
          {t("history.reset")}
        </button>
      </div>

      {loading ? (
        <Spinner label={t("history.loading")} />
      ) : error ? (
        <EmptyState icon="!" title={t("state.error.title")} body={error} action={<Pill onClick={() => void load()}>{t("action.retry")}</Pill>} />
      ) : filtered.length === 0 ? (
        query ? (
          <EmptyState icon="⌕" title={t("state.noMatch.title")} body={t("state.noMatch.body", { q: query })} action={<Pill onClick={reset}>{t("state.noMatch.cta")}</Pill>} />
        ) : (
          <EmptyState icon="▦" title={t("state.noData.title")} body={t("state.noData.body", { r: `${from} – ${to}` })} action={<Pill onClick={reset}>{t("state.noData.cta")}</Pill>} />
        )
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[820px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line-2 text-left">
                {(["th.no", "th.date", "th.customer", "th.type", "th.items", "th.total", "th.payment", "th.status", "th.driver"] as Key[]).map((k) => (
                  <th key={k} className="label-caps px-3 py-2.5 font-medium">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-field-2">
                  <td className="px-3 py-2.5 font-extrabold">
                    <Link href={`/orders/${r.id}`} className="hover:text-orange">
                      #{r.number}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-3">{ddmmHHmm(r.created_at)}</td>
                  <td className="px-3 py-2.5 font-medium">{r.contact_name}</td>
                  <td className="px-3 py-2.5 text-ink-3">{t(r.type === "pickup" ? "type.pickup" : "type.delivery")}</td>
                  <td className="px-3 py-2.5 text-ink-3">{r.order_items[0]?.count ?? 0}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-extrabold">{euro(r.total_cents, lang)}</td>
                  <td className="px-3 py-2.5 text-ink-3">{t(payMethodKey(r.payment_method))}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${r.status === "cancelled" || r.status === "refunded" ? "bg-alert-tint text-alert" : r.status === "delivered" || r.status === "picked_up" ? "bg-ok-tint text-ok" : "bg-field text-ink-2"}`}>
                      {t(statusLongKey(r.status))}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-3">{staff.find((s) => s.id === r.driver_id)?.name ?? "—"}</td>
                </tr>
              ))}
              <tr className="bg-field-2 font-extrabold">
                <td className="px-3 py-2.5">{t("history.sum", { n: filtered.length })}</td>
                <td colSpan={3} />
                <td className="px-3 py-2.5">{items}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{euro(sum, lang)}</td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-caps">{label}</span>
      {children}
    </label>
  );
}
