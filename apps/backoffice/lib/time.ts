// The DB reasons in Europe/Berlin (api-contracts §5); the browser may run anywhere, so every "today"
// and every clock label is computed in that zone explicitly.
export const TZ = "Europe/Berlin";

export function hhmm(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

export function ddmm(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: tz }).format(new Date(iso)).replace(/\.$/, "");
}

export function ddmmHHmm(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return "";
  return `${ddmm(iso, tz)} · ${hhmm(iso, tz)}`;
}

/** "Mo 15.09" — the board header's date label. */
export function headerDate(d: Date, lang: "de" | "en", tz = TZ): string {
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", { weekday: "short", day: "2-digit", month: lang === "de" ? "2-digit" : "short", timeZone: tz }).format(d).replace(",", "");
}

/** YYYY-MM-DD of a date in the given zone. */
export function dayKey(d: Date, tz = TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Offset of the zone at `d`, in minutes east of UTC (Berlin: 60 or 120). */
export function tzOffsetMinutes(d: Date, tz = TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - d.getTime()) / 60000);
}

/** Start of the local day (in `tz`) that contains `d`, as an absolute Date. */
export function startOfDay(d: Date, tz = TZ): Date {
  const key = dayKey(d, tz);
  const [y, m, day] = key.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, day, 0, 0, 0));
  // guess is 00:00 UTC; shift by the zone offset valid at that moment (DST-safe for a day boundary)
  const off = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - off * 60000);
}

/** Start of a YYYY-MM-DD day in `tz`. */
export function startOfDayKey(key: string, tz = TZ): Date {
  const [y, m, day] = key.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, day, 0, 0, 0));
  const off = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - off * 60000);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

export function minutesBetween(fromIso: string | null | undefined, to: Date | string | null | undefined): number | null {
  if (!fromIso || !to) return null;
  const a = new Date(fromIso).getTime();
  const b = typeof to === "string" ? new Date(to).getTime() : to.getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 60000));
}

/** "0:42" style elapsed label (m:ss under 1 h, else h:mm). */
export function elapsedLabel(fromIso: string | null | undefined, now: Date): string {
  if (!fromIso) return "";
  const s = Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")} h`;
}

/** Relative day label for a schedule: today → "HH:MM", tomorrow → {tomorrow} HH:MM, else "DD.MM HH:MM". */
export function scheduleLabel(iso: string, now: Date, words: { tomorrow: string }, tz = TZ): string {
  const k = dayKey(new Date(iso), tz);
  const today = dayKey(now, tz);
  const tomorrow = dayKey(addDays(now, 1), tz);
  if (k === today) return hhmm(iso, tz);
  if (k === tomorrow) return `${words.tomorrow} ${hhmm(iso, tz)}`;
  return ddmmHHmm(iso, tz);
}
