import type { Metadata } from "next";
import { BusinessBlock, LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Impressum" };

export default function ImpressumPage() {
  return (
    <LegalPage title="Impressum" kana="会社概要">
      {(b) => (
        <>
          <h2>Angaben gemäß § 5 DDG</h2>
          <BusinessBlock b={b} />
          {b.impressum && <p>{b.impressum}</p>}
          <h2>Umsatzsteuer-ID</h2>
          <p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: {b.ust_id ?? "DE000000000"}</p>
          <h2>Verantwortlich für den Inhalt</h2>
          <p>Verantwortlich nach § 18 Abs. 2 MStV: Geschäftsführung, Anschrift wie oben.</p>
          <h2>Streitschlichtung</h2>
          <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit. Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
        </>
      )}
    </LegalPage>
  );
}
