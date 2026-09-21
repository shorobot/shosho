import { LogoFull } from "@/components/ui/Logo";
import { hoursSummary } from "@/lib/hours";
import type { BusinessSettings, OpeningHours } from "@/lib/types";

// settings.site.maintenance → the site shows only contact and hours (BO · Website copy).
export function Maintenance({ business, hours }: { business: BusinessSettings | null; hours: OpeningHours | null }) {
  const lines = hoursSummary(hours, "en");
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-[640px] flex-col items-center gap-6 rounded-[28px] bg-ink px-8 py-16 text-center text-cream">
        <LogoFull />
        <p className="max-w-[420px] text-[15px] leading-[1.6] text-ink-cream">We&rsquo;re updating the menu. Online ordering is paused for a moment — call us or come by.</p>
        <div className="flex flex-col gap-1 text-[13px] leading-[1.6] text-cream">
          {business?.phone && <a href={`tel:${business.phone}`} className="font-extrabold text-sky">{business.phone}</a>}
          {business?.address?.street && <span>{business.address.street}, {business.address.postal_code} {business.address.city}</span>}
          {lines.map((l) => <span key={l} className="text-ink-cream">{l}</span>)}
        </div>
      </div>
    </div>
  );
}
