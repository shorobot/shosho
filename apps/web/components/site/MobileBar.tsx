"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart";
import { euro } from "@/lib/money";

// Mobile bottom bar (canvas Mobile screen): Home · Menu · [cart] · About · Order. Hidden on checkout
// and tracking, which carry their own sticky action.
export function MobileBar() {
  const pathname = usePathname();
  const { count, quote } = useCart();
  if (pathname.startsWith("/checkout") || pathname.startsWith("/order/")) return null;
  const tab = (href: string, icon: string, label: string, active: boolean) => (
    <Link href={href} className={`flex min-w-[44px] flex-col items-center gap-[3px] text-[9px] leading-[1.3] tracking-[0.04em] ${active ? "font-extrabold text-orange" : "font-medium text-muted-2"}`}>
      <span className="text-[15px]" aria-hidden>{icon}</span>
      <span>{label}</span>
    </Link>
  );
  return (
    <nav className="fixed inset-x-3.5 bottom-3.5 z-30 flex items-center justify-between rounded-[28px] bg-paper px-3 py-2.5 shadow-(--shadow-card-lg) md:hidden" aria-label="Mobile">
      {tab("/", "⌂", "Home", pathname === "/")}
      {tab("/#menu", "☰", "Menu", false)}
      <Link
        href="/checkout"
        className="-mt-[26px] flex h-[54px] w-[54px] flex-none flex-col items-center justify-center gap-px rounded-full bg-orange text-white shadow-(--shadow-cta-sm)"
        aria-label={`Cart, ${count} items${quote ? `, ${euro(quote.total_cents)}` : ""}`}
      >
        <span className="text-[14px]" aria-hidden>⌾</span>
        <span className="text-[9px] font-extrabold leading-none" aria-hidden>{count}</span>
      </Link>
      {tab("/about", "✦", "About", pathname === "/about")}
      {tab("/order", "◔", "Order", pathname.startsWith("/order"))}
    </nav>
  );
}
