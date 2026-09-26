import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// The pill is the single call-to-action shape (brandbook 06).
export type PillVariant = "primary" | "ink" | "soft" | "ghost" | "alert" | "outline";
export type PillSize = "xs" | "sm" | "md" | "lg" | "xl";

const variants: Record<PillVariant, string> = {
  primary: "bg-orange text-white font-extrabold shadow-(--shadow-cta) hover:brightness-105 active:brightness-95 disabled:shadow-none",
  ink: "bg-ink text-cream font-extrabold hover:bg-nav",
  soft: "bg-field text-ink-2 font-extrabold hover:text-ink",
  ghost: "bg-paper text-ink-2 font-medium shadow-(--shadow-pill) hover:text-ink",
  alert: "bg-alert text-white font-extrabold hover:brightness-105",
  outline: "bg-transparent text-ink-2 font-extrabold border border-line-2 hover:border-muted",
};

const sizes: Record<PillSize, string> = {
  xs: "px-3 py-1.5 text-[11px]",
  sm: "px-3.5 py-2 text-[12px]",
  md: "px-4 py-[11px] text-[12px]",
  lg: "px-5 py-3 text-[13px]",
  xl: "px-6 py-4 text-[15px]",
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

export function PillLink({ href, variant, size, className, children }: Common & { href: string }) {
  return (
    <Link href={href} className={pillClass({ variant, size, className })}>
      {children}
    </Link>
  );
}
