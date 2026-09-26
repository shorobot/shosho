export function Logo({ light = true }: { light?: boolean }) {
  return (
    <div className={`flex items-baseline gap-2 ${light ? "text-cream" : "text-ink"}`}>
      <span className="text-[17px] font-extrabold tracking-[0.1em]">SHOSHO</span>
      <span className="kana text-[11px] text-sky">ショ</span>
    </div>
  );
}
