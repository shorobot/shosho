"use client";

// BO · Kampagne — the campaign wizard (§8.1, §8.2).
//
// THE TWO THINGS THIS SCREEN MUST NOT GET WRONG:
//
// 1. ONE IMPLEMENTATION FOR THE COUNT AND THE SEND. Every recipient figure on this screen comes
//    from `resolve_segment(segment, channel)` with the campaign's OWN channel — never a default,
//    never a client-side re-implementation of the segment filters. §8.2 made `channel` a required
//    argument precisely so "I forgot to say which channel" is a syntax error rather than a silently
//    too-broad answer, and the same call is what a sender would use. Switching channel re-resolves.
//
// 2. "SENDEN" IS DISABLED AND SAYS WHY. There is no sender (S5 has never started), no push
//    subscription store anywhere in the repo, and email is blocked on SMTP (D-017). On top of that
//    `campaign_recipients` has NO insert policy for any role (§8.1), so this app could not create the
//    rows a send needs even if it tried. A draft and a schedule are real and are saved; sending is
//    not, and the tooltip names the missing piece instead of pretending.
//
// WHAT THIS SCREEN CANNOT SAY, and does not: the design's "141 Empfänger · 118 mit Einwilligung".
// `resolve_segment` applies consent FIRST and unconditionally, so it never returns the
// without-consent number — asking it for 141 is asking it to be looser, which is the one thing it
// is built not to be. The alternative, re-deriving the segment client-side, would be the second
// implementation §8.2 exists to prevent. So the panel shows the reachable figure, the push/email
// split inside it, and states the missing denominator with its reason. Filed to S0 as a contract
// request rather than worked around.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/EnvProvider";
import { NumberField, Row, Section, Switch, TextArea, TextField } from "@/components/menu/Fields";
import { Badge } from "@/components/ui/Badge";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { Pill, PillLink } from "@/components/ui/Pill";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import { fullDateTime } from "@/lib/datetime";
import { useI18n, type Key } from "@/lib/i18n";
import {
  BODY_MAX, TITLE_MAX, canSend, messageOf, messageToJson, reachOf, reachableOn, segmentOf, segmentToJson,
  sendBlockers, statsOf, validateCampaign, SEGMENT_PRESETS, presetFor,
  type CampaignChannel, type CampaignRow, type Message, type Reach, type Segment,
} from "@/lib/marketing";
import { run, useMarketing } from "@/lib/marketingStore";
import { euro } from "@/lib/money";
import { toast } from "@/lib/toast";
import type { Json } from "@/lib/types";
import { wrote } from "@/lib/write";

const CHANNELS: CampaignChannel[] = ["push", "email", "both"];
type Timing = "now" | "scheduled";

