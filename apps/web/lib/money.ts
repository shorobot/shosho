/** 1490 → "14.90 €" (design formatting: dot decimal, space, euro sign). */
export function euro(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")} €`;
}

/** Whole euros for copy like "free delivery over 35 €". */
export function euroShort(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return cents % 100 === 0 ? `${cents / 100} €` : euro(cents);
}
