// Pure logic for BO · Marketing and the Kampagne wizard (api-contracts §8.1–§8.4, §1.5).
// No React, no Supabase — the arithmetic an operator judges a promotion by, and the honesty rules
// about what this screen may and may not claim, are covered by tests/marketing.test.ts.
import type { Json, Tables } from "@/lib/types";

export type PromoRow = Tables["promo_codes"]["Row"];
export type CampaignRow = Tables["campaigns"]["Row"];
export type AutomationRow = Tables["automations"]["Row"];
export type AutomationRunRow = Tables["automation_runs"]["Row"];

export type PromoKind = PromoRow["kind"];
export type CampaignChannel = CampaignRow["channel"];
export type CampaignStatus = CampaignRow["status"];
export type AutomationKind = AutomationRow["kind"];

/* ------------------------------------------------------------------ promo codes (§1.5) */

export const PROMO_SCOPES = ["all", "category", "first_order"] as const;
export type PromoScope = (typeof PROMO_SCOPES)[number];

export type AppliesTo = {
  scope?: PromoScope;
  category_id?: string;
  /** ISO weekdays 1..7 (Mon..Sun), as §1.5 documents the column. */
  days?: number[];
  /** "HH:MM" — the code only applies before this time of day. */
  until?: string;
};

export function appliesTo(value: Json): AppliesTo {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { scope: "all" };
  const v = value as Record<string, Json>;
  const scope = typeof v.scope === "string" && (PROMO_SCOPES as readonly string[]).includes(v.scope) ? (v.scope as PromoScope) : "all";
  return {
    scope,
    category_id: typeof v.category_id === "string" ? v.category_id : undefined,
    days: Array.isArray(v.days) ? v.days.filter((d): d is number => typeof d === "number" && d >= 1 && d <= 7) : undefined,
    until: typeof v.until === "string" ? v.until : undefined,
  };
}

/**
 * Why a code does or does not work right now. `exhausted` is deliberately its own state and not
 * folded into `expired`: the design dims an exhausted code and puts its used counter in the alert
 * colour, which is a different operator decision (raise the limit) from a lapsed date (extend it).
 */
export type PromoState = "live" | "scheduled" | "expired" | "exhausted" | "inactive";

export function promoState(code: Pick<PromoRow, "active" | "valid_from" | "valid_to" | "used_count" | "usage_limit">, now: Date): PromoState {
  if (!code.active) return "inactive";
  if (code.usage_limit != null && code.used_count >= code.usage_limit) return "exhausted";
  const t = now.getTime();
  if (code.valid_from && new Date(code.valid_from).getTime() > t) return "scheduled";
  if (code.valid_to && new Date(code.valid_to).getTime() < t) return "expired";
  return "live";
}

/** "312 / 1 000" or "184 / ∞" — the design's GENUTZT column. */
export function usageLabel(code: Pick<PromoRow, "used_count" | "usage_limit">, lang: "de" | "en"): string {
  const fmt = (n: number) => new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB").format(n);
  return `${fmt(code.used_count)} / ${code.usage_limit == null ? "∞" : fmt(code.usage_limit)}`;
}

/** How far through its limit a code is, 0..1 — null when there is no limit to be through. */
export function usageFraction(code: Pick<PromoRow, "used_count" | "usage_limit">): number | null {
  if (code.usage_limit == null || code.usage_limit <= 0) return null;
  return Math.min(1, code.used_count / code.usage_limit);
}