export function CampaignWizard({ campaign }: { campaign: CampaignRow | null }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const supabase = useSupabase();
  const { campaigns, canWrite, customerCount, resolveSegment, reload } = useMarketing();

  const [name, setName] = useState(campaign?.name ?? "");
  const [channel, setChannel] = useState<CampaignChannel>(campaign?.channel ?? "push");
  const [segment, setSegment] = useState<Segment>(() => (campaign ? segmentOf(campaign.segment) : {}));
  const [de, setDe] = useState<Message>(() => (campaign ? messageOf(campaign.message_de) : {}));
  const [en, setEn] = useState<Message>(() => (campaign ? messageOf(campaign.message_en) : {}));
  const [timing, setTiming] = useState<Timing>(campaign?.scheduled_for ? "scheduled" : "now");
  const [scheduledFor, setScheduledFor] = useState<string | null>(campaign?.scheduled_for ?? null);
  const [msgLang, setMsgLang] = useState<"de" | "en">("de");
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const [reach, setReach] = useState<Reach | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveFailed, setResolveFailed] = useState(false);

  const ro = !canWrite;
  const preset = presetFor(segment);
  const blockers = sendBlockers(channel);
  const problems = validateCampaign({ name, message_de: de });

  // One resolve per (segment, channel) pair. The segment is serialised so a re-render with an equal
  // object does not re-query, and a channel switch always does.
  const segmentKey = JSON.stringify(segmentToJson(segment));
  const resolve = useCallback(async () => {
    setResolving(true);
    setResolveFailed(false);
    const rows = await resolveSegment(lang, JSON.parse(segmentKey) as Segment, channel);
    setResolving(false);
    if (rows == null) {
      setResolveFailed(true);
      setReach(null);
      return;
    }
    setReach(reachOf(rows));
  }, [resolveSegment, lang, segmentKey, channel]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const lastSent = useMemo(
    () => campaigns.filter((c) => c.status === "sent" && c.sent_at).sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))[0] ?? null,
    [campaigns],
  );

  async function save(status: "draft" | "scheduled") {
    if (problems.length) {
      setShowErrors(true);
      return toast(
        problems.includes("name") ? t("mkt.wizNameRequired") : problems.includes("title_de") ? t("mkt.wizTitleRequired") : t("mkt.wizBodyRequired"),
      );
    }
    if (status === "scheduled" && !scheduledFor) {
      setShowErrors(true);
      return toast(t("mkt.wizScheduleRequired"));
    }
    setBusy(true);
    const payload = {
      name: name.trim(),
      channel,
      segment: segmentToJson(segment) as Json,
      message_de: messageToJson(de) as Json,
      message_en: messageToJson(en) as Json,
      status,
      scheduled_for: status === "scheduled" ? scheduledFor : null,
    };
    const res = campaign
      ? await run(lang, () => supabase.from("campaigns").update(payload).eq("id", campaign.id).select("id"))
      : await run(lang, () => supabase.from("campaigns").insert(payload).select("id"));
    setBusy(false);
    if (res == null) return;
    if (!wrote(res)) return toast(t("web.writeNoop"));
    await reload();
    toast(t("mkt.saved"), "ok");
    router.push("/marketing");
  }

  const reachable = reach ? reachableOn(reach, channel) : null;

  return (
    <div className="screen-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/marketing" className="flex h-8 w-8 items-center justify-center rounded-full bg-field text-[14px] text-ink-2" aria-label={t("mkt.wizBack")}>
          ‹
        </Link>
        <h1 className="text-[22px] font-extrabold leading-[1.2]">{t("mkt.wizTitle")}</h1>
        {campaign && <Badge tone="muted">{t(`mkt.cstate.${campaign.status}` as Key)}</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title={`1 · ${t("mkt.wizStep1")}`}>
            <Row cols={1}>
              <TextField
                label={t("mkt.wizName")}
                value={name}
                disabled={ro}
                placeholder={t("mkt.wizNamePlaceholder")}
                error={showErrors && problems.includes("name") ? t("mkt.wizNameRequired") : undefined}
                onChange={setName}
              />
            </Row>
            <div className="flex flex-wrap gap-1.5">
              {SEGMENT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={ro}
                  aria-pressed={preset === p.id}
                  onClick={() => setSegment(p.segment)}
                  className={`rounded-full px-3 py-1.5 text-[11px] leading-[1.3] transition-micro ${preset === p.id ? "bg-ink font-extrabold text-cream" : "bg-field font-medium text-ink-2 hover:text-ink"}`}
                >
                  {t(`mkt.seg.${p.id}` as Key)}
                </button>
              ))}
            </div>
            <SegmentFields segment={segment} setSegment={setSegment} disabled={ro} />
            <ReachPanel
              reach={reach}
              reachable={reachable}
              resolving={resolving}
              failed={resolveFailed}
              channel={channel}
              customerCount={customerCount}
              onRetry={resolve}
            />
          </Section>

          <Section title={`2 · ${t("mkt.wizStep2")}`}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {CHANNELS.map((c) => {
                const on = channel === c;
                // The per-channel figure comes from the SAME resolved rows, so comparing channels
                // can never show two numbers produced by two different queries.
                const n = reach ? reachableOn(reach, c) : null;
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={ro}
                    aria-pressed={on}
                    onClick={() => setChannel(c)}
                    className={`flex flex-col items-start gap-1 rounded-[14px] px-3.5 py-3 text-left transition-micro ${on ? "bg-ink text-cream" : "bg-field-2 text-ink-2 hover:text-ink"}`}
                  >
                    <span className="text-[13px] font-extrabold">{t(`mkt.channel.${c}` as Key)}</span>
                    <span className={`text-[11px] ${on ? "text-sky" : "text-muted"}`}>{n == null ? "—" : t("mkt.chanReach", { n })}</span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section
            title={`3 · ${t("mkt.wizStep3")}`}
            right={
              <div className="flex gap-1">
                {(["de", "en"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={msgLang === l}
                    onClick={() => setMsgLang(l)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-[0.06em] ${msgLang === l ? "bg-ink text-cream" : "bg-field text-ink-2"}`}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            }
          >
            <MessageFields
              message={msgLang === "de" ? de : en}
              setMessage={msgLang === "de" ? setDe : setEn}
              disabled={ro}
              titleError={showErrors && msgLang === "de" && problems.includes("title_de") ? t("mkt.wizTitleRequired") : undefined}
              bodyError={showErrors && msgLang === "de" && problems.includes("body_de") ? t("mkt.wizBodyRequired") : undefined}
            />
            {msgLang === "en" && <span className="text-[11px] leading-[1.45] text-muted">{t("mkt.msgEnHint")}</span>}
          </Section>

          <Section title={`4 · ${t("mkt.wizStep4")}`}>
            <div className="flex flex-wrap gap-1.5">
              {(["now", "scheduled"] as Timing[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={ro}
                  aria-pressed={timing === v}
                  onClick={() => setTiming(v)}
                  className={`rounded-full px-3 py-1.5 text-[11px] transition-micro ${timing === v ? "bg-ink font-extrabold text-cream" : "bg-field font-medium text-ink-2 hover:text-ink"}`}
                >
                  {v === "now" ? t("mkt.timingNow") : t("mkt.timingScheduled")}
                </button>
              ))}
              {/* "Bester Zeitpunkt" from the canvas needs past open rates, which need a sender. */}
              <span className="rounded-full bg-field px-3 py-1.5 text-[11px] text-muted" title={t("mkt.timingBestUnavailable")}>
                {t("mkt.timingBest")} · {t("mkt.unavailable")}
              </span>
            </div>
            {timing === "scheduled" && (
              <Row cols={2}>
                <DateTimeField
                  label={t("mkt.timingAt")}
                  value={scheduledFor}
                  disabled={ro}
                  error={showErrors && !scheduledFor ? t("mkt.wizScheduleRequired") : undefined}
                  onChange={setScheduledFor}
                />
              </Row>
            )}
            <span className="text-[11px] leading-[1.45] text-muted">{t("mkt.timingBestUnavailable")}</span>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section title={t("mkt.preview")}>
            <PushPreview message={msgLang === "de" ? de : en} />
          </Section>

          <Section title={t("mkt.wizStep5")}>
            <div className="flex flex-col gap-2">
              <span className="label-caps">{t("mkt.lastCampaign")}</span>
              {lastSent ? (
                <span className="text-[12px] leading-[1.5] text-ink-3">
                  {t("mkt.lastCampaignStats", {
                    n: lastSent.name,
                    s: statsOf(lastSent.stats).delivered ?? "—",
                    o: statsOf(lastSent.stats).opened ?? "—",
                    r: statsOf(lastSent.stats).orders ?? "—",
                    v: statsOf(lastSent.stats).revenue_cents == null ? "—" : euro(statsOf(lastSent.stats).revenue_cents, lang),
                  })}
                </span>
              ) : (
                <span className="text-[12px] text-muted">{t("mkt.lastCampaignNone")}</span>
              )}
            </div>

            {canWrite && (
              <div className="flex flex-col gap-2">
                <Pill size="sm" onClick={() => void save("draft")} disabled={busy}>
                  {t("mkt.saveDraft")}
                </Pill>
                <Pill variant="ink" size="sm" onClick={() => void save("scheduled")} disabled={busy || timing !== "scheduled"}>
                  {t("mkt.saveScheduled")}
                </Pill>
                {/* The honest send button: disabled, with every missing piece named in the tooltip. */}
                <span
                  title={t("mkt.sendDisabled", { r: blockers.map((b) => t(`mkt.blocker.${b}` as Key)).join("; ") })}
                  className="inline-flex"
                >
                  <Pill size="sm" disabled className="w-full opacity-45" aria-disabled>
                    {t("mkt.send")}
                  </Pill>
                </span>
                {!canSend(channel) && (
                  <ErrorState
                    tone="warn"
                    title={t("mkt.sendDisabled", { r: blockers.map((b) => t(`mkt.blocker.${b}` as Key)).join("; ") })}
                    body={t("mkt.sendHonest")}
                  />
                )}
              </div>
            )}
            {campaign?.scheduled_for && (
              <span className="text-[11px] text-ink-3">{t("mkt.scheduledOn", { d: fullDateTime(campaign.scheduled_for, lang) })}</span>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ segment fields (§8.2 shape) */

function SegmentFields({ segment, setSegment, disabled }: { segment: Segment; setSegment: (s: Segment) => void; disabled: boolean }) {
  const { t } = useI18n();
  const set = <K extends keyof Segment>(k: K, v: Segment[K]) => {
    const next = { ...segment };
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) delete next[k];
    else next[k] = v;
    setSegment(next);
  };
  return (
    <div className="flex flex-col gap-3">
      <Row cols={4}>
        <NumberField label={t("mkt.segMinOrders")} value={segment.min_orders ?? null} disabled={disabled} onChange={(v) => set("min_orders", v ?? undefined)} />
        <NumberField label={t("mkt.segMaxOrders")} value={segment.max_orders ?? null} disabled={disabled} onChange={(v) => set("max_orders", v ?? undefined)} />
        <NumberField label={t("mkt.segMinSilent")} value={segment.min_days_silent ?? null} disabled={disabled} onChange={(v) => set("min_days_silent", v ?? undefined)} />
        <NumberField label={t("mkt.segMaxSilent")} value={segment.max_days_silent ?? null} disabled={disabled} onChange={(v) => set("max_days_silent", v ?? undefined)} />
      </Row>
      <Row cols={2}>
        <NumberField label={t("mkt.segCreatedWithin")} value={segment.created_within_days ?? null} disabled={disabled} onChange={(v) => set("created_within_days", v ?? undefined)} />
        <TextField
          label={t("mkt.segTags")}
          value={(segment.tags ?? []).join(", ")}
          disabled={disabled}
          onChange={(v) => set("tags", v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))}
        />
      </Row>
      <Switch
        checked={segment.is_company === true}
        disabled={disabled}
        onChange={(v) => set("is_company", v ? true : undefined)}
        label={t("mkt.segCompany")}
      />
      <TextArea
        label={t("mkt.segIds")}
        rows={2}
        disabled={disabled}
        value={(segment.customer_ids ?? []).join("\n")}
        onChange={(v) => set("customer_ids", v.split(/\s+/).map((s) => s.trim()).filter(Boolean))}
      />
      <span className="text-[11px] text-muted">{t("mkt.segIdsHint")}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ the reach panel */

function ReachPanel({
  reach, reachable, resolving, failed, channel, customerCount, onRetry,
}: {
  reach: Reach | null;
  reachable: number | null;
  resolving: boolean;
  failed: boolean;
  channel: CampaignChannel;
  customerCount: number | null;
  onRetry: () => Promise<void>;
}) {
  const { t } = useI18n();
  const channelLabel = t(`mkt.channel.${channel}` as Key);

  if (resolving) return <Spinner label={t("mkt.reachLoading")} />;
  if (failed) {
    return (
      <ErrorState
        title={t("mkt.reachZero")}
        body={t("mkt.reachBasis")}
        actions={
          <Pill size="xs" variant="ghost" onClick={() => void onRetry()}>
            {t("web.save")}
          </Pill>
        }
      />
    );
  }
  if (!reach || reachable === 0) {
    return (
      <EmptyState
        icon="☻"
        title={t("mkt.reachEmptyTitle")}
        body={t("mkt.reachEmptyBody", { c: channelLabel })}
        action={<PillLink size="sm" href="/customers">{t("mkt.reachEmptyCta")}</PillLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] bg-orange-tint p-3.5">
      <span className="text-[15px] font-extrabold">{t("mkt.reachCount", { n: reachable ?? 0, c: channelLabel })}</span>
      <span className="text-[12px] leading-[1.5] text-ink-3">
        {t("mkt.reachSplit", { p: reach.withPush, e: reach.withEmail, b: reach.withBoth })}
      </span>
      <span className="text-[11px] leading-[1.45] text-muted">{t("mkt.reachBasis")}</span>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] font-extrabold text-orange-ink">{t("mkt.reachDenominatorTitle")}</summary>
        <span className="mt-1 block text-[11px] leading-[1.5] text-ink-3">
          {t("mkt.reachDenominatorBody", { n: customerCount ?? "—" })}
        </span>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ message + preview */

function MessageFields({
  message, setMessage, disabled, titleError, bodyError,
}: {
  message: Message;
  setMessage: (m: Message) => void;
  disabled: boolean;
  titleError?: string;
  bodyError?: string;
}) {
  const { t } = useI18n();
  const title = message.title ?? "";
  const body = message.body ?? "";
  return (
    <div className="flex flex-col gap-3">
      <TextField
        label={`${t("mkt.msgTitle")} · ${t("mkt.msgCount", { n: title.length, m: TITLE_MAX })}`}
        value={title}
        disabled={disabled}
        error={titleError ?? (title.length > TITLE_MAX ? t("mkt.msgTooLong", { m: TITLE_MAX }) : undefined)}
        onChange={(v) => setMessage({ ...message, title: v })}
      />
      <TextArea
        label={`${t("mkt.msgBody")} · ${t("mkt.msgCount", { n: body.length, m: BODY_MAX })}`}
        value={body}
        rows={3}
        disabled={disabled}
        onChange={(v) => setMessage({ ...message, body: v })}
      />
      {(bodyError ?? (body.length > BODY_MAX ? t("mkt.msgTooLong", { m: BODY_MAX }) : null)) && (
        <span className="text-[11px] font-extrabold text-alert">{bodyError ?? t("mkt.msgTooLong", { m: BODY_MAX })}</span>
      )}
      <TextField
        label={t("mkt.msgDeepLink")}
        value={message.deep_link ?? ""}
        disabled={disabled}
        hint={t("mkt.msgDeepLinkHint")}
        onChange={(v) => setMessage({ ...message, deep_link: v })}
      />
    </div>
  );
}

function PushPreview({ message }: { message: Message }) {
  const { t } = useI18n();
  if (!message.title?.trim() && !message.body?.trim()) {
    return <span className="text-[12px] text-muted">{t("mkt.previewEmpty")}</span>;
  }
  return (
    <div className="flex flex-col gap-2 rounded-[16px] bg-ink p-3.5">
      <span className="label-caps text-nav-muted">
        {t("mkt.previewNow")} · {new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date())}
      </span>
      <div className="flex gap-2.5 rounded-[12px] bg-nav p-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[8px] bg-orange text-[10px] font-extrabold text-white">SH</span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] font-extrabold tracking-[0.08em] text-sky">SHOSHO</span>
          <span className="text-[12px] font-extrabold leading-[1.3] text-cream">{message.title}</span>
          <span className="text-[11px] leading-[1.45] text-nav-text">{message.body}</span>
        </div>
      </div>
    </div>
  );
}
