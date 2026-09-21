import type { Metadata } from "next";
import { BusinessBlock, LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Datenschutzerklärung" };

export default function DatenschutzPage() {
  return (
    <LegalPage title="Datenschutzerklärung" kana="プライバシー">
      {(b) => (
        <>
          <h2>1. Verantwortlicher</h2>
          <BusinessBlock b={b} />
          <h2>2. Welche Daten wir verarbeiten</h2>
          <p>Für eine Bestellung verarbeiten wir Name, Telefonnummer, Lieferadresse, Bestellinhalt und Zahlungsart (Art. 6 Abs. 1 lit. b DSGVO). Ein Kundenkonto ist nicht erforderlich. Ein Kundenprofil wird automatisch aus der ersten Bestellung erstellt (Zuordnung über die Telefonnummer).</p>
          <h2>3. Speicherdauer</h2>
          <p>Rechnungsdaten werden nach GoBD 10 Jahre aufbewahrt. Kundendaten werden nach 24 Monaten ohne Bestellung anonymisiert.</p>
          <h2 id="cookies">4. Cookies und lokale Speicherung</h2>
          <p>Die Website nutzt ausschließlich technisch notwendige lokale Speicherung im Browser: Warenkorb, Liefer-/Abholwahl und der Link zur Bestellverfolgung. Es werden keine Analyse- oder Tracking-Dienste eingesetzt.</p>
          <h2>5. Hosting</h2>
          <p>Die Daten werden auf Servern in der EU (Frankfurt) verarbeitet.</p>
          <h2>6. Ihre Rechte</h2>
          <p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch. Wenden Sie sich dazu an die oben genannte Adresse.</p>
          <h2>7. Marketing</h2>
          <p>Werbliche Nachrichten erhalten Sie nur mit dokumentierter Einwilligung (Kanal, Datum, Quelle), höchstens eine automatisierte Nachricht pro Woche.</p>
        </>
      )}
    </LegalPage>
  );
}
