"use client";

// The funnel with its two honest gaps stated (D-015 / §6.9 row 5), not invented:
//   · MENÜ → WARENKORB is permanently unavailable — no client-side analytics exist or are planned.
//   · ANFRAGEN → BESTELLT reads "nothing recorded yet" until S3-03 calls record_order_attempt, and
//     once it does, the ratio's own window (attempts_window_from/to, S2-06) is shown whenever it is
//     narrower than the requested period — a figure must not silently answer a different question
//     than the one on screen.
import { Section } from "@/components/menu/Fields";
import { useI18n } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { attemptsWindowNarrowed, funnelView, isAvailable, type Report } from "@/lib/reports";
import { useReports } from "@/lib/reportsStore";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-field p-3.5">
      <span className="label-caps text-muted">{label}</span>
      <span className="text-[18px] font-extrabold leading-[1.2]">{value}</span>
      {sub && <span className="text-[11px] leading-[1.4] text-muted">{sub}</span>}
    </div>
  );
}

function fmt(r: Report, format: (v: number) => string): string {
  return isAvailable(r) ? format(r.value) : "—";
}

export function FunnelPanel() {
  const { t, lang } = useI18n();
  const { funnel, range } = useReports();
  const view = funnelView(funnel);
  const pct = (v: number) => t("kpi.pct", { n: v.toFixed(1).replace(".", lang === "de" ? "," : ".") });
  const narrowed = attemptsWindowNarrowed(range, view.attemptsWindow);

  return (
    <Section title={t("rpt.funnel")}>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat label={t("rpt.funnelCartStep")} value="—" sub={t("rpt.funnelNotCollected")} />
        {isAvailable(view.attemptsToPlacedPct) ? (
          <Stat
            label={t("rpt.funnelAttempts")}
            value={fmt(view.attemptsToPlacedPct, pct)}
            sub={narrowed && view.attemptsWindow ? t("rpt.funnelWindowNarrowed") + ` ${view.attemptsWindow.from} – ${view.attemptsWindow.to}` : undefined}
          />
        ) : (
          <Stat label={t("rpt.funnelAttempts")} value="—" sub={t("rpt.funnelNotRecordedYet")} />
        )}
        <Stat label={t("rpt.funnelPlaced")} value={fmt(view.placed, (v) => String(v))} />
        <Stat label={t("rpt.funnelPaid")} value={fmt(view.paid, (v) => String(v))} sub={isAvailable(view.placedToPaidPct) ? pct(view.placedToPaidPct.value) : undefined} />
        <Stat label={t("rpt.funnelCancelled")} value={fmt(view.cancelled, (v) => String(v))} />
        <Stat label={t("rpt.funnelUpsell")} value={fmt(view.upsellCents, (v) => euro(v, lang))} sub={isAvailable(view.upsellOrders) ? String(view.upsellOrders.value) : undefined} />
      </div>
    </Section>
  );
}
