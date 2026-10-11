"use client";

// The design's seven-bar discount-rate chart and the "best promotion" tile.
//
// Both come from `orders` (promo_code, discount_cents, total_cents) over the KPI window, which is
// real data today. A weekday with no completed orders gets no bar and no 0 % label — an empty
// Tuesday is "we were closed / nothing finished", not "nobody used a code".
import { Section } from "@/components/menu/Fields";
import { useI18n, type Key } from "@/lib/i18n";
import { bestPromo, discountRateByWeekday } from "@/lib/marketing";
import { KPI_WINDOW_DAYS, useMarketing } from "@/lib/marketingStore";
import { euro } from "@/lib/money";

export function DiscountChart() {
  const { t, lang } = useI18n();
  const { orders, from, to } = useMarketing();
  const series = discountRateByWeekday(orders, from, to);
  const best = bestPromo(orders, from, to);
  const measured = series.filter((v): v is number => v != null);
  const max = measured.length ? Math.max(...measured, 1) : 1;
  const num = (v: number, digits = 1) => v.toFixed(digits).replace(".", lang === "de" ? "," : ".");

  return (
    <>
      <Section title={t("mkt.chart")} hint={t("mkt.window", { n: KPI_WINDOW_DAYS })}>
        {measured.length === 0 ? (
          <span className="text-[12px] text-muted">{t("mkt.chartEmpty")}</span>
        ) : (
          <>
            <div className="flex h-[110px] items-end gap-2">
              {series.map((v, i) => (
                <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10px] font-extrabold text-ink-3">{v == null ? "" : `${num(v, 0)}%`}</span>
                  <div
                    className={`w-full rounded-t-[6px] ${v == null ? "bg-field" : "bg-orange"}`}
                    style={{ height: v == null ? 3 : Math.max(3, Math.round((v / max) * 72)) }}
                    aria-hidden
                  />
                  <span className="text-[10px] text-muted">{t(`mkt.wd.${i + 1}` as Key)}</span>
                </div>
              ))}
            </div>
            <span className="text-[11px] leading-[1.45] text-muted">{t("mkt.chartHint")}</span>
          </>
        )}
      </Section>

      <Section title={t("mkt.bestPromo")}>
        {!best ? (
          <span className="text-[12px] text-muted">{t("mkt.bestPromoNone")}</span>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-[20px] font-extrabold">{best.code}</span>
            <span className="text-[12px] leading-[1.5] text-ink-3">
              {t("mkt.bestPromoLine", { n: best.redemptions, v: euro(best.revenueCents, lang), c: euro(best.discountCents, lang) })}
              {best.roi != null ? t("mkt.bestPromoRoi", { r: num(best.roi) }) : ""}
            </span>
          </div>
        )}
      </Section>
    </>
  );
}
