// Money is integer cents everywhere in the DB (api-contracts §1). The two Next apps format it
// differently on purpose (apps/web/lib/money.ts: fixed "14.90 €"; apps/backoffice/lib/money.ts:
// Intl.NumberFormat, "34,50 €" in DE / "€34.50" in EN) — this parser has to accept all three shapes
// so one assertion helper can trace one order's cents across both surfaces.

/** "14.90 €" | "34,50 €" | "€34.50" | "−3,50 €" → integer cents. Throws on anything unrecognised,
 * on purpose — a parse failure should fail the test, not silently compare 0 to 0. */
export function parseMoneyText(raw: string): number {
  const text = raw.trim();
  const negative = /^[-−–]/.test(text) || /[-−–]\s*€|€\s*[-−–]/.test(text);
  const digits = text.replace(/[^0-9.,]/g, "");
  if (!digits) throw new Error(`parseMoneyText: no digits in "${raw}"`);
  // thousands + decimal (either order of separators), or a bare "X.YY"/"X,YY"
  const grouped = digits.match(/^(\d{1,3}(?:[.,]\d{3})*)[.,](\d{2})$/);
  const simple = digits.match(/^(\d+)[.,](\d{2})$/);
  const whole = digits.match(/^(\d+)$/);
  const m = grouped ?? simple;
  if (!m) {
    if (whole) return (negative ? -1 : 1) * Number(whole[1]) * 100;
    throw new Error(`parseMoneyText: unrecognised shape "${raw}"`);
  }
  const intPart = m[1]!.replace(/[.,]/g, "");
  const cents = Number(intPart) * 100 + Number(m[2]);
  return negative ? -cents : cents;
}

/** cents → "14.90 €", mirroring apps/web/lib/money.ts exactly (used to build expected web-side text). */
export function euroWeb(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} €`;
}

/** cents → Intl-formatted string, mirroring apps/backoffice/lib/money.ts exactly. */
export function euroBackoffice(cents: number, lang: "de" | "en" = "de"): string {
  const v = cents / 100;
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB", { style: "currency", currency: "EUR" }).format(v);
}
