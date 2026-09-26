"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { useI18n, type Key } from "@/lib/i18n";
import { pickName } from "@/lib/labels";
import { euro } from "@/lib/money";
import { useOrders } from "@/lib/store";
import { toast } from "@/lib/toast";
import type { OrderType, PaymentMethod } from "@/lib/types";

type Item = { id: string; name_de: string | null; name_en: string | null; base_price_cents: number | null };
type Line = { item_id: string; qty: number };
type Problem = { code: string; field?: string; reason?: string };
type Quote = { ok?: boolean; total_cents?: number; subtotal_cents?: number; delivery_fee_cents?: number; discount_cents?: number; problems?: Problem[] };

const PROBLEM_KEY: Record<string, Key> = {
  unavailable: "problem.unavailable",
  invalid_options: "problem.invalid_options",
  below_min_order: "problem.below_min_order",
  out_of_zone: "problem.out_of_zone",
  closed: "problem.closed",
  promo_invalid: "problem.promo_invalid",
  empty_cart: "problem.empty_cart",
};

/** Minimal phone-order form → rpc('place_order', {channel:'phone', …}) from the staff session (§6.1). */
export function PhoneOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { reload } = useOrders();
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [type, setType] = useState<OrderType>("delivery");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [floor, setFloor] = useState("");
  const [postal, setPostal] = useState("");
  const [city, setCity] = useState("Berlin");
  const [comment, setComment] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("cash");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || items.length) return;
    void supabase
      .from("menu_items_on_sale")
      .select("id, name_de, name_en, base_price_cents")
      .order("name_de")
      .then(({ data }) => setItems((data ?? []).filter((i): i is Item => Boolean(i.id))));
  }, [open, items.length, supabase]);

  const payload = useMemo(
    () => ({
      type,
      items: lines.filter((l) => l.qty > 0).map((l) => ({ item_id: l.item_id, qty: l.qty })),
      postal_code: type === "delivery" ? postal.trim() || undefined : undefined,
      contact: { phone: phone.trim() || undefined },
    }),
    [type, lines, postal, phone],
  );

  const refreshQuote = useCallback(async () => {
    if (!payload.items.length) {
      setQuote(null);
      return;
    }
    const { data } = await supabase.rpc("quote_order", { payload });
    setQuote((data as Quote) ?? null);
  }, [supabase, payload]);

  useEffect(() => {
    const id = setTimeout(() => void refreshQuote(), 300);
    return () => clearTimeout(id);
  }, [refreshQuote]);

  function setQty(item_id: string, qty: number) {
    setLines((ls) => {
      const rest = ls.filter((l) => l.item_id !== item_id);
      return qty > 0 ? [...rest, { item_id, qty }] : rest;
    });
  }

  const visible = items.filter((i) => pickName(lang, i.name_de, i.name_en).toLowerCase().includes(search.trim().toLowerCase())).slice(0, search ? 12 : 8);
  const chosen = lines.filter((l) => l.qty > 0);

  async function submit() {
    setBusy(true);
    const body = {
      ...payload,
      channel: "phone",
      contact: { name: name.trim(), phone: phone.trim() },
      address: type === "delivery" ? { street: street.trim(), floor_apt: floor.trim() || undefined, postal_code: postal.trim(), city: city.trim() || undefined } : undefined,
      courier_comment: comment.trim() || undefined,
      payment_method: payment,
      payment_status: "pending",
    };
    const { data, error } = await supabase.rpc("place_order", { payload: body });
    setBusy(false);
    if (error) {
      let msg = error.message;
      if (error.message === "order_rejected" && error.details) {
        try {
          const problems = JSON.parse(error.details) as Problem[];
          msg = problems.map((p) => (PROBLEM_KEY[p.code] ? t(PROBLEM_KEY[p.code] as Key) : p.code === "invalid_input" ? t("problem.invalid_input", { f: p.field ?? "" }) : p.code)).join(", ");
        } catch {
          msg = error.details;
        }
      }
      toast(t("phone.err", { m: msg }));
      return;
    }
    const res = data as { number?: number } | null;
    toast(t("phone.ok", { n: res?.number ?? "" }), "ok");
    setLines([]);
    setName("");
    setPhone("");
    setStreet("");
    setFloor("");
    setPostal("");
    setComment("");
    setQuote(null);
    await reload();
    onClose();
  }

  const problems = quote?.problems ?? [];
  const canSubmit = chosen.length > 0 && name.trim() && phone.trim() && (type === "pickup" || (street.trim() && postal.trim())) && problems.length === 0 && !busy;

  return (
    <Modal open={open} onClose={onClose} title={t("phone.title")} wide>
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <span className="label-caps">{t("phone.items")}</span>
          <input className="field" placeholder={t("phone.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex max-h-[220px] flex-col gap-1.5 overflow-auto pr-1">
            {visible.map((i) => {
              const qty = lines.find((l) => l.item_id === i.id)?.qty ?? 0;
              return (
                <div key={i.id} className={`flex items-center gap-2 rounded-[12px] px-3 py-2 ${qty ? "bg-orange-tint" : "bg-field-2"}`}>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{pickName(lang, i.name_de, i.name_en)}</span>
                  <span className="whitespace-nowrap text-[12px] font-extrabold">{euro(i.base_price_cents ?? 0, lang)}</span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" className="h-7 w-7 rounded-full bg-paper text-[13px] shadow-(--shadow-pill)" onClick={() => setQty(i.id, Math.max(0, qty - 1))} aria-label="−">
                      −
                    </button>
                    <span className="w-5 text-center text-[12px] font-extrabold">{qty}</span>
                    <button type="button" className="h-7 w-7 rounded-full bg-ink text-[13px] text-cream" onClick={() => setQty(i.id, qty + 1)} aria-label="+">
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="label-caps">{t("phone.type")}</span>
            <select className="field" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
              <option value="delivery">{t("type.delivery")}</option>
              <option value="pickup">{t("type.pickup")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-caps">{t("phone.payment")}</span>
            <select className="field" value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod)}>
              <option value="cash">{t("phone.cash")}</option>
              <option value="card">{t("phone.card")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-caps">{t("phone.name")}</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-caps">{t("phone.phone")}</span>
            <input className="field" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          {type === "delivery" && (
            <>
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="label-caps">{t("phone.street")}</span>
                <input className="field" value={street} onChange={(e) => setStreet(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="label-caps">{t("phone.floor")}</span>
                <input className="field" value={floor} onChange={(e) => setFloor(e.target.value)} />
              </label>
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <label className="flex flex-col gap-1.5">
                  <span className="label-caps">{t("phone.postal")}</span>
                  <input className="field" inputMode="numeric" value={postal} onChange={(e) => setPostal(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label-caps">{t("phone.city")}</span>
                  <input className="field" value={city} onChange={(e) => setCity(e.target.value)} />
                </label>
              </div>
            </>
          )}
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="label-caps">{t("phone.comment")}</span>
            <input className="field" value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
        </section>

        {problems.length > 0 && (
          <p role="alert" className="rounded-xl bg-alert-tint px-3 py-2 text-[12px] font-extrabold text-alert">
            {problems.map((p) => (PROBLEM_KEY[p.code] ? t(PROBLEM_KEY[p.code] as Key) : p.code === "invalid_input" ? t("problem.invalid_input", { f: p.field ?? "" }) : p.code)).join(" · ")}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <span className="text-[13px] font-medium text-muted">
            {t("phone.quote")}: <strong className="text-[18px] font-extrabold text-ink">{euro(quote?.total_cents ?? 0, lang)}</strong>
          </span>
          <Pill size="lg" disabled={!canSubmit} onClick={submit}>
            {busy ? t("action.working") : t("phone.submit")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}
