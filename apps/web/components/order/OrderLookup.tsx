"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill, PillLink } from "@/components/ui/Pill";
import { recentTracking } from "@/lib/cart";

// /order — your recent orders on this device, or paste a tracking link.
export function OrderLookup() {
  const router = useRouter();
  const [recent, setRecent] = useState<{ token: string; number: number; at: string }[]>([]);
  const [token, setToken] = useState("");
  useEffect(() => setRecent(recentTracking()), []);
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const t = token.trim().split("/").pop() ?? "";
    if (t) router.push(`/order/${t}`);
  };
  return (
    <div className="screen-in mx-auto flex max-w-[520px] flex-col gap-4 px-4 py-10">
      <h1 className="text-[26px] font-extrabold leading-[1.2]">Track your order</h1>
      {recent.length > 0 ? (
        <ul className="card flex flex-col divide-y divide-line p-2">
          {recent.map((r) => (
            <li key={r.token}>
              <Link href={`/order/${r.token}`} className="flex items-center justify-between rounded-2xl px-3 py-3 hover:bg-field-2">
                <span className="text-[15px] font-extrabold">Order #{r.number}</span>
                <span className="text-[12px] text-muted">{new Date(r.at).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })} →</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="◔" title="No orders on this device yet" body="Once you place an order, its live status appears here. You can also paste the link from your confirmation." action={<PillLink href="/#menu" size="sm">Open the menu</PillLink>} />
      )}
      <form onSubmit={go} className="flex gap-2">
        <input className="field" placeholder="Paste a tracking link or code" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Tracking code" />
        <Pill type="submit" size="md" disabled={!token.trim()}>Open</Pill>
      </form>
    </div>
  );
}
