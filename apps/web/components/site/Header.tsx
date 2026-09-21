"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogoCompact } from "@/components/ui/Logo";
import { useCart } from "@/lib/cart";
import { euro } from "@/lib/money";
import { AddressButton } from "./AddressButton";
import { OrderTypeToggle } from "./OrderTypeToggle";
import { useUi } from "./UiProvider";

const NAV = [
  { href: "/", label: "Menu" },
  { href: "/#sets", label: "Sets" },
  { href: "/about", label: "About" },
  { href: "/#contacts", label: "Contacts" },
];

// Header (Home A): white pill bar — logo, nav, search, DELIVERY/PICKUP, address. Mobile: two rows.
export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { query, setQuery } = useUi();
  const { count, quote } = useCart();
  const isHome = pathname === "/";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHome) router.push(query ? `/?q=${encodeURIComponent(query)}#menu` : "/#menu");
    else document.getElementById("menu")?.scrollIntoView({ block: "start" });
  };

  return (
    <header className="sticky top-3 z-30 mx-auto w-full max-w-[1560px] px-3 md:px-[22px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[22px] bg-paper px-4 py-3 shadow-(--shadow-card) md:px-[22px] md:py-3.5">
        <LogoCompact />
        <nav className="ml-1 hidden gap-[22px] text-[14px] font-medium leading-[1.3] text-ink-2 md:flex md:ml-[18px]" aria-label="Main">
          {NAV.map((n) => {
            const active = n.href === "/" ? isHome : pathname === n.href;
            return (
              <Link key={n.href} href={n.href} className={`transition-micro hover:text-orange ${active ? "font-extrabold text-ink" : ""}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/checkout"
          className="ml-auto flex items-center gap-2 rounded-full bg-orange px-4 py-2.5 text-[13px] font-extrabold text-white shadow-(--shadow-cta-sm) md:hidden"
          aria-label={`Cart, ${count} items`}
        >
          <span aria-hidden>⌾</span> {count > 0 ? (quote ? euro(quote.total_cents) : `${count}`) : "Cart"}
        </Link>
        <div className="flex w-full flex-1 flex-wrap items-center justify-end gap-3 md:ml-auto md:w-auto">
          <form onSubmit={onSubmit} className="flex min-w-[180px] flex-1 items-center gap-2 rounded-full bg-field px-4 py-2.5 shadow-(--shadow-inset-sm)" role="search">
            <span className="text-[13px] text-muted-2" aria-hidden>⌕</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search dishes, sets, drinks…"
              aria-label="Search dishes, sets, drinks"
              className="w-full bg-transparent text-[13px] leading-[1.3] text-ink outline-none placeholder:text-muted-2"
            />
          </form>
          <OrderTypeToggle />
          <AddressButton />
        </div>
      </div>
    </header>
  );
}
