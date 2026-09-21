import type { Metadata } from "next";
import { BusinessBlock, LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "AGB" };

export default function AgbPage() {
  return (
    <LegalPage title="Allgemeine Geschäftsbedingungen" kana="利用規約">
      {(b) => (
        <>
          <h2>1. Geltungsbereich</h2>
          <p>Diese AGB gelten für alle Bestellungen über die Website von {b.name ?? "Shosho Sushi GmbH"} (nachfolgend „SHOSHO“).</p>
          <BusinessBlock b={b} />
          <h2>2. Vertragsschluss</h2>
          <p>Mit dem Klick auf „Place order“ geben Sie ein verbindliches Angebot ab. Der Vertrag kommt zustande, wenn wir die Bestellung annehmen — sichtbar auf der Bestellstatus-Seite als „Order accepted“.</p>
          <h2 id="zahlung">3. Preise und Zahlung</h2>
          <p>Alle Preise verstehen sich inkl. der gesetzlichen Umsatzsteuer. Die Zahlung wird bei Bestätigung der Lieferung bzw. Abholung erfasst. Verfügbare Zahlungsarten werden im Checkout angezeigt; Barzahlung wird vom Kurier bestätigt.</p>
          <h2>4. Lieferung und Abholung</h2>
          <p>Liefergebiete, Mindestbestellwerte, Liefergebühren und voraussichtliche Lieferzeiten werden vor der Bestellung angezeigt. Vorbestellungen sind bis zu 7 Tage im Voraus innerhalb der Öffnungszeiten möglich. Bei Abholung gilt der ausgewiesene Abholrabatt.</p>
          <h2 id="allergene">5. Allergene und Zusatzstoffe</h2>
          <p>Allergene (A–N) sind bei jedem Gericht angegeben. Bitte teilen Sie Allergien im Kommentarfeld mit. Nährwerte auf Anfrage.</p>
          <h2>6. Widerruf</h2>
          <p>Bei frisch zubereiteten, verderblichen Speisen besteht kein Widerrufsrecht (§ 312g Abs. 2 Nr. 2 BGB). Siehe Widerrufsbelehrung.</p>
          <h2>7. Schlussbestimmungen</h2>
          <p>Es gilt deutsches Recht. Gerichtsstand ist, soweit zulässig, Berlin.</p>
        </>
      )}
    </LegalPage>
  );
}
