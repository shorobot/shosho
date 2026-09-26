// Money is integer cents everywhere (api-contracts §1). German formatting: "34,50 €".
export function euro(cents: number | null | undefined, lang: "de" | "en" = "de"): string {
  const v = (cents ?? 0) / 100;
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB", { style: "currency", currency: "EUR" }).format(v);
}

export function km(value: number | null | undefined, lang: "de" | "en" = "de"): string {
  if (value == null) return "";
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB", { maximumFractionDigits: 1 }).format(value);
}
