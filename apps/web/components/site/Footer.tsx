import Link from "next/link";
import { hoursSummary } from "@/lib/hours";
import type { BusinessSettings, OpeningHours, PaymentsEnabled } from "@/lib/types";

const PAY_MARK: Record<string, string> = { card: "VISA · MASTERCARD", apple_pay: "APPLE PAY", google_pay: "G PAY", paypal: "PAYPAL", bitcoin: "BTC", cash: "BAR" };

// DE legal footer (design: RECHTLICHES / BESTELLEN / SERVICE / ÖFFNUNGSZEITEN). Business data + hours from settings.
export function Footer({ business, hours, payments }: { business: BusinessSettings | null; hours: OpeningHours | null; payments: PaymentsEnabled | null }) {
  const name = business?.name ?? "SHOSHO";
  const addr = business?.address;
  const lines = hoursSummary(hours, "de");
  const marks = (payments?.methods ?? []).map((m) => PAY_MARK[m]).filter(Boolean);
  const col = "flex min-w-0 flex-col gap-[9px]";
  const link = "text-[13px] leading-[1.5] text-ink-2 transition-micro hover:text-orange";
  const head = "text-[10px] font-medium leading-[1.3] tracking-[0.14em] text-muted";
  return (
    <footer id="contacts" className="mt-[34px] border-t border-footer-line bg-footer px-[22px] pb-[26px] pt-11 text-ink" lang="de">
      <div className="mx-auto flex max-w-[1560px] flex-col gap-[30px]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[26px]">
          <div className="flex min-w-0 flex-col gap-[11px]">
            <div className="flex items-baseline gap-2">
              <span className="text-[19px] font-extrabold leading-[1.3] tracking-[0.1em]">SHOSHO</span>
              <span className="kana text-[11px] leading-[1.3] text-kana">ショ</span>
            </div>
            <span className="text-[13px] leading-[1.55] text-ink-3">
              {name}
              {addr?.street && (<><br />{addr.street}</>)}
              {(addr?.postal_code || addr?.city) && (<><br />{[addr?.postal_code, addr?.city].filter(Boolean).join(" ")}</>)}
            </span>
            <span className="text-[13px] leading-[1.55] text-ink-3">
              {business?.phone && <>Tel. {business.phone}<br /></>}
              {business?.email && <a href={`mailto:${business.email}`} className="text-orange">{business.email}</a>}
            </span>
          </div>
          <div className={col}>
            <span className={head}>RECHTLICHES</span>
            <Link href="/impressum" className={link}>Impressum</Link>
            <Link href="/agb" className={link}>AGB</Link>
            <Link href="/datenschutz" className={link}>Datenschutzerklärung</Link>
            <Link href="/widerruf" className={link}>Widerrufsbelehrung</Link>
            <Link href="/datenschutz#cookies" className={link}>Cookie-Einstellungen</Link>
          </div>
          <div className={col}>
            <span className={head}>BESTELLEN</span>
            <Link href="/#menu" className={link}>Speisekarte</Link>
            <Link href="/about#delivery" className={link}>Liefergebiete</Link>
            <Link href="/about#hours" className={link}>Lieferzeiten</Link>
            <Link href="/agb#zahlung" className={link}>Zahlungsarten</Link>
            <Link href="/checkout" className={link}>Gutscheine</Link>
          </div>
          <div className={col}>
            <span className={head}>SERVICE</span>
            <Link href="/about#contact" className={link}>Kontakt</Link>
            <Link href="/about#faq" className={link}>Häufige Fragen</Link>
            <Link href="/agb#allergene" className={link}>Allergene &amp; Zusatzstoffe</Link>
            <Link href="/agb#allergene" className={link}>Nährwerte</Link>
            <Link href="/order" className={link}>Bestellung verfolgen</Link>
          </div>
          <div className="flex min-w-0 flex-col gap-[11px]">
            <span className={head}>ÖFFNUNGSZEITEN</span>
            <span className="text-[13px] leading-[1.55] text-ink-2">
              {lines.length ? lines.map((l) => <span key={l} className="block">{l}</span>) : "Öffnungszeiten folgen"}
            </span>
            {marks.length > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-2">
                {marks.map((m) => (
                  <span key={m} className="rounded-lg bg-paper px-2.5 py-[7px] text-[10px] font-medium leading-[1.3] text-ink-3 shadow-(--shadow-pill)">{m}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-footer-line pt-[18px]">
          <span className="text-[11px] leading-[1.4] text-muted-2">© {new Date().getFullYear()} {name}</span>
          <div className="flex flex-wrap gap-4">
            <Link href="/impressum" className="text-[11px] font-medium text-ink-3 hover:text-orange">Impressum</Link>
            <Link href="/datenschutz" className="text-[11px] font-medium text-ink-3 hover:text-orange">Datenschutz</Link>
            <Link href="/agb" className="text-[11px] font-medium text-ink-3 hover:text-orange">AGB</Link>
            <Link href="/widerruf" className="text-[11px] font-medium text-ink-3 hover:text-orange">Widerruf</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
