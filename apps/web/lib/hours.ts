// Opening-hours helpers for display and for offering pre-order slots. The server (quote_order)
// is the authority — this only decides what to show and which slots to offer.
import type { OpeningHours } from "./types";

export const TZ = "Europe/Berlin";
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type DayKey = (typeof DAY_KEYS)[number];
const DAY_LABEL_EN: Record<DayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const DAY_LABEL_DE: Record<DayKey, string> = { mon: "Mo", tue: "Di", wed: "Mi", thu: "Do", fri: "Fr", sat: "Sa", sun: "So" };

export type BerlinParts = { y: number; m: number; d: number; hh: number; mm: number; dow: number; date: string; time: string };

/** Wall-clock parts of `at` in Europe/Berlin. */
export function berlinParts(at: Date = new Date()): BerlinParts {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(at)) p[part.type] = part.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "Sun");
  const y = Number(p.year), m = Number(p.month), d = Number(p.day), hh = Number(p.hour) % 24, mm = Number(p.minute);
  return { y, m, d, hh, mm, dow, date: `${p.year}-${p.month}-${p.day}`, time: `${String(hh).padStart(2, "0")}:${p.minute}` };
}

/** UTC instant for a Europe/Berlin wall time ("2026-09-21", "19:30"). Handles DST via a two-pass offset. */
export function berlinToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t: number) => {
    const p = berlinParts(new Date(t));
    return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export function dayKey(dow: number): DayKey {
  return DAY_KEYS[dow] ?? "sun";
}

export function rangesFor(hours: OpeningHours | null | undefined, date: string, dow: number): [string, string][] {
  if (!hours) return [];
  if (hours.holidays?.includes(date)) return [];
  return hours[dayKey(dow)] ?? [];
}

/** Mirrors shop_open_at(): open iff now ∈ [from, to) of some range for today (Berlin). */
export function isOpenAt(hours: OpeningHours | null | undefined, at: Date = new Date()): boolean {
  if (!hours) return true;
  const p = berlinParts(at);
  const now = p.hh * 60 + p.mm;
  return rangesFor(hours, p.date, p.dow).some(([from, to]) => now >= toMin(from) && now < toMin(to));
}

function addDays(date: string, n: number): { date: string; dow: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { date: t.toISOString().slice(0, 10), dow: t.getUTCDay() };
}

/** Next opening moment as copy: { dayLabel: "tomorrow" | "Mon", time: "11:00" } or null when never open. */
export function nextOpening(hours: OpeningHours | null | undefined, at: Date = new Date()): { inDays: number; time: string } | null {
  if (!hours) return null;
  const p = berlinParts(at);
  const now = p.hh * 60 + p.mm;
  for (let i = 0; i < 8; i++) {
    const { date, dow } = addDays(p.date, i);
    const ranges = rangesFor(hours, date, dow)
      .map(([from]) => from)
      .filter((from) => i > 0 || toMin(from) > now)
      .sort((a, b) => toMin(a) - toMin(b));
    if (ranges[0]) return { inDays: i, time: ranges[0] };
  }
  return null;
}

export type Slot = { iso: string; label: string; date: string; time: string };

/**
 * Pre-order slots: every 30 min inside opening hours, ≥ 15 min ahead (server rule), for today and the
 * following days up to `maxDays` (server: ops.preorder_max_days, 7 in seed). Returns at most `limit`.
 */
export function upcomingSlots(hours: OpeningHours | null | undefined, opts: { at?: Date; maxDays?: number; limit?: number } = {}): Slot[] {
  const at = opts.at ?? new Date();
  const maxDays = opts.maxDays ?? 7;
  const limit = opts.limit ?? 6;
  if (!hours) return [];
  const p = berlinParts(at);
  const earliest = p.hh * 60 + p.mm + 15;
  const out: Slot[] = [];
  for (let i = 0; i <= maxDays && out.length < limit; i++) {
    const { date, dow } = addDays(p.date, i);
    for (const [from, to] of rangesFor(hours, date, dow)) {
      let m = Math.ceil(toMin(from) / 30) * 30;
      if (i === 0) m = Math.max(m, Math.ceil(earliest / 30) * 30);
      // last slot 30 min before closing so the kitchen has time
      for (; m <= toMin(to) - 30 && out.length < limit; m += 30) {
        const time = `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        const dayLabel = i === 0 ? "" : i === 1 ? "Tomorrow " : `${DAY_LABEL_EN[dayKey(dow)]} `;
        out.push({ iso: berlinToUtc(date, time).toISOString(), label: `${dayLabel}${time}`, date, time });
      }
    }
  }
  return out;
}

/** Footer copy: groups consecutive days with identical hours → "Mo–Do 11:00 — 23:00". */
export function hoursSummary(hours: OpeningHours | null | undefined, lang: "de" | "en" = "de"): string[] {
  if (!hours) return [];
  const labels = lang === "de" ? DAY_LABEL_DE : DAY_LABEL_EN;
  const order: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const fmt = (r: [string, string][] | undefined) =>
    !r || r.length === 0 ? (lang === "de" ? "geschlossen" : "closed") : r.map(([a, b]) => `${a} — ${b}`).join(", ");
  const lines: string[] = [];
  let start = 0;
  while (start < order.length) {
    let end = start;
    const sig = fmt(hours[order[start]!]);
    while (end + 1 < order.length && fmt(hours[order[end + 1]!]) === sig) end++;
    const days = start === end ? labels[order[start]!] : `${labels[order[start]!]}–${labels[order[end]!]}`;
    lines.push(`${days} ${sig}`);
    start = end + 1;
  }
  return lines;
}

/** "19:48" in Berlin time for an ISO instant. */
export function berlinTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return berlinParts(new Date(iso)).time;
}

export function berlinDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = berlinParts(new Date(iso));
  const today = berlinParts().date;
  if (p.date === today) return `today ${p.time}`;
  const tomorrow = addDays(today, 1).date;
  if (p.date === tomorrow) return `tomorrow ${p.time}`;
  return `${DAY_LABEL_EN[dayKey(p.dow)]} ${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}. ${p.time}`;
}
