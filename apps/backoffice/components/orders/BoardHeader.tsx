"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { PhoneOrderDialog } from "@/components/orders/PhoneOrderDialog";
import { Pill, PillLink } from "@/components/ui/Pill";
import { kitchenPause, setRush } from "@/lib/actions";
import { useI18n } from "@/lib/i18n";
import type { Json } from "@/lib/types";
import { setSoundEnabled, soundEnabled } from "@/lib/sound";
import { useOrders } from "@/lib/store";
import { headerDate } from "@/lib/time";
import { toast } from "@/lib/toast";

/** Bestellungen header: online/pause, prep time, rush, sound, phone order (api-contracts §6.1). */
export function BoardHeader() {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { me, settings, reloadSettings, now } = useOrders();
  const [sound, setSound] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSound(soundEnabled()), []);

  const paused = Boolean(settings.kitchen.paused ?? settings.kitchenStatus.paused);
  const rush = Boolean(settings.kitchen.rush);
  const prep = settings.ops.prep_default_min ?? 22;
  const rushExtra = settings.ops.rush_extra_min ?? 15;
  const isOwner = me.role === "owner";
  const canPause = me.role === "owner" || me.role === "operator";

  async function togglePause() {
    setBusy(true);
    const err = await kitchenPause(supabase, !paused);
    if (err) toast(err.code === "forbidden" ? t("error.forbidden") : t("error.action", { m: err.message }));
    await reloadSettings();
    setBusy(false);
  }

  async function toggleRush() {
    setBusy(true);
    const err = await setRush(supabase, settings.kitchen as Record<string, Json>, !rush);
    if (err) toast(err.code === "forbidden" ? t("error.forbidden") : t("error.action", { m: err.message }));
    await reloadSettings();
    setBusy(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3.5">
      <div className="flex items-baseline gap-3">
        <h1>{t("board.title")}</h1>
        <span className="text-[13px] font-medium text-muted">{t("shell.today", { d: headerDate(now, lang) })}</span>
      </div>

      <div className="flex items-center gap-2 rounded-full bg-paper py-1.5 pl-3.5 pr-2 shadow-(--shadow-pill)">
        <span className={`h-2 w-2 rounded-full ${paused ? "bg-alert pulse-dot" : "bg-ok"}`} />
        <span className="whitespace-nowrap text-[12px] font-extrabold">{paused ? t("board.paused") : t("board.online")}</span>
        <button
          type="button"
          onClick={togglePause}
          disabled={!canPause || busy}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-micro ${paused ? "bg-orange text-white font-extrabold" : "bg-field text-muted hover:text-ink"}`}
        >
          {paused ? t("board.goOnline") : t("board.pause")}
        </button>
      </div>

      <div className="flex items-center gap-2 whitespace-nowrap rounded-full bg-paper px-3.5 py-2 text-[12px] font-medium shadow-(--shadow-pill)">
        <span className="text-muted">{t("board.prep")}</span>
        <span className="font-extrabold">{t("board.prepMin", { n: prep })}</span>
      </div>

      <button
        type="button"
        onClick={toggleRush}
        disabled={!isOwner || busy}
        title={isOwner ? undefined : t("error.forbidden")}
        className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-[12px] font-extrabold transition-micro ${rush ? "border-orange-line bg-orange-tint text-orange-ink" : "border-line-2 bg-paper text-muted"} ${isOwner ? "" : "cursor-default opacity-80"}`}
        aria-pressed={rush}
      >
        {rush ? t("board.rush", { n: rushExtra }) : t("board.rushOff")}
      </button>

      <div className="ml-auto flex flex-none items-center gap-2.5">
        <button
          type="button"
          aria-pressed={sound}
          title={sound ? t("board.soundOn") : t("board.soundOff")}
          onClick={() => {
            const next = !sound;
            setSound(next);
            setSoundEnabled(next);
          }}
          className={`flex h-[38px] w-[38px] items-center justify-center rounded-full text-[14px] shadow-(--shadow-pill) transition-micro ${sound ? "bg-orange text-white" : "bg-paper text-muted"}`}
        >
          ♪
        </button>
        <PillLink href="/orders/history" variant="ghost" size="sm">
          {t("board.tabHistory")}
        </PillLink>
        <Pill variant="ink" onClick={() => setPhoneOpen(true)}>
          {t("board.phoneOrder")}
        </Pill>
      </div>

      <PhoneOrderDialog open={phoneOpen} onClose={() => setPhoneOpen(false)} />
    </div>
  );
}
