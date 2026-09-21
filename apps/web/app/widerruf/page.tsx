import type { Metadata } from "next";
import { BusinessBlock, LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Widerrufsbelehrung" };

export default function WiderrufPage() {
  return (
    <LegalPage title="Widerrufsbelehrung" kana="キャンセル">
      {(b) => (
        <>
          <h2>Widerrufsrecht</h2>
          <p>Verbraucher haben grundsätzlich ein vierzehntägiges Widerrufsrecht. Um Ihr Widerrufsrecht auszuüben, müssen Sie uns mittels einer eindeutigen Erklärung über Ihren Entschluss informieren:</p>
          <BusinessBlock b={b} />
          <h2>Ausschluss des Widerrufsrechts</h2>
          <p>Das Widerrufsrecht besteht nicht bei Verträgen zur Lieferung von Waren, die schnell verderben können oder deren Verfallsdatum schnell überschritten würde (§ 312g Abs. 2 Nr. 2 BGB). Dies gilt für frisch zubereitete Speisen und Getränke aus unserer Küche.</p>
          <h2>Stornierung vor Zubereitung</h2>
          <p>Solange die Küche noch nicht mit der Zubereitung begonnen hat, können Sie eine Bestellung telefonisch stornieren. Bereits erfasste Zahlungen werden erstattet.</p>
        </>
      )}
    </LegalPage>
  );
}
