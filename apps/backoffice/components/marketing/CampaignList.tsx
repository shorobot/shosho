"use client";

// Campaigns list (§8.1). `campaigns` is owner/operator CRUD directly — drafting one needs no RPC.
//
// The four stat columns the design ends each row with (sent / opened / orders / revenue) read
// `campaigns.stats`, which only a sender writes. There is no sender, so they render "—" rather than
// "0": the figure does not exist yet, and a 0 in the REVENUE column would be a claim that the
// campaign earned nothing.
import { useState } from "react";
import Link from "next/link";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Section } from "@/components/menu/Fields";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Pill, PillLink } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { fullDateTime } from "@/lib/datetime";
import { useI18n, type Key } from "@/lib/i18n";
import { statsOf, type CampaignRow, type CampaignStatus } from "@/lib/marketing";
import { run, useMarketing } from "@/lib/marketingStore";
import { euro } from "@/lib/money";
import { toast } from "@/lib/toast";
import { wrote } from "@/lib/write";

const TONES: Record<CampaignStatus, Tone> = { draft: "muted", scheduled: "blue", sending: "amber", sent: "ok", cancelled: "muted" };

export function CampaignList() {
  const { t, lang } = useI18n();
  const { campaigns, canWrite, reload } = useMarketing();
  const supabase = useSupabase();
  const [confirming, setConfirming] = useState<string | null>(null);

  async function remove(c: CampaignRow) {
    const res = await run(lang, () => supabase.from("campaigns").delete().eq("id", c.id).select("id"));
    if (res == null) return;
    if (!wrote(res)) return toast(t("web.writeNoop"));
    setConfirming(null);
    await reload();
    toast(t("mkt.campaignDeleted"), "ok");
  }

  return (
    <Section title={t("mkt.campaigns")} hint={t("mkt.statsNone")}>
      {campaigns.length === 0 ? (
        <EmptyState
          icon="✉"
          title={t("mkt.campaignsEmptyTitle")}
          body={t("mkt.campaignsEmptyBody")}
          action={canWrite ? <PillLink size="sm" href="/marketing/campaign/new">{t("mkt.newCampaign")}</PillLink> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {campaigns.map((c) => {
            const s = statsOf(c.stats);
            const when =
              c.sent_at ? t("mkt.sentOn", { d: fullDateTime(c.sent_at, lang) })
              : c.scheduled_for ? t("mkt.scheduledOn", { d: fullDateTime(c.scheduled_for, lang) })
              : t("mkt.draftSaved");
            return (
              <div key={c.id} className="flex flex-col gap-2 rounded-[14px] bg-field-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONES[c.status]}>{t(`mkt.cstate.${c.status}` as Key)}</Badge>
                  <span className="text-[13px] font-extrabold">{c.name}</span>
                  <span className="text-[11px] text-muted">
                    {t(`mkt.channel.${c.channel}` as Key)} · {when}
                  </span>
                  <span className="ml-auto flex gap-1">
                    <Link href={`/marketing/campaign/${c.id}`} className="rounded-full bg-paper px-3 py-1.5 text-[11px] font-medium text-ink-2 shadow-(--shadow-pill) hover:text-ink">
                      {canWrite ? t("mkt.edit") : "···"}
                    </Link>
                    {canWrite && (
                      <Pill variant="ghost" size="xs" onClick={() => setConfirming(confirming === c.id ? null : c.id)}>
                        ⋯
                      </Pill>
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label={t("mkt.statSent")} value={s.delivered ?? s.recipients} />
                  <Stat label={t("mkt.statOpened")} value={s.opened} />
                  <Stat label={t("mkt.statOrders")} value={s.orders} />
                  <Stat label={t("mkt.statRevenue")} value={s.revenue_cents} format={(v) => euro(v, lang)} />
                </div>
                {confirming === c.id && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                    <span className="text-[11px] text-alert">{t("mkt.campaignDeleteConfirm", { n: c.name })}</span>
                    <Pill variant="alert" size="xs" onClick={() => void remove(c)}>
                      {t("mkt.delete")}
                    </Pill>
                    <Pill variant="ghost" size="xs" onClick={() => setConfirming(null)}>
                      {t("web.cancel")}
                    </Pill>
                  </div>
                )}
              </div>
            );
          })}
          {canWrite && (
            <Link
              href="/marketing/campaign/new"
              className="rounded-[14px] border border-dashed border-line-3 bg-field-2 py-2.5 text-center text-[12px] font-extrabold text-orange transition-micro hover:border-orange-line"
            >
              {t("mkt.newCampaignWizard")}
            </Link>
          )}
        </div>
      )}
    </Section>
  );
}

function Stat({ label, value, format }: { label: string; value: number | null; format?: (v: number) => string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] bg-paper px-2.5 py-2">
      <span className="label-caps">{label}</span>
      <span className={`text-[14px] font-extrabold ${value == null ? "text-muted" : ""}`}>
        {value == null ? "—" : format ? format(value) : value}
      </span>
    </div>
  );
}
