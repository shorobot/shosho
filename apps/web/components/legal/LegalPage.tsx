import type { ReactNode } from "react";
import { getCatalog } from "@/lib/catalog";
import type { BusinessSettings } from "@/lib/types";

// Legal pages (DE): placeholder text with the business data from settings.business.
// TODO(owner): replace the placeholder paragraphs with the lawyer-approved texts.
export async function LegalPage({ title, kana, children }: { title: string; kana: string; children: (b: BusinessSettings) => ReactNode }) {
  const { settings } = await getCatalog();
  const b = settings.business ?? {};
  return (
    <article className="screen-in mx-auto flex max-w-[820px] flex-col gap-5 px-3 pt-[22px] md:px-[22px]" lang="de">
      <header className="flex flex-col gap-1.5">
        <span className="kana text-[14px] font-bold text-blue">{kana}</span>
        <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.01em]">{title}</h1>
      </header>
      <div className="card flex flex-col gap-4 p-6 text-[14px] leading-[1.65] text-ink-2 md:p-8 [&_h2]:mt-2 [&_h2]:text-[17px] [&_h2]:font-extrabold [&_h2]:text-ink [&_p]:m-0 [&_strong]:text-ink">{children(b)}</div>
      <p className="text-[11px] text-muted">Platzhaltertext — wird durch die rechtlich geprüfte Fassung ersetzt.</p>
    </article>
  );
}

export function BusinessBlock({ b }: { b: BusinessSettings }) {
  return (
    <p>
      <strong>{b.name ?? "Shosho Sushi GmbH"}</strong>
      <br />
      {b.address?.street ?? "Torstraße 000"}
      <br />
      {b.address?.postal_code ?? "10119"} {b.address?.city ?? "Berlin"}
      <br />
      {b.phone && <>Telefon: {b.phone}<br /></>}
      {b.email && <>E-Mail: <a href={`mailto:${b.email}`} className="text-orange">{b.email}</a></>}
    </p>
  );
}