export function normaliseCode(raw: string): string {
  // The column has `check (code = upper(code))`, so lowercasing is a constraint violation, not a
  // style preference — normalise before the insert rather than surfacing a Postgres error.
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export type PromoProblem = "code" | "value";

/** The two ways the form can produce a row the CHECK constraints would refuse. */
export function validatePromo(draft: { code: string; kind: PromoKind; value: number | null }): PromoProblem[] {
  const problems: PromoProblem[] = [];
  if (!normaliseCode(draft.code)) problems.push("code");
  const v = draft.value;
  if (v == null || v <= 0) problems.push("value");
  else if (draft.kind === "percent" && v > 100) problems.push("value");
  return problems;
}

/* ------------------------------------------------------------------ segments (§8.2) */

/** The `segment` jsonb shape §8.2 documents. Every key optional; `{}` matches everyone consented. */
export type Segment = {
  tags?: string[];
  is_company?: boolean;
  min_orders?: number;
  max_orders?: number;
  min_days_silent?: number;
  max_days_silent?: number;
  created_within_days?: number;
  customer_ids?: string[];
};

export type SegmentPresetId = "all" | "regulars" | "new_this_month" | "sleeping" | "companies" | "manual";

/** The CRM's four tiles (design: BO · Kunden) expressed in §8.2's own keys, plus "everyone". */
export const SEGMENT_PRESETS: { id: SegmentPresetId; segment: Segment }[] = [
  { id: "all", segment: {} },
  { id: "regulars", segment: { min_orders: 3 } },
  { id: "new_this_month", segment: { created_within_days: 30 } },
  { id: "sleeping", segment: { min_days_silent: 60 } },
  { id: "companies", segment: { is_company: true } },
  { id: "manual", segment: { customer_ids: [] } },
];

export function segmentOf(value: Json): Segment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const v = value as Record<string, Json>;
  const nums = (k: keyof Segment) => (typeof v[k] === "number" ? (v[k] as number) : undefined);
  const strs = (k: keyof Segment) => (Array.isArray(v[k]) ? (v[k] as Json[]).filter((x): x is string => typeof x === "string") : undefined);
  return {
    tags: strs("tags"),
    is_company: typeof v.is_company === "boolean" ? v.is_company : undefined,
    min_orders: nums("min_orders"),
    max_orders: nums("max_orders"),
    min_days_silent: nums("min_days_silent"),
    max_days_silent: nums("max_days_silent"),
    created_within_days: nums("created_within_days"),
    customer_ids: strs("customer_ids"),
  };
}

/** Drop the undefined keys so the stored jsonb carries only what was actually chosen. */
export function segmentToJson(s: Segment): Json {
  const out: Record<string, Json> = {};
  if (s.tags && s.tags.length) out.tags = s.tags;
  if (s.is_company !== undefined) out.is_company = s.is_company;
  if (s.min_orders !== undefined) out.min_orders = s.min_orders;
  if (s.max_orders !== undefined) out.max_orders = s.max_orders;
  if (s.min_days_silent !== undefined) out.min_days_silent = s.min_days_silent;
  if (s.max_days_silent !== undefined) out.max_days_silent = s.max_days_silent;
  if (s.created_within_days !== undefined) out.created_within_days = s.created_within_days;
  if (s.customer_ids && s.customer_ids.length) out.customer_ids = s.customer_ids;
  return out;
}

export function presetFor(segment: Segment): SegmentPresetId | null {
  const target = JSON.stringify(segmentToJson(segment));
  for (const p of SEGMENT_PRESETS) {
    if (p.id === "manual") continue;
    if (JSON.stringify(segmentToJson(p.segment)) === target) return p.id;
  }
  return segment.customer_ids && segment.customer_ids.length ? "manual" : null;
}

/* ------------------------------------------------------------------ the recipient count (§8.2) */

/** One row of `resolve_segment(segment, channel)`. */
export type ResolvedRecipient = { customer_id: string; has_email_consent: boolean; has_push_consent: boolean };

/**
 * What the wizard can honestly say about reach, and what it cannot.
 *
 * `resolve_segment` applies consent and `anonymised_at is null` FIRST and unconditionally (§8.2),
 * so **every row it returns is already consented for the channel asked about**. The count and the
 * real send therefore use the same call with the campaign's own channel — which is the property
 * §8.2 exists to guarantee — but it also means the function cannot report the design's "141
 * Empfänger · 118 mit Einwilligung" pair: the 141 does not exist in any single answer it gives.
 *
 * So this returns the decomposition the function DOES support — reachable for the chosen channel,
 * and the push/email/both split inside it — and the screen states the rest as unavailable with the
 * reason instead of inventing a denominator. Filed as a contract request.
 */
