// `<input type="datetime-local">` speaks wall-clock time with no zone; every timestamptz in this
// schema is an absolute instant and the business reasons in Europe/Berlin (§5). These two functions
// are the only place that conversion happens, so a banner that is supposed to start at 11:00 Berlin
// does not start at 11:00 in whatever zone the operator's laptop is set to.
import { TZ, tzOffsetMinutes } from "@/lib/time";

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant → "YYYY-MM-DDTHH:mm" as read in `tz`, the value a datetime-local input takes. */
export function isoToLocalInput(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * "YYYY-MM-DDTHH:mm" read as a wall time in `tz` → ISO instant. The offset is taken at the guessed
 * instant rather than at "now", so a date on the other side of a DST switch lands on the hour the
 * operator typed.
 */
export function localInputToIso(value: string, tz = TZ): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as [unknown, number, number, number, number, number];
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const off = tzOffsetMinutes(guess, tz);
  const exact = new Date(guess.getTime() - off * 60000);
  // One re-read: if the guess straddled a DST change the offset at `exact` is the right one.
  const off2 = tzOffsetMinutes(exact, tz);
  return new Date(guess.getTime() - off2 * 60000).toISOString();
}

/** "15.09.2026 · 17:20" — the long form used in publish history and campaign rows. */
export function fullDateTime(iso: string | null | undefined, lang: "de" | "en" = "de", tz = TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz }).format(d);
  const time = new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
  return `${date} · ${time}`;
}

/** "15.09." — short, for a banner window label. */
export function shortDate(iso: string | null | undefined, lang: "de" | "en" = "de", tz = TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", { day: "2-digit", month: "2-digit", timeZone: tz }).format(d);
}

/** `pad` is exported so a test can build an expected label without re-deriving the format. */
export { pad };
