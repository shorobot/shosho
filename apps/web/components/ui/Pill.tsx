import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// The pill is the single call-to-action shape (brandbook 06). Every button on the site is one.
export type PillVariant = "primary" | "ink" | "soft" | "outline" | "selected" | "ghost";
export type PillSize = "xs" | "sm" | "md" | "lg";

const variants: Record<PillVariant, string> = {
  primary: "bg-orange text-white font-extrabold shadow-(--shadow-cta) hover:brightness-105 active:brightness-95 disabled:opacity-50 disabled:shadow-none",
  ink: "bg-ink text-cream font-extrabold hover:bg-[#22263d] disabled:opacity-50",
  soft: "bg-paper text-ink-2 font-medium shadow-(--shadow-pill) hover:text-ink",
  outline: "bg-paper text-ink-2 font-medium border border-line-2 hover:border-muted",
  selected: "bg-orange-tint text-ink font-extrabold border-2 border-orange",
  ghost: "bg-transparent text-ink-2 font-medium hover:text-ink",
};

const sizes: Record<PillSize, string> = {
  xs: "px-3.5 py-2 text-[12px]",
  sm: "px-4 py-2.5 text-[13px]",
  md: "px-5 py-3 text-[13px]",
  lg: "px-6 py-[13px] text-[15px]",
};

type Common = { variant?: PillVariant; size?: PillSize; className?: string; children: ReactNode };

export function pillClass({ variant = "primary", size = "md", className = "" }: Omit<Common, "children">) {
  return `inline-flex items-center justify-center gap-2 rounded-full whitespace-nowrap leading-[1.3] select-none transition-micro ${variants[variant]} ${sizes[size]} ${className}`;
}

export function Pill({ variant, size, className, children, ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={pillClass({ variant, size, className })} {...rest}>
      {children}
    </button>
  );
}

export function PillLink({ href, variant, size, className, children, ...rest }: Common & { href: string; prefetch?: boolean; "aria-label"?: string }) {
  return (
    <Link href={href} className={pillClass({ variant, size, className })} {...rest}>
      {children}
    </Link>
  );
}
