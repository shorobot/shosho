// Element kit (brandbook 06): stone shapes and the 4×8 dot grid, as CSS. Pick two per piece — three is noise.
export function Stone({ color = "sky", className = "", drift = true }: { color?: "sky" | "blush" | "sand"; className?: string; drift?: boolean }) {
  const bg = color === "sky" ? "bg-sky" : color === "blush" ? "bg-blush" : "bg-sand";
  return <div aria-hidden className={`stone pointer-events-none absolute ${bg} ${drift ? "stone-drift" : ""} ${className}`} />;
}

export function DotGrid({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`dot-grid pointer-events-none absolute h-[112px] w-[56px] ${className}`} />;
}

/** Stepped bar — footer and offer strips only. */
export function SteppedBar({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`flex items-center overflow-hidden rounded-3xl ${className}`}>
      <div className="h-[52px] flex-1 bg-ink" />
      <div className="h-[74px] flex-1 bg-blue" />
      <div className="h-[52px] flex-1 bg-orange" />
      <div className="h-[74px] flex-1 bg-sky" />
      <div className="h-[52px] flex-1 bg-blush" />
    </div>
  );
}
