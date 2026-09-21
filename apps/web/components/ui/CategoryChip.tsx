"use client";
import { CategoryIcon } from "./CategoryIcon";

// Category chip with kana over the Latin label (Home rail). Active = warm inset, inactive = raised white.
export function CategoryChip({
  slug,
  kana,
  label,
  index,
  active,
  onClick,
  count,
}: {
  slug: string;
  kana: string | null;
  label: string;
  index: number;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-[92px] flex-none cursor-pointer flex-col items-center gap-[7px] rounded-[20px] border-[1.5px] border-transparent px-3.5 pb-[11px] pt-3 transition-micro ${
        active ? "bg-orange-tint shadow-(--shadow-inset-warm)" : "bg-paper shadow-(--shadow-chip) hover:-translate-y-px"
      }`}
    >
      <CategoryIcon slug={slug} kana={kana} index={index} />
      <span className="kana text-[10px] font-bold leading-[1.3] text-muted-2">{kana ?? " "}</span>
      <span className={`whitespace-nowrap text-[11px] font-medium leading-[1.3] tracking-[0.06em] uppercase ${active ? "text-orange" : "text-ink"}`}>
        {label}
        {count != null && <span className="sr-only"> ({count})</span>}
      </span>
    </button>
  );
}
