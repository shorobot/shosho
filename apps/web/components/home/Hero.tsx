import { PillLink } from "@/components/ui/Pill";
import { DotGrid, Stone } from "@/components/ui/Decor";
import { euroShort } from "@/lib/money";

// Hero banner — static content in v1 (banners table is later). Only the "from …" price comes from the menu.
export function Hero({ fromCents }: { fromCents: number | null }) {
  return (
    <section className="relative grid min-h-[210px] overflow-hidden rounded-[28px] border border-white/90 bg-[linear-gradient(120deg,#FFFFFF_0%,#FBF8F5_46%,#F3EFEA_100%)] shadow-(--shadow-card-lg) md:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]" aria-label="Signature sets, delivered in 60 minutes">
      <div className="flex flex-col justify-center gap-[11px] px-6 pb-8 pt-7 md:px-[38px]">
        <div className="kana text-[13px] font-bold leading-[1.3] tracking-[0.2em] text-kana">デリバリー注文はこちら</div>
        <h1 className="text-balance text-[clamp(26px,2.9vw,38px)] font-extrabold leading-[1.02] tracking-[-0.01em] text-ink">
          Signature sets,
          <br />
          delivered in 60&nbsp;min
        </h1>
        <p className="max-w-[380px] text-[14px] leading-[1.45] text-ink-3">Rice pressed to order, wasabi grated the same morning. Free delivery across Mitte over 35&nbsp;€.</p>
        <div className="mt-0.5 flex items-center gap-3.5">
          <PillLink href="/#menu" size="lg">Order now →</PillLink>
          {fromCents != null && <span className="whitespace-nowrap text-[13px] font-medium leading-[1.3] text-muted">from {euroShort(fromCents)}</span>}
        </div>
      </div>
      <div className="relative hidden min-h-[210px] bg-[#F7F3EF] md:block" aria-hidden>
        <Stone color="sky" className="left-[12%] top-[14%] h-[150px] w-[190px] opacity-80" />
        <Stone color="blush" className="right-[10%] top-[40%] h-[120px] w-[140px] opacity-90" />
        <DotGrid className="bottom-4 right-6" />
        <span className="kana absolute bottom-5 left-6 text-[44px] font-bold text-ink/10">うどん</span>
      </div>
      <div className="absolute bottom-4 left-6 flex gap-1.5 md:left-[38px]" aria-hidden>
        <span className="h-[5px] w-[22px] rounded-[3px] bg-progress" />
        <span className="h-[5px] w-[5px] rounded-[3px] bg-[#D8D2CA]" />
        <span className="h-[5px] w-[5px] rounded-[3px] bg-[#D8D2CA]" />
      </div>
    </section>
  );
}
