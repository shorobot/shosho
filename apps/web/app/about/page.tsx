import type { Metadata } from "next";
import { LogoFull } from "@/components/ui/Logo";
import { PillLink } from "@/components/ui/Pill";
import { SteppedBar } from "@/components/ui/Decor";
import { getCatalog } from "@/lib/catalog";
import { hoursSummary } from "@/lib/hours";
import { euroShort } from "@/lib/money";

export const metadata: Metadata = { title: "About", description: "A small kitchen on Torstraße where rice is pressed to order." };

// About (canvas copy). Address / hours / contact come from settings.business + opening_hours; zones from delivery_zones.
export default async function AboutPage() {
  const { settings, zones } = await getCatalog();
  const b = settings.business;
  const hours = hoursSummary(settings.opening_hours, "en");
  const stats = [
    { n: "2019", t: "Opened on Torstraße", d: "One counter, nine seats, the same rice supplier since day one." },
    { n: "60 min", t: "Delivery promise", d: "Mitte, Prenzlauer Berg and Friedrichshain, seven days a week." },
    { n: "2×", t: "Fish delivery per week", d: "Hamburg market, graded and cut in house the same morning." },
  ];
  const steps = [
    { n: "01", t: "Order", d: "Online, by phone or at the counter. Payment on delivery is available." },
    { n: "02", t: "Prepare", d: "Rice pressed to order. Nothing sits more than twenty minutes." },
    { n: "03", t: "Pack", d: "Cooled boxes, wasabi and ginger sealed separately." },
    { n: "04", t: "Deliver", d: "Own couriers. Live tracking from the moment the box leaves." },
  ];
  const plate = "flex flex-col gap-2.5 rounded-3xl bg-sand p-7";
  const plateHead = "text-[11px] font-medium leading-[1.3] tracking-[0.14em] text-sand-ink";
  return (
    <div className="screen-in mx-auto flex max-w-[1200px] flex-col gap-[22px] px-3 pt-[22px] md:px-[22px]">
      <section className="flex flex-col items-center gap-[22px] rounded-[28px] bg-ink px-6 py-14 text-center md:px-[60px] md:py-[74px]">
        <LogoFull />
        <p className="mt-3 max-w-[620px] text-[17px] leading-[1.6] text-[#C3C8DC]">A small kitchen on Torstraße where rice is pressed to order and fish arrives twice a week from Hamburg. We deliver across Mitte in sixty minutes.</p>
        <PillLink href="/#menu" size="lg" className="mt-1.5 px-8 py-4">See the menu →</PillLink>
      </section>

      <section className="grid gap-[18px] md:grid-cols-3">
        {stats.map((s) => (
          <div key={s.n} className="flex flex-col gap-2 rounded-[22px] bg-paper p-7 shadow-(--shadow-card)">
            <span className="text-[40px] font-extrabold leading-[1.3] text-orange">{s.n}</span>
            <span className="text-[15px] font-extrabold leading-[1.3]">{s.t}</span>
            <span className="text-[13px] leading-[1.5] text-muted">{s.d}</span>
          </div>
        ))}
      </section>

      <section className="grid items-stretch gap-[18px] md:grid-cols-2">
        <div className="relative min-h-[280px] overflow-hidden rounded-3xl bg-[#F7F3EF] md:min-h-[380px]" aria-hidden>
          <div className="stone stone-drift absolute left-[10%] top-[12%] h-[46%] w-[52%] bg-sky opacity-80" />
          <div className="stone absolute bottom-[12%] right-[10%] h-[40%] w-[46%] bg-blush opacity-90" />
          <span className="kana absolute bottom-6 left-7 text-[64px] font-bold leading-none text-ink/10">品質</span>
        </div>
        <div className="flex flex-col gap-[18px] rounded-3xl bg-paper p-7 shadow-(--shadow-card) md:p-9">
          <span className="kana text-[22px] font-bold leading-[1.3] text-blue">人生</span>
          <h2 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.01em]">How we work</h2>
          <ol className="flex flex-col gap-4">
            {steps.map((s) => (
              <li key={s.n} className="flex items-start gap-3.5">
                <span className="min-w-[22px] pt-[3px] text-[13px] font-extrabold leading-[1.3] text-orange">{s.n}</span>
                <span className="flex flex-col gap-[3px]">
                  <span className="text-[15px] font-extrabold leading-[1.2]">{s.t}</span>
                  <span className="text-[13px] leading-[1.5] text-ink-3">{s.d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grid gap-[18px] md:grid-cols-3">
        <div id="contact" className={plate}>
          <span className={plateHead}>ADDRESS</span>
          <span className="text-[18px] font-extrabold leading-[1.35]">{b?.address?.street ?? "Torstraße 000"}<br />{b?.address?.postal_code ?? "10119"} {b?.address?.city ?? "Berlin"}</span>
          <span className="text-[13px] leading-[1.5] text-sand-ink-2">U-Bhf Rosenthaler Platz, 3 min walk</span>
        </div>
        <div id="hours" className={plate}>
          <span className={plateHead}>HOURS</span>
          <span className="text-[18px] font-extrabold leading-[1.35]">{hours.length ? hours.map((l) => <span key={l} className="block">{l}</span>) : "Mon–Sun 11:00 — 23:00"}</span>
          <span className="text-[13px] leading-[1.5] text-sand-ink-2">Kitchen closes 30 minutes before. Outside these hours we take pre-orders.</span>
        </div>
        <div className={plate}>
          <span className={plateHead}>CONTACT</span>
          <span className="text-[18px] font-extrabold leading-[1.35]">{b?.phone ?? "+49 30 000 000"}<br />shosho.de</span>
          <span className="text-[13px] leading-[1.5] text-sand-ink-2">{b?.email ?? "hello@shosho.de"}</span>
        </div>
      </section>

      {zones.length > 0 && (
        <section id="delivery" className="flex flex-col gap-3 rounded-3xl bg-paper p-6 shadow-(--shadow-card) md:p-7">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[22px] font-extrabold leading-[1.3]">Delivery zones</h2>
            <span className="kana text-[13px] text-blue">配達</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {zones.map((z) => (
              <div key={z.code} className="flex flex-col gap-1 rounded-[18px] border border-line-2 p-4 text-[13px] leading-[1.5] text-ink-3">
                <span className="text-[15px] font-extrabold text-ink">{z.name} · {z.areas}</span>
                <span>About {z.promised_minutes} min · min. order {euroShort(z.min_order_cents)}</span>
                <span>Fee {z.fee_cents === 0 ? "free" : euroShort(z.fee_cents)}{z.free_delivery_over_cents != null ? ` · free over ${euroShort(z.free_delivery_over_cents)}` : ""}</span>
                <span className="text-[11px] text-muted">{z.postal_codes.join(" · ")}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section id="faq" className="flex flex-col gap-3 rounded-3xl bg-paper p-6 shadow-(--shadow-card) md:p-7">
        <h2 className="text-[22px] font-extrabold leading-[1.3]">Frequently asked</h2>
        <dl className="grid gap-4 text-[13px] leading-[1.5] md:grid-cols-2">
          <div><dt className="font-extrabold">Do I need an account?</dt><dd className="text-ink-3">No — guest checkout only. We ask for a name and a phone number for the courier.</dd></div>
          <div><dt className="font-extrabold">When is payment taken?</dt><dd className="text-ink-3">Payment is captured on delivery confirmation. Cash is confirmed by the courier.</dd></div>
          <div><dt className="font-extrabold">Can I pre-order?</dt><dd className="text-ink-3">Yes, up to seven days ahead, inside opening hours — pick a time at checkout.</dd></div>
          <div><dt className="font-extrabold">Allergens?</dt><dd className="text-ink-3">Every dish lists its allergens (A–N). Write allergies in the courier comment and the kitchen sees it.</dd></div>
        </dl>
      </section>

      <SteppedBar />
    </div>
  );
}
