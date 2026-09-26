"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LangToggle } from "@/components/shell/LangToggle";
import { Logo } from "@/components/shell/Logo";
import { useT, type Key } from "@/lib/i18n";
import { avgPrepMinutes, kitchenLoad } from "@/lib/orders";
import { useOrders } from "@/lib/store";
import type { Staff } from "@/lib/types";

type NavItem = { key: Key; href: string; match: string[]; live: boolean };

const OPERATOR_NAV: NavItem[] = [
  { key: "nav.orders", href: "/orders", match: ["/orders"], live: true },
  { key: "nav.customers", href: "/customers", match: ["/customers"], live: false },
  { key: "nav.menu", href: "/menu", match: ["/menu"], live: false },
  { key: "nav.website", href: "/website", match: ["/website"], live: false },
  { key: "nav.marketing", href: "/marketing", match: ["/marketing"], live: false },
  { key: "nav.reports", href: "/reports", match: ["/reports"], live: false },
  { key: "nav.settings", href: "/settings", match: ["/settings"], live: false },
];

function navFor(role: Staff["role"]): NavItem[] {
  if (role === "kitchen") return [{ key: "nav.kitchen", href: "/kitchen", match: ["/kitchen"], live: true }];
  if (role === "driver") return [{ key: "nav.driver", href: "/driver", match: ["/driver"], live: true }];
  return OPERATOR_NAV;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, "")[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Shell({ me, children }: { me: Staff; children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const { orders, now } = useOrders();
  const [open, setOpen] = useState(false);
  const nav = navFor(me.role);
  const newCount = orders.filter((o) => o.status === "new").length;
  const load = kitchenLoad(orders);
  const avg = avgPrepMinutes(orders, now);
  const isDriver = me.role === "driver";

  const rail = (
    <>
      <div className="pl-2">
        <Logo />
      </div>
      <div className="mx-2">
        <LangToggle />
      </div>
      <nav className="flex flex-col gap-[3px]" aria-label="Main">
        {nav.map((n) => {
          const active = n.match.some((m) => pathname === m || pathname.startsWith(m + "/"));
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className={`flex items-center justify-between rounded-xl px-3.5 py-[11px] text-[13px] transition-micro ${active ? "bg-orange font-extrabold text-white" : "font-medium text-nav-text hover:text-cream"}`}
              aria-current={active ? "page" : undefined}
            >
              <span>{t(n.key)}</span>
              {n.key === "nav.orders" && newCount > 0 && <span className="rounded-full bg-alert px-2 py-[2px] text-[10px] font-extrabold text-white">{newCount}</span>}
              {!n.live && <span className="text-[9px] font-medium tracking-[0.1em] text-nav-muted">SOON</span>}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-2.5">
        {!isDriver && (
          <div className="flex flex-col gap-1.5 rounded-[14px] bg-nav p-3.5">
            <span className="text-[10px] font-medium tracking-[0.12em] text-sky">{t("shell.kitchenLoad")}</span>
            <span className="text-[20px] font-extrabold text-cream">{load} %</span>
            <div className="h-[5px] overflow-hidden rounded-[3px] bg-nav-track">
              <div className="h-[5px] rounded-[3px] bg-orange transition-[width] duration-(--duration-screen)" style={{ width: `${load}%` }} />
            </div>
            <span className="text-[11px] text-nav-muted">{avg == null ? t("shell.avgPrepNone") : t("shell.avgPrep", { n: avg })}</span>
          </div>
        )}
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-orange text-[11px] font-extrabold text-white">{initials(me.name)}</span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[12px] font-medium text-cream">{me.name}</span>
            <span className="text-[10px] text-nav-muted">{t(`role.${me.role}` as Key)}</span>
          </div>
          <form action="/auth/signout" method="post" className="ml-auto">
            <button type="submit" className="rounded-full px-2 py-1 text-[10px] font-extrabold tracking-[0.06em] text-nav-text hover:text-cream" title={t("shell.logout")}>
              {t("shell.logout")}
            </button>
          </form>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-dvh">
      {/* rail (desktop) */}
      <aside className="hidden w-[216px] flex-none flex-col gap-5 bg-ink px-4 py-[22px] md:flex">{rail}</aside>
      {/* top bar (mobile) */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-[54px] items-center justify-between bg-ink px-4 md:hidden">
        <Logo />
        <div className="flex items-center gap-2">
          <span className="flex h-[28px] w-[28px] items-center justify-center rounded-full bg-orange text-[10px] font-extrabold text-white">{initials(me.name)}</span>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Menu" aria-expanded={open} className="flex h-9 w-9 items-center justify-center rounded-full bg-nav text-cream">
            ☰
          </button>
        </div>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="presentation" onClick={() => setOpen(false)}>
          <aside className="screen-in flex w-[240px] flex-col gap-5 bg-ink px-4 py-[22px]" onClick={(e) => e.stopPropagation()}>
            {rail}
          </aside>
          <div className="flex-1 bg-ink/40" />
        </div>
      )}
      <main className="min-w-0 flex-1 px-4 pb-8 pt-[70px] md:px-6 md:pt-[22px]">{children}</main>
    </div>
  );
}
