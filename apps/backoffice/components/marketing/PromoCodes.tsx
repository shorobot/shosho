"use client";

// Promo codes table (§1.5). These columns have existed since S2-01 — `kind`, `value`,
// `min_order_cents`, `applies_to`, `usage_limit`, `used_count`, `valid_from/to`, `active` — and this
// screen reads the schema rather than inventing fields for them.
//
// The design keeps exhausted and expired codes visible but dimmed, with the used counter in the
// alert colour: a code that stopped working is information, and hiding it is how an operator ends up
// re-creating one that already exists.
import { useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Section } from "@/components/menu/Fields";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { PromoEditor } from "@/components/marketing/PromoEditor";
import { shortDate } from "@/lib/datetime";
import { useI18n, type Key } from "@/lib/i18n";
import { appliesTo, promoState, usageFraction, usageLabel, type PromoRow, type PromoState } from "@/lib/marketing";
import { run, useMarketing } from "@/lib/marketingStore";
import { euro } from "@/lib/money";
import { toast } from "@/lib/toast";
import { wrote } from "@/lib/write";

const TONES: Record<PromoState, Tone> = { live: "ok", scheduled: "blue", expired: "muted", exhausted: "amber", inactive: "muted" };

export function PromoCodes() {
  const { t, lang } = useI18n();
  const { promos, categories, canWrite, now, reload } = useMarketing();
  const supabase = useSupabase();
  const [editing, setEditing] = useState<PromoRow | "new" | null>(null);

  const states = promos.map((p) => promoState(p, now));
  const active = states.filter((s) => s === "live").length;
  const dead = states.filter((s) => s === "expired" || s === "exhausted").length;

  const discountLabel = (p: PromoRow) =>
    p.kind === "percent"
      ? t("mkt.pct", { n: p.value })
      : p.min_order_cents > 0
        ? t("mkt.fixedMin", { v: euro(p.value, lang), m: euro(p.min_order_cents, lang) })
        : t("mkt.fixed", { v: euro(p.value, lang) });

  const scopeLabel = (p: PromoRow) => {
    const a = appliesTo(p.applies_to);
    const base =
      a.scope === "category"
        ? t("mkt.scope.category", { c: categories.find((c) => c.id === a.category_id)?.name_de ?? "—" })
        : t(`mkt.scope.${a.scope ?? "all"}` as Key);
    const extras: string[] = [];
    if (a.days?.length) extras.push(a.days.map((d) => t(`mkt.wd.${d}` as Key)).join("/"));
    if (a.until) extras.push(t("mkt.scopeUntil", { t: a.until }));
    return extras.length ? `${base} · ${extras.join(" · ")}` : base;
  };

  const periodLabel = (p: PromoRow) => {
    if (!p.valid_from && !p.valid_to) return t("mkt.noEnd");
    if (p.valid_from && !p.valid_to) return t("mkt.startsOn", { d: shortDate(p.valid_from, lang) });
    if (!p.valid_from && p.valid_to) return t("mkt.until", { d: shortDate(p.valid_to, lang) });
    return t("mkt.fromTo", { a: shortDate(p.valid_from, lang), b: shortDate(p.valid_to, lang) });
  };

  async function toggle(p: PromoRow) {
    const res = await run(lang, () => supabase.from("promo_codes").update({ active: !p.active }).eq("id", p.id).select("id"));
    if (res == null) return;
    if (!wrote(res)) return toast(t("web.writeNoop"));
    await reload();
    toast(t("mkt.promoSaved"), "ok");
  }

  return (
    <>
      <Section title={t("mkt.promos")} hint={t("mkt.promosCount", { a: active, x: dead })}>
        {promos.length === 0 ? (
          <EmptyState
            icon="％"
            title={t("mkt.promosEmptyTitle")}
            body={t("mkt.promosEmptyBody")}
            action={canWrite ? <Pill size="sm" onClick={() => setEditing("new")}>{t("mkt.addPromo")}</Pill> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="flex min-w-[720px] flex-col gap-1.5">
              <div className="grid grid-cols-[132px_minmax(0,1fr)_minmax(0,1fr)_112px_132px_112px] gap-2 px-2 pb-1">
                {[t("mkt.colCode"), t("mkt.colDiscount"), t("mkt.colAppliesTo"), t("mkt.colUsed"), t("mkt.colPeriod"), t("mkt.colActions")].map((h) => (
                  <span key={String(h)} className="label-caps">
                    {h}
                  </span>
                ))}
              </div>
              {promos.map((p) => {
                const state = promoState(p, now);
                const dim = state === "expired" || state === "inactive";
                const frac = usageFraction(p);
                const hot = state === "exhausted" || (frac != null && frac >= 0.9);
                return (
                  <div key={p.id} className={`grid grid-cols-[132px_minmax(0,1fr)_minmax(0,1fr)_112px_132px_112px] items-center gap-2 rounded-[12px] bg-field-2 px-2 py-2.5 ${dim ? "opacity-55" : ""}`}>
                    <span className="flex flex-col gap-1">
                      <span className="text-[13px] font-extrabold">{p.code}</span>
                      <Badge tone={TONES[state]}>{t(`mkt.pstate.${state}` as Key)}</Badge>
                    </span>
                    <span className="truncate text-[12px]">{discountLabel(p)}</span>
                    <span className="truncate text-[12px] text-ink-3">{scopeLabel(p)}</span>
                    <span className={`text-[12px] font-extrabold ${hot ? "text-alert" : ""}`}>{usageLabel(p, lang)}</span>
                    <span className="truncate text-[11px] text-ink-3">{state === "expired" ? t("mkt.expiredOn", { d: shortDate(p.valid_to, lang) }) : periodLabel(p)}</span>
                    <span className="flex gap-1">
                      <Pill variant="ghost" size="xs" onClick={() => setEditing(p)}>
                        {canWrite ? t("mkt.edit") : "···"}
                      </Pill>
                      {canWrite && (
                        <Pill variant="ghost" size="xs" onClick={() => void toggle(p)} title={p.active ? t("mkt.deactivate") : t("mkt.activate")}>
                          {p.active ? "⊘" : "✓"}
                        </Pill>
                      )}
                    </span>
                  </div>
                );
              })}
              {canWrite && (
                <button
                  type="button"
                  onClick={() => setEditing("new")}
                  className="rounded-[12px] border border-dashed border-line-3 bg-field-2 py-2 text-[12px] font-extrabold text-orange transition-micro hover:border-orange-line"
                >
                  {t("mkt.addPromo")}
                </button>
              )}
            </div>
          </div>
        )}
      </Section>
      {editing && <PromoEditor promo={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