export type Reach = {
  /** Rows `resolve_segment` returned for the campaign's own channel — who would actually be sent to. */
  reachable: number;
  /** Of those, how many carry each consent. A 'both' campaign is where these differ from `reachable`. */
  withPush: number;
  withEmail: number;
  withBoth: number;
  /** Reachable by the OTHER channel only — the people a channel switch would gain or lose. */
  pushOnly: number;
  emailOnly: number;
};

export function reachOf(rows: ResolvedRecipient[]): Reach {
  let withPush = 0;
  let withEmail = 0;
  let withBoth = 0;
  for (const r of rows) {
    if (r.has_push_consent) withPush++;
    if (r.has_email_consent) withEmail++;
    if (r.has_push_consent && r.has_email_consent) withBoth++;
  }
  return {
    reachable: rows.length,
    withPush,
    withEmail,
    withBoth,
    pushOnly: withPush - withBoth,
    emailOnly: withEmail - withBoth,
  };
}

/**
 * Who a send on `channel` would actually reach out of a resolved set. For a `both` campaign the
 * resolver returns everyone with EITHER consent, so the per-channel figures below are the ones that
 * matter when the operator compares channels — and they come from the same rows, never a second
 * query that could disagree.
 */
export function reachableOn(reach: Reach, channel: CampaignChannel): number {
  switch (channel) {
    case "push":
      return reach.withPush;
    case "email":
      return reach.withEmail;
    case "both":
      return reach.reachable;
  }
}

/* ------------------------------------------------------------------ what cannot send yet */

/**
 * Every reason "Senden" is disabled, each naming one missing piece. Nothing here is a soft warning:
 * with no sender at all, a send button that queued rows would produce a campaign that silently
 * never goes out.
 *   · `no_sender`     — S5 Automation has never started; `claim_campaign_recipients` is service_role
 *                       only (§8.3) and has no worker, so nothing drains `campaign_recipients`.
 *   · `no_push_store` — there is no push subscription store anywhere in the repo (D-016): a push
 *                       campaign has no address to send to even once a sender exists.
 *   · `no_smtp`       — D-017: Supabase's built-in relay caps at 2 emails/hour project-wide, so the
 *                       email channel waits for the owner's SMTP provider.
 * Also: `campaign_recipients` has no insert policy for any role (§8.1) — staff are read-only there —
 * so this app could not create the rows a send needs even if it wanted to.
 */
export type SendBlocker = "no_sender" | "no_push_store" | "no_smtp";

export function sendBlockers(channel: CampaignChannel): SendBlocker[] {
  const out: SendBlocker[] = ["no_sender"];
  if (channel === "push" || channel === "both") out.push("no_push_store");
  if (channel === "email" || channel === "both") out.push("no_smtp");
  return out;
}

/** There is no channel that can send today; the button is disabled for every one of them. */
export function canSend(channel: CampaignChannel): boolean {
  return sendBlockers(channel).length === 0;
}

/** Scheduling is allowed — it records intent on a row S5 will read. Sending is not. */
export const SCHEDULING_IS_ALLOWED = true;

/* ------------------------------------------------------------------ campaign message */

export type Message = { title?: string; body?: string; deep_link?: string };

export function messageOf(value: Json): Message {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const v = value as Record<string, Json>;
  return {
    title: typeof v.title === "string" ? v.title : undefined,
    body: typeof v.body === "string" ? v.body : undefined,
    deep_link: typeof v.deep_link === "string" ? v.deep_link : undefined,
  };
}

export function messageToJson(m: Message): Json {
  const out: Record<string, Json> = {};
  if (m.title?.trim()) out.title = m.title.trim();
  if (m.body?.trim()) out.body = m.body.trim();
  if (m.deep_link?.trim()) out.deep_link = m.deep_link.trim();
  return out;
}

/** Push payload limits the preview holds the operator to (the design shows 40 / 140 counters). */
export const TITLE_MAX = 40;
export const BODY_MAX = 140;

export type CampaignProblem = "name" | "title_de" | "body_de";

/** What must be filled before a campaign can be saved as `scheduled` rather than `draft`. */
export function validateCampaign(draft: { name: string; message_de: Message }): CampaignProblem[] {
  const problems: CampaignProblem[] = [];
  if (!draft.name.trim()) problems.push("name");
  if (!draft.message_de.title?.trim()) problems.push("title_de");
  if (!draft.message_de.body?.trim()) problems.push("body_de");
  return problems;
}

/* ------------------------------------------------------------------ campaign stats (§8.1) */

export type Stats = {
  recipients: number | null;
  delivered: number | null;
  opened: number | null;
  orders: number | null;
  revenue_cents: number | null;
};

/**
 * `campaigns.stats` is written by whatever sends (S5), which does not exist — so every field is
 * null today and the UI must render "—" rather than 0. A 0 in the ORDERS column reads as "the
 * campaign sold nothing", which is a claim about the campaign; null reads as "not measured", which
 * is the truth.
 */
export function statsOf(value: Json): Stats {
  const v = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Json>) : {};
  const n = (k: string): number | null => (typeof v[k] === "number" ? (v[k] as number) : null);
  return { recipients: n("recipients"), delivered: n("delivered"), opened: n("opened"), orders: n("orders"), revenue_cents: n("revenue_cents") };
}

/** Open rate of one campaign, or null when either side is unmeasured. */
export function openRate(s: Stats): number | null {
  if (s.delivered == null || s.delivered <= 0 || s.opened == null) return null;
  return (s.opened / s.delivered) * 100;
}

/* ------------------------------------------------------------------ automations (§8.4) */

export const AUTOMATION_KINDS = ["welcome", "win_back_45d", "birthday", "review_after_delivery"] as const;

export type AutomationConfig = {
  delay_hours?: number;
  message_de?: string;
  message_en?: string;
  /** Percent off, matching the design's "Push mit 10 %" / "5 € nach der Registrierung". */
  discount?: number;
};

export function configOf(value: Json): AutomationConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const v = value as Record<string, Json>;
  return {
    delay_hours: typeof v.delay_hours === "number" ? v.delay_hours : undefined,
    message_de: typeof v.message_de === "string" ? v.message_de : undefined,
    message_en: typeof v.message_en === "string" ? v.message_en : undefined,
    discount: typeof v.discount === "number" ? v.discount : undefined,
  };
}

export function configToJson(c: AutomationConfig): Json {
  const out: Record<string, Json> = {};
  if (c.delay_hours !== undefined) out.delay_hours = c.delay_hours;
  if (c.message_de?.trim()) out.message_de = c.message_de.trim();
  if (c.message_en?.trim()) out.message_en = c.message_en.trim();
  if (c.discount !== undefined) out.discount = c.discount;
  return out;
}

/** Order the four kinds the way the design lists them, whatever order PostgREST returns. */
export function sortAutomations(rows: AutomationRow[]): AutomationRow[] {
  return [...rows].sort((a, b) => AUTOMATION_KINDS.indexOf(a.kind) - AUTOMATION_KINDS.indexOf(b.kind));
}

/* ------------------------------------------------------------------ KPIs (task 9) */

/** The slice of an order the marketing KPIs need — nothing else is read from `orders`. */
export type MarketingOrder = {
  created_at: string;
  status: string;
  total_cents: number;
  discount_cents: number;
  promo_code: string | null;
};

const COMPLETED = new Set(["delivered", "picked_up"]);

/**
 * A KPI is either a number or a stated reason there is no number. Rendering an unavailable KPI as
 * `0` is the specific dishonesty task 9 forbids: "0 €" from promotions and "no sender exists" are
 * different facts and an owner would act differently on each.
 */
export type Kpi = { value: number; unit: "cents" | "count" | "pct" } | { unavailable: KpiReason };
export type KpiReason = "no_sender" | "no_orders";

export function isAvailable(k: Kpi): k is { value: number; unit: "cents" | "count" | "pct" } {
  return "value" in k;
}

function inWindow(o: MarketingOrder, from: Date, to: Date): boolean {
  const t = new Date(o.created_at).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

/** Revenue of completed orders that carried a promo code — the design's UMSATZ AUS AKTIONEN. */
export function promoRevenue(orders: MarketingOrder[], from: Date, to: Date): Kpi {
  const rows = orders.filter((o) => inWindow(o, from, to) && COMPLETED.has(o.status));
  if (rows.length === 0) return { unavailable: "no_orders" };
  const cents = rows.filter((o) => o.promo_code).reduce((s, o) => s + o.total_cents, 0);
  return { value: cents, unit: "cents" };
}

/** Completed orders in the window that used a code — EINGELÖSTE CODES. */
export function codesRedeemed(orders: MarketingOrder[], from: Date, to: Date): Kpi {
  const rows = orders.filter((o) => inWindow(o, from, to) && COMPLETED.has(o.status));
  if (rows.length === 0) return { unavailable: "no_orders" };
  return { value: rows.filter((o) => o.promo_code).length, unit: "count" };
}

/**
 * RABATTQUOTE — the share of completed orders carrying a discount, which is what the design's own
 * caption says ("Anteil der Bestellungen mit Rabatt"), not discount as a share of revenue.
 */
export function discountRate(orders: MarketingOrder[], from: Date, to: Date): Kpi {
  const rows = orders.filter((o) => inWindow(o, from, to) && COMPLETED.has(o.status));
  if (rows.length === 0) return { unavailable: "no_orders" };
  return { value: (rows.filter((o) => o.discount_cents > 0).length / rows.length) * 100, unit: "pct" };
}

/**
 * PUSH-ÖFFNUNGSRATE. `campaigns.stats` is only ever written by a sender, and there is none — so
 * this KPI has no source at all and says so. It becomes real the moment S5 ships, with no UI change.
 */
export function pushOpenRate(campaigns: CampaignRow[]): Kpi {
  const rates = campaigns.map((c) => openRate(statsOf(c.stats))).filter((r): r is number => r != null);
  if (rates.length === 0) return { unavailable: "no_sender" };
  return { value: rates.reduce((a, b) => a + b, 0) / rates.length, unit: "pct" };
}

/** Discount rate per ISO weekday (1 = Mon), for the design's seven-bar chart. Null = no orders. */
export function discountRateByWeekday(orders: MarketingOrder[], from: Date, to: Date, tz = "Europe/Berlin"): (number | null)[] {
  const total = [0, 0, 0, 0, 0, 0, 0];
  const discounted = [0, 0, 0, 0, 0, 0, 0];
  const fmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: tz });
  const index: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  for (const o of orders) {
    if (!inWindow(o, from, to) || !COMPLETED.has(o.status)) continue;
    const i = index[fmt.format(new Date(o.created_at))];
    if (i === undefined) continue;
    total[i] = (total[i] ?? 0) + 1;
    if (o.discount_cents > 0) discounted[i] = (discounted[i] ?? 0) + 1;
  }
  return total.map((n, i) => (n === 0 ? null : ((discounted[i] ?? 0) / n) * 100));
}

export type BestPromo = { code: string; redemptions: number; revenueCents: number; discountCents: number; roi: number | null };

/**
 * BESTE AKTION, ranked by revenue. `roi` is revenue per euro of discount given away — null when a
 * code produced revenue with no recorded discount, because "infinite ROI" is not a figure to show.
 */
export function bestPromo(orders: MarketingOrder[], from: Date, to: Date): BestPromo | null {
  const byCode = new Map<string, BestPromo>();
  for (const o of orders) {
    if (!inWindow(o, from, to) || !COMPLETED.has(o.status) || !o.promo_code) continue;
    const key = o.promo_code.toUpperCase();
    const acc = byCode.get(key) ?? { code: key, redemptions: 0, revenueCents: 0, discountCents: 0, roi: null };
    acc.redemptions++;
    acc.revenueCents += o.total_cents;
    acc.discountCents += o.discount_cents;
    byCode.set(key, acc);
  }
  const rows = [...byCode.values()].map((r) => ({ ...r, roi: r.discountCents > 0 ? r.revenueCents / r.discountCents : null }));
  rows.sort((a, b) => b.revenueCents - a.revenueCents);
  return rows[0] ?? null;
}
